import { UserService } from './user.service';

/**
 * PATCH /users/profile with only the avatar (owner 2026-11-17: the avatar is
 * saved as soon as it is picked). The DTO arrives with fullName: undefined;
 * the upsert's create branch must still carry a name, or Prisma rejects the
 * whole call (500), even for a learner who already has a profile.
 */
describe('UserService.updateUserProfile', () => {
  const build = () => {
    const upsert = jest.fn().mockResolvedValue({ userId: 5 });
    const service = Object.create(UserService.prototype) as UserService;
    (service as unknown as { prisma: unknown }).prisma = {
      profile: { upsert },
    };
    return { service, upsert };
  };

  it('keeps a fallback name in the create branch when only the avatar is sent', async () => {
    const { service, upsert } = build();
    await service.updateUserProfile(5, {
      fullName: undefined,
      avatar: 'data:image/jpeg;base64,AA',
    });
    const args = upsert.mock.calls[0][0];
    expect(args.create).toMatchObject({
      userId: 5,
      fullName: 'User',
      avatar: 'data:image/jpeg;base64,AA',
    });
    expect(args.update).toMatchObject({ avatar: 'data:image/jpeg;base64,AA' });
    expect(args.update.fullName).toBeUndefined();
  });

  it('uses the sent name when there is one', async () => {
    const { service, upsert } = build();
    await service.updateUserProfile(5, { fullName: 'Lan' });
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      userId: 5,
      fullName: 'Lan',
    });
  });
});

/** PATCH /users/cosmetics (owner 2026-11-19): only owned shop items, null takes off. */
describe('UserService.updateCosmetics', () => {
  const build = (orderSlugs: string[]) => {
    const upsert = jest.fn().mockResolvedValue({ userId: 5 });
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { items: orderSlugs.map((slug) => ({ slug, quantity: 1 })) },
      ]);
    const service = Object.create(UserService.prototype) as UserService;
    (service as unknown as { prisma: unknown }).prisma = {
      profile: { upsert },
      marketOrder: { findMany },
    };
    return { service, upsert, findMany };
  };

  it('wears an owned frame', async () => {
    const { service, upsert } = build(['frame-crown']);
    await service.updateCosmetics(5, { avatarFrame: 'frame-crown' });
    expect(upsert.mock.calls[0][0].update).toEqual({
      avatarFrame: 'frame-crown',
    });
  });

  it('refuses an item the learner has no order for', async () => {
    const { service, upsert } = build(['frame-crown']);
    await expect(
      service.updateCosmetics(5, { badgeKey: 'badge-star' }),
    ).rejects.toThrow(/chưa sở hữu/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('takes an item off without looking at orders', async () => {
    const { service, upsert, findMany } = build([]);
    await service.updateCosmetics(5, { avatarFrame: null, badgeKey: null });
    expect(findMany).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0][0].update).toEqual({
      avatarFrame: null,
      badgeKey: null,
    });
  });
});
