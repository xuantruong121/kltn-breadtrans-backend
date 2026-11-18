import { NotFoundException } from '@nestjs/common';
import { notFoundIfGone } from './not-found-if-gone';

describe('notFoundIfGone', () => {
  it('a write on content deleted meanwhile (P2003) is "not found" with the message', async () => {
    await expect(
      notFoundIfGone(
        Promise.reject(Object.assign(new Error('fk'), { code: 'P2003' })),
        'Không tìm thấy chủ đề #4.',
      ),
    ).rejects.toThrow(new NotFoundException('Không tìm thấy chủ đề #4.'));
  });

  it('passes a result and any other error through', async () => {
    await expect(notFoundIfGone(Promise.resolve(7), 'x')).resolves.toBe(7);
    await expect(
      notFoundIfGone(Promise.reject(new Error('db down')), 'x'),
    ).rejects.toThrow('db down');
  });
});
