import { hasVietnameseDiacritics } from './diagnostic-productive';

describe('Vietnamese feedback diacritics', () => {
  it('accepts marked Vietnamese and refuses the unaccented reply seen in production', () => {
    expect(hasVietnameseDiacritics('Bài viết của bạn rất xuất sắc.')).toBe(
      true,
    );
    expect(
      hasVietnameseDiacritics(
        'Chao ban, bai viet cua ban rat xuat sac, dat yeu cau ve ca noi dung lan hinh thuc.',
      ),
    ).toBe(false);
  });
});
