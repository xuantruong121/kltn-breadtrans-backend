import { HttpException, NotFoundException } from '@nestjs/common';

import { isMissingStorageError } from '../speaking/speaking.constants';

/**
 * A question whose audio object is missing from storage answers 404, not a
 * 500 "server error": the learner sees that the clip is unavailable and the
 * logs stop reporting a crash. Errors that are already HTTP answers, and any
 * other failure, pass through unchanged.
 */
export function asMissingQuestionAudio(error: unknown): unknown {
  if (!(error instanceof HttpException) && isMissingStorageError(error))
    return new NotFoundException('Chưa có tệp audio cho câu hỏi này.');
  return error;
}
