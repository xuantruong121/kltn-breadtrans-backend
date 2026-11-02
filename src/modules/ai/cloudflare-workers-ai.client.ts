import { Injectable, Logger } from '@nestjs/common';
import { isGeminiOutage } from './gemini/gemini-credential-manager.service';

const DEFAULT_TEXT_MODEL = '@cf/openai/gpt-oss-120b';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const TEXT_TIMEOUT_MS = 120_000;
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
      const reason =
        payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
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
