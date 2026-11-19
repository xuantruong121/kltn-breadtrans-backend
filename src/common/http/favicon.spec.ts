import type { INestApplication } from '@nestjs/common';
import { answerFavicon, noFavicon } from './favicon';

describe('favicon', () => {
  it('answers 204 with no body', () => {
    const end = jest.fn();
    const status = jest.fn(() => ({ end }));
    noFavicon({}, { status });
    expect(status).toHaveBeenCalledWith(204);
    expect(end).toHaveBeenCalledWith();
  });

  it('is mounted on /favicon.ico only', () => {
    const use = jest.fn();
    answerFavicon({ use } as unknown as INestApplication);
    expect(use).toHaveBeenCalledWith('/favicon.ico', noFavicon);
  });
});
