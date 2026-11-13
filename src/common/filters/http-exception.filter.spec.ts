import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })) };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/speaking/1/submit' }),
    }),
  };
  new HttpExceptionFilter().catch(exception, host as never);
  return json.mock.calls[0][0] as Record<string, unknown>;
}

describe('HttpExceptionFilter', () => {
  it('keeps which plan ran out of AI gradings, for the notice (owner 2026-11-13)', () => {
    const body = run(
      new HttpException(
        {
          statusCode: 429,
          error: 'AI_QUOTA_EXHAUSTED',
          message: 'Bạn đã dùng hết 10 lượt AI chấm của hôm nay (gói Free).',
          limit: 10,
          currentUsage: 11,
          planCode: 'FREE',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
    expect(body).toMatchObject({
      statusCode: 429,
      error: 'AI_QUOTA_EXHAUSTED',
      quota: { limit: 10, planCode: 'FREE' },
    });
    expect(body).not.toHaveProperty('currentUsage');
  });

  it('adds nothing to other errors', () => {
    const body = run(new HttpException('Không tìm thấy', HttpStatus.NOT_FOUND));
    expect(body).not.toHaveProperty('quota');
  });
});
