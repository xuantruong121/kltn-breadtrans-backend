import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { asMissingQuestionAudio } from './question-audio-errors';

describe('asMissingQuestionAudio', () => {
  it('turns a missing storage object into a 404', () => {
    const missing = Object.assign(new Error('UnknownError'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    const mapped = asMissingQuestionAudio(missing);
    expect(mapped).toBeInstanceOf(NotFoundException);
    expect((mapped as NotFoundException).getStatus()).toBe(404);
  });

  it('keeps an HTTP answer as it is', () => {
    const refused = new ForbiddenException('Cần gói PLUS');
    expect(asMissingQuestionAudio(refused)).toBe(refused);
  });

  it('keeps any other failure, so it still reports a server error', () => {
    const broken = new Error('connect ECONNREFUSED');
    expect(asMissingQuestionAudio(broken)).toBe(broken);
  });
});
