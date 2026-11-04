import { CloudflareWorkersAiClient } from '../cloudflare-workers-ai.client';
import { GeminiCredentialManager } from '../gemini/gemini-credential-manager.service';
import { AiTaskType, GeminiModelRouter } from '../gemini/gemini-model-router';
import type { ReviewPrompt } from '../toeic-answer-review-prompt';
import { vendorOfModel } from '../../toeic/toeic-answer-review.logic';
import {
  AnswerReviewer,
  ReviewerImage,
  ReviewerOutputError,
  ReviewerReply,
} from './answer-reviewer';
import { strictJsonSchema } from './strict-json-schema';

const OPENAI_COMPAT_TIMEOUT_MS = 180_000;
const GEMINI_REVIEW_TIMEOUT_MS = 60_000;

function parseJson(text: string, provider: string) {
  let body = text.trim();
  if (body.startsWith('```'))
    body = body.replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(body);
  } catch {
    throw new ReviewerOutputError(`${provider} reply is not valid JSON`);
  }
}

export class CloudflareReviewer implements AnswerReviewer {
  readonly name = 'cloudflare' as const;
  readonly supportsImages = false;
  constructor(private readonly client: CloudflareWorkersAiClient) {}
  configured() {
    return this.client.configured();
  }
  model() {
    return this.client.textModel();
  }
  vendor() {
    return vendorOfModel('cloudflare', this.model());
  }
  async reviewJson(prompt: ReviewPrompt): Promise<ReviewerReply> {
    try {
      return await this.client.generateJsonDetailed(prompt);
    } catch (error) {
      if ((error as Error)?.message === 'Cloudflare reply is not valid JSON')
        throw new ReviewerOutputError((error as Error).message);
      throw error;
    }
  }
}

export class GeminiReviewer implements AnswerReviewer {
  readonly name = 'gemini' as const;
  readonly supportsImages = true;
  constructor(
    private readonly credentials: GeminiCredentialManager,
    private readonly router: GeminiModelRouter,
  ) {}
  configured() {
    return this.credentials.hasCredentials();
  }
  model() {
    return this.router.selectModel(AiTaskType.STRUCTURED_AUTHORING).model;
  }
  vendor() {
    return 'google';
  }
  async reviewJson(
    prompt: ReviewPrompt,
    image?: ReviewerImage,
  ): Promise<ReviewerReply> {
    const taskType = image
      ? AiTaskType.IMAGE_SEMANTIC_VALIDATION
      : AiTaskType.STRUCTURED_AUTHORING;
    let model = this.router.selectModel(taskType).model;
    const result = await this.credentials.execute({
      taskType,
      timeoutMs: GEMINI_REVIEW_TIMEOUT_MS,
      operation: (generative, signal) => {
        model = String(generative.model ?? model).replace(/^models\//, '');
        return generative.generateContent(
          {
            systemInstruction: prompt.systemInstruction,
            contents: [
              {
                role: 'user',
                parts: [
                  ...(image
                    ? [
                        {
                          inlineData: {
                            data: image.buffer.toString('base64'),
                            mimeType: image.mimeType,
                          },
                        },
                      ]
                    : []),
                  { text: prompt.prompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: prompt.schema as never,
              temperature: prompt.temperature,
            },
          },
          { signal },
        );
      },
    });
    const usage = result.response?.usageMetadata;
    return {
      data: parseJson(result.response.text(), 'Gemini'),
      model,
      usage: usage
        ? {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
          }
        : undefined,
    };
  }
}

/**
 * Any server speaking the OpenAI chat-completions API (Ollama, LM Studio,
 * vLLM, a paid provider). Its model vendor must be declared in
 * AI_COMPAT_MODEL_VENDOR; without it the reviewer is never independent.
 */
export class OpenAiCompatibleReviewer implements AnswerReviewer {
  readonly name = 'openai-compatible' as const;
  readonly supportsImages = false;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  configured() {
    return Boolean(
      process.env.AI_COMPAT_BASE_URL?.trim() &&
      process.env.AI_COMPAT_MODEL?.trim(),
    );
  }
  model() {
    return process.env.AI_COMPAT_MODEL?.trim() || '';
  }
  vendor() {
    return vendorOfModel(
      'openai-compatible',
      this.model(),
      process.env.AI_COMPAT_MODEL_VENDOR,
    );
  }
  async reviewJson(prompt: ReviewPrompt): Promise<ReviewerReply> {
    const base = (process.env.AI_COMPAT_BASE_URL ?? '')
      .trim()
      .replace(/\/$/, '');
    const key = process.env.AI_COMPAT_API_KEY?.trim();
    // Strict structured output never returns schema-invalid JSON (Groq);
    // AI_COMPAT_STRICT_SCHEMA=false falls back to best effort for servers
    // without it.
    const strict = process.env.AI_COMPAT_STRICT_SCHEMA?.trim() !== 'false';
    const effort = process.env.AI_COMPAT_REASONING_EFFORT?.trim();
    const includeReasoning = process.env.AI_COMPAT_INCLUDE_REASONING?.trim();
    const response = await this.fetchImpl(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: this.model(),
        messages: [
          { role: 'system', content: prompt.systemInstruction },
          { role: 'user', content: prompt.prompt },
        ],
        temperature: prompt.temperature,
        response_format: {
          type: 'json_schema',
          json_schema: strict
            ? {
                name: 'review',
                strict: true,
                schema: strictJsonSchema(prompt.schema),
              }
            : { name: 'review', schema: prompt.schema },
        },
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(includeReasoning === 'false' ? { include_reasoning: false } : {}),
      }),
      signal: AbortSignal.timeout(OPENAI_COMPAT_TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = new Error(
        `OpenAI-compatible endpoint HTTP ${response.status}`,
      ) as Error & { status?: number; retryAfterSeconds?: number };
      error.status = response.status;
      // Only a present header counts: Number(null) would read as "retry now".
      const header = response.headers?.get?.('retry-after')?.trim();
      const retryAfter = header ? Number(header) : NaN;
      if (Number.isFinite(retryAfter) && retryAfter >= 0)
        error.retryAfterSeconds = retryAfter;
      throw error;
    }
    const payload: any = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string')
      throw new ReviewerOutputError('OpenAI-compatible reply has no content');
    return {
      data: parseJson(content, 'OpenAI-compatible'),
      model: String(payload?.model ?? this.model()),
      usage: payload?.usage
        ? {
            inputTokens: payload.usage.prompt_tokens,
            outputTokens: payload.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
