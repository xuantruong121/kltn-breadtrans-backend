import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { UpdateCosmeticsDto } from './dto/update-cosmetics.dto';
import { cosmeticsData, unownedCosmetic } from './profile-cosmetics.logic';

const orders = (...slugs: string[]) => [
  { items: slugs.map((slug) => ({ slug, quantity: 1 })) },
];

describe('profile cosmetics', () => {
  it('only the fields sent change; null takes an item off', () => {
    expect(cosmeticsData({ avatarFrame: 'frame-crown' })).toEqual({
      avatarFrame: 'frame-crown',
    });
    expect(cosmeticsData({ badgeKey: null })).toEqual({ badgeKey: null });
    expect(cosmeticsData({})).toEqual({});
  });

  it('wearing needs an owning order; taking off never does', () => {
    expect(
      unownedCosmetic({ avatarFrame: 'frame-crown' }, orders('frame-crown')),
    ).toBeNull();
    expect(
      unownedCosmetic(
        { avatarFrame: 'frame-crown', badgeKey: 'badge-star' },
        orders('frame-crown'),
      ),
    ).toBe('badge-star');
    expect(
      unownedCosmetic({ avatarFrame: null, badgeKey: null }, []),
    ).toBeNull();
  });

  it('accepts shop slugs and null, refuses anything else', async () => {
    const check = (body: object) =>
      validate(plainToInstance(UpdateCosmeticsDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    expect(
      await check({ avatarFrame: 'frame-cyber', badgeKey: 'badge-master' }),
    ).toHaveLength(0);
    expect(await check({ avatarFrame: null, badgeKey: null })).toHaveLength(0);
    expect(await check({ avatarFrame: 'frame-anything' })).not.toHaveLength(0);
    expect(await check({ badgeKey: 'Bước Đầu Tiên' })).not.toHaveLength(0);
    expect(await check({ avatar: 'x.png' })).not.toHaveLength(0);
  });
});
