import { Injectable, Logger } from '@nestjs/common';
import { isGeminiOutage } from './gemini/gemini-credential-manager.service';
import type { ReviewUsage } from './review/answer-reviewer';
import { strictJsonSchema } from './review/strict-json-schema';

const DEFAULT_TEXT_MODEL = '@cf/openai/gpt-oss-120b';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const TEXT_TIMEOUT_MS = 180_000;
const IMAGE_TIMEOUT_MS = 60_000;

export const CLOUDFLARE_UNAVAILABLE = 'CLOUDFLARE_UNAVAILABLE';

function unavailable(message: string) {
  const error = new Error(`Cloudflare Workers AI: ${message}`);
  (error as Error & { code?: string }).code = CLOUDFLARE_UNAVAILABLE;
  return error;
}

/** Every provider failed, so retrying the same request now cannot help. */
export function isAiOutage(error: unknown) {
  return (
    (error as { code?: string })?.code === CLOUDFLARE_UNAVAILABLE ||
    isGeminiOutage(error)
  );
}

/** Models differ in where they put the answer. */
export function cloudflareAnswerText(result: any): string {
  const answer =
    result?.response ?? result?.choices?.[0]?.message?.content ?? null;
  if (answer === null) throw new Error('Cloudflare trả về câu trả lời rỗng');
  return typeof answer === 'string' ? answer : JSON.stringify(answer);
}

/**
 * Text of a Responses-format result: the `output_text` part of the message
 * item (the reasoning item comes first and is skipped).
 */
export function cloudflareResponsesText(result: any): string {
  if (typeof result?.output_text === 'string') return result.output_text;
  for (const item of result?.output ?? [])
    for (const part of item?.content ?? [])
      if (part?.type === 'output_text' && typeof part.text === 'string')
        return part.text;
  throw new Error('Cloudflare trả về câu trả lời rỗng');
}

/**
 * Token counts and Neurons from a Workers AI result. Chat-completion replies
 * name tokens prompt_tokens / completion_tokens, Responses-format replies
 * input_tokens / output_tokens; both carry the billed `neurons` (seen live on
 * 2026-11-04 for @cf/openai/gpt-oss-120b).
 */
export function cloudflareUsage(result: any): ReviewUsage | undefined {
  const usage = result?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens =
    Number(usage.prompt_tokens ?? usage.input_tokens) || undefined;
  const outputTokens =
    Number(usage.completion_tokens ?? usage.output_tokens) || undefined;
  const neurons = Number(usage.neurons) || undefined;
  return inputTokens || outputTokens || neurons
    ? { inputTokens, outputTokens, ...(neurons ? { neurons } : {}) }
    : undefined;
}

const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

/**
 * CLOUDFLARE_AI_REASONING_EFFORT, when set to low|medium|high. Workers AI
 * takes a reasoning effort only in the Responses format, so setting it also
 * switches the request to that format. Unset keeps the chat format.
 */
export function cloudflareReasoningEffort():
  (typeof REASONING_EFFORTS)[number] | null {
  const value =
    process.env.CLOUDFLARE_AI_REASONING_EFFORT?.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(value ?? '')
    ? (value as (typeof REASONING_EFFORTS)[number])
    : null;
}

/**
 * The stand-in when Gemini is out of quota or down. Called over REST so it adds
 * no dependency. Nothing it returns is trusted more than Gemini output: the
 * same contract checks run on it afterwards.
 */
@Injectable()
export class CloudflareWorkersAiClient {
  private readonly logger = new Logger(CloudflareWorkersAiClient.name);

  configured() {
    return Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      process.env.CLOUDFLARE_AI_API_TOKEN?.trim(),
    );
  }

  private async run(model: string, body: unknown, timeoutMs: number) {
    const base =
      process.env.CLOUDFLARE_AI_BASE_URL?.trim() ||
      'https://api.cloudflare.com/client/v4';
    let response: Response;
    try {
      response = await fetch(
        `${base}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID?.trim()}/ai/run/${model}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${process.env.CLOUDFLARE_AI_API_TOKEN?.trim()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (error) {
      throw unavailable(
        error instanceof Error ? error.message : 'không gọi được dịch vụ',
      );
    }
    const payload: any = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const reason = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
      this.logger.warn(`cloudflare_ai_failed model=${model}: ${reason}`);
      throw unavailable(String(reason));
    }
    return payload?.result;
  }

  async generateJson<T>(input: {
    systemInstruction: string;
    prompt: string;
    schema: unknown;
    temperature: number;
  }): Promise<T> {
    const result = await this.run(
      process.env.CLOUDFLARE_AI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
      {
        messages: [
          { role: 'system', content: input.systemInstruction },
          { role: 'user', content: input.prompt },
        ],
        response_format: { type: 'json_schema', json_schema: input.schema },
        temperature: input.temperature,
        max_tokens: 8000,
      },
      TEXT_TIMEOUT_MS,
    );
    return JSON.parse(cloudflareAnswerText(result)) as T;
  }

  /** The configured text model id, e.g. @cf/openai/gpt-oss-120b. */
  textModel() {
    return process.env.CLOUDFLARE_AI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  }

  /**
   * Like generateJson, but returns the raw answer and token usage so the
   * caller can validate the reply itself and count cost. A reply that is not
   * JSON throws a plain Error (not an outage).
   */
  async generateJsonDetailed(input: {
    systemInstruction: string;
    prompt: string;
    schema: unknown;
    temperature: number;
    maxTokens?: number;
  }): Promise<{
    data: unknown;
    model: string;
    usage?: ReviewUsage;
  }> {
    const model = this.textModel();
    const effort = cloudflareReasoningEffort();
    const messages = [
      { role: 'system', content: input.systemInstruction },
      { role: 'user', content: input.prompt },
    ];
    const result = await this.run(
      model,
      effort
        ? {
            input: messages,
            reasoning: { effort },
            text: {
              format: {
                type: 'json_schema',
                name: 'review',
                strict: true,
                schema: strictJsonSchema(
                  input.schema as Record<string, unknown>,
                ),
              },
            },
            temperature: input.temperature,
            max_output_tokens: input.maxTokens ?? 8000,
          }
        : {
            messages,
            response_format: { type: 'json_schema', json_schema: input.schema },
            temperature: input.temperature,
            max_tokens: input.maxTokens ?? 8000,
          },
      TEXT_TIMEOUT_MS,
    );
    const usage = cloudflareUsage(result);
    let data: unknown;
    try {
      data = JSON.parse(
        effort ? cloudflareResponsesText(result) : cloudflareAnswerText(result),
      );
    } catch {
      throw new Error('Cloudflare reply is not valid JSON');
    }
    return { data, model, usage };
  }

  async generateImage(
    prompt: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const result = await this.run(
      process.env.CLOUDFLARE_AI_IMAGE_MODEL?.trim() || IMAGE_MODEL,
      { prompt, steps: 4 },
      IMAGE_TIMEOUT_MS,
    );
    if (typeof result?.image !== 'string' || !result.image)
      throw unavailable('không trả về ảnh');
    return {
      buffer: Buffer.from(result.image, 'base64'),
      mimeType: 'image/jpeg',
    };
  }
}
