import { createHash } from 'crypto';

export type ToeicMediaKind = 'image' | 'audio';

export type ToeicMediaFailureCode = 'PROVIDER_UNAVAILABLE' | 'INVALID_MEDIA';

export function toeicMediaHash(value: string | null | undefined) {
  return createHash('sha256')
    .update(value ?? '')
    .digest('hex');
}

export function mediaFailureCode(error: unknown): ToeicMediaFailureCode {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return /429|quota|rate.?limit|timeout|unavailable|provider|network|econn|5\d\d/.test(
    message,
  )
    ? 'PROVIDER_UNAVAILABLE'
    : 'INVALID_MEDIA';
}

export function withMediaFailure(
  metadata: Record<string, any>,
  kind: ToeicMediaKind,
  error: unknown,
  sourceHash: string,
) {
  const current = metadata[kind] ?? {};
  return {
    ...metadata,
    [kind]: {
      ...current,
      source: 'AI_GENERATED',
      status: 'FAILED',
      errorCode: mediaFailureCode(error),
      failedAt: new Date().toISOString(),
      ...(kind === 'image'
        ? { briefHash: sourceHash }
        : { transcriptHash: sourceHash }),
    },
  };
}

export function withManualMedia(
  metadata: Record<string, any>,
  kind: ToeicMediaKind,
  sourceHash: string,
) {
  return {
    ...metadata,
    [kind]: {
      source: 'ADMIN_UPLOADED',
      status: 'READY',
      uploadedAt: new Date().toISOString(),
      ...(kind === 'image'
        ? { briefHash: sourceHash }
        : { transcriptHash: sourceHash }),
    },
  };
}

export function mediaRetryMessage(kind: ToeicMediaKind) {
  return kind === 'image'
    ? 'Dịch vụ tạo ảnh AI hiện chưa khả dụng. Bạn có thể thử lại riêng ảnh này hoặc tải ảnh lên thủ công.'
    : 'Dịch vụ tạo audio AI hiện chưa khả dụng. Bạn có thể thử lại riêng audio này hoặc tải tệp lên thủ công.';
}
