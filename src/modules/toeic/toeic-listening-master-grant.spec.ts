import { ForbiddenException } from '@nestjs/common';
import { AttemptStatus } from '@prisma/client';

import { getJwtSecret } from '../auth/auth.constants';
import {
  LISTENING_MASTER_GRANT_TTL_SECONDS,
  listeningMasterFor,
  signListeningMasterGrant,
  verifyListeningMasterGrant,
} from './toeic-listening-master';
import { ToeicController } from './toeic.controller';
import { ToeicService } from './toeic.service';

/**
 * The local Listening master is the exam's whole Listening section. Its
 * stream (GET /toeic/listening-master/:examId/audio) is an <audio src>, so it
 * is gated by a grant that only the attempt-scoped master route issues.
 */
describe('TOEIC Listening master grant', () => {
  const secret = 'test-secret';
  const now = Date.UTC(2026, 9, 29, 12);
  const grant = signListeningMasterGrant(
    { examId: 1, attemptId: 7, userId: 3 },
    secret,
    now,
  );

  it('accepts a fresh grant for the same exam', () => {
    expect(verifyListeningMasterGrant(grant, 1, secret, now)).toBe(true);
  });

  it('refuses a missing, malformed, tampered or foreign-secret grant', () => {
    expect(verifyListeningMasterGrant(undefined, 1, secret, now)).toBe(false);
    expect(verifyListeningMasterGrant('', 1, secret, now)).toBe(false);
    expect(verifyListeningMasterGrant('1.7.3.9', 1, secret, now)).toBe(false);
    const tampered = grant.replace(/^1\.7\.3\./, '1.8.3.');
    expect(verifyListeningMasterGrant(tampered, 1, secret, now)).toBe(false);
    expect(verifyListeningMasterGrant(grant, 1, 'other', now)).toBe(false);
  });

  it('refuses a grant for another exam', () => {
    expect(verifyListeningMasterGrant(grant, 2, secret, now)).toBe(false);
  });

  it('expires', () => {
    const later = now + LISTENING_MASTER_GRANT_TTL_SECONDS * 1000 + 1000;
    expect(verifyListeningMasterGrant(grant, 1, secret, later)).toBe(false);
  });

  describe('stream route', () => {
    const make = () => {
      const service = { localMasterFile: jest.fn(() => '/tmp/master.mp3') };
      const controller = new ToeicController(service as any);
      const res: any = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        setHeader: jest.fn(),
        sendFile: jest.fn(),
      };
      return { service, controller, res };
    };

    it('anonymous request without a grant gets 404 and no file', () => {
      const { service, controller, res } = make();
      controller.getLocalListeningMaster(1, undefined, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.sendFile).not.toHaveBeenCalled();
      expect(service.localMasterFile).not.toHaveBeenCalled();
    });

    it('a forged grant gets 404', () => {
      const { controller, res } = make();
      controller.getLocalListeningMaster(1, '1.7.3.9999999999.forged', res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('a valid grant streams the verified file, privately cached', () => {
      const { controller, res } = make();
      const valid = signListeningMasterGrant(
        { examId: 1, attemptId: 7, userId: 3 },
        getJwtSecret(),
      );
      controller.getLocalListeningMaster(1, valid, res);
      expect(res.sendFile).toHaveBeenCalledWith('/tmp/master.mp3', {
        acceptRanges: true,
      });
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=3600',
      );
    });
  });

  describe('attempt-scoped master route issues the grant', () => {
    const master = listeningMasterFor(1)!;
    const groupIds = master.timeline
      .filter((s) => s.kind === 'GROUP')
      .map((s) => s.groupId!);

    const make = (attempt: Record<string, unknown>) => {
      const prisma: any = {
        toeicAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
      };
      const service: any = new ToeicService(prisma, {} as any);
      service.getListeningManifestGroupIds = jest
        .fn()
        .mockResolvedValue(groupIds);
      service.localMasterFile = jest.fn(() => '/tmp/master.mp3');
      // No network: the published-object probe is a HEAD request.
      service.isPublished = jest.fn().mockResolvedValue(false);
      return service;
    };

    it('the owner of an active attempt receives a grant path', async () => {
      const service = make({
        userId: 3,
        examId: 1,
        status: AttemptStatus.IN_PROGRESS,
        section: null,
      });
      const out = await service.getListeningMaster(7, 3);
      expect(out.available).toBe(true);
      const token = new URL(`http://x${out.path}`).searchParams.get('grant');
      expect(out.path).toMatch(/^\/toeic\/listening-master\/1\/audio\?grant=/);
      expect(verifyListeningMasterGrant(token, 1, getJwtSecret())).toBe(true);
    });

    it('a published master is still served by its URL, without a grant', async () => {
      const service = make({
        userId: 3,
        examId: 1,
        status: AttemptStatus.IN_PROGRESS,
        section: null,
      });
      service.isPublished.mockResolvedValue(true);
      const previous = process.env.TOEIC_LISTENING_MASTER_BASE_URL;
      process.env.TOEIC_LISTENING_MASTER_BASE_URL = 'https://media.test';
      try {
        const out = await service.getListeningMaster(7, 3);
        expect(out).toMatchObject({
          available: true,
          url: `https://media.test/${master.key}`,
          path: null,
        });
      } finally {
        if (previous === undefined)
          delete process.env.TOEIC_LISTENING_MASTER_BASE_URL;
        else process.env.TOEIC_LISTENING_MASTER_BASE_URL = previous;
      }
    });

    it('the owner of a submitted attempt can replay it in review', async () => {
      const service = make({
        userId: 3,
        examId: 1,
        status: AttemptStatus.SUBMITTED,
        section: null,
      });
      expect((await service.getListeningMaster(7, 3)).available).toBe(true);
    });

    it('another learner is refused', async () => {
      const service = make({
        userId: 3,
        examId: 1,
        status: AttemptStatus.IN_PROGRESS,
        section: null,
      });
      await expect(service.getListeningMaster(7, 4)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('a not-yet-begun attempt gets no grant', async () => {
      const service = make({
        userId: 3,
        examId: 1,
        status: AttemptStatus.PENDING_START,
        section: null,
      });
      expect(await service.getListeningMaster(7, 3)).toEqual({
        available: false,
        reason: 'NOT_IN_PROGRESS',
      });
    });
  });
});
