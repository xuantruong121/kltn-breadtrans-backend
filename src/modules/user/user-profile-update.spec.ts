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
