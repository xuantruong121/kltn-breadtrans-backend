import { ForbiddenException } from '@nestjs/common';
import { PassThrough } from 'node:stream';
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
    const make = (source: unknown) => {
      const service = {
        resolveListeningMasterStream: jest.fn().mockResolvedValue(source),
      };
      const controller = new ToeicController(service as any);
      const res: any = Object.assign(new PassThrough(), {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
        setHeader: jest.fn(),
        sendFile: jest.fn(),
      });
      const req: any = { headers: { range: 'bytes=0-1023' } };
      return { service, controller, res, req };
    };

    it('no usable grant or attempt: 404 and nothing streamed', async () => {
      const { service, controller, res, req } = make(null);
      await controller.getLocalListeningMaster(1, undefined, req, res);
      expect(service.resolveListeningMasterStream).toHaveBeenCalledWith(
        1,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('streams the verified local file, privately cached', async () => {
      const { controller, res, req } = make({ file: '/tmp/master.mp3' });
      await controller.getLocalListeningMaster(1, 'g', req, res);
      expect(res.sendFile).toHaveBeenCalledWith('/tmp/master.mp3', {
        acceptRanges: true,
      });
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=3600',
      );
    });

    it('proxies a published object with the byte range, hiding its URL', async () => {
      const { controller, res, req } = make({
        url: 'https://media.test/master.mp3',
      });
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response('abc', {
          status: 206,
          headers: { 'content-range': 'bytes 0-2/10', 'content-length': '3' },
        }),
      );
      try {
        await controller.getLocalListeningMaster(1, 'g', req, res);
        const body: Buffer[] = [];
        for await (const chunk of res) body.push(Buffer.from(chunk));
        expect(fetchMock).toHaveBeenCalledWith(
          'https://media.test/master.mp3',
          {
            headers: { Range: 'bytes=0-1023' },
          },
        );
        expect(res.status).toHaveBeenCalledWith(206);
        expect(res.setHeader).toHaveBeenCalledWith(
          'content-range',
          'bytes 0-2/10',
        );
        expect(Buffer.concat(body).toString()).toBe('abc');
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('does not forward a malformed Range header', async () => {
      const { controller, res, req } = make({
        url: 'https://media.test/master.mp3',
      });
      req.headers.range = 'bytes=0-1\r\nX: y';
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('abc', { status: 200 }));
      try {
        await controller.getLocalListeningMaster(1, 'g', req, res);
        expect(fetchMock).toHaveBeenCalledWith(
          'https://media.test/master.mp3',
          {
            headers: {},
          },
        );
      } finally {
        fetchMock.mockRestore();
      }
    });
  });

  describe('stream access is re-checked against the attempt', () => {
    const grantFor = (attemptId: number, userId: number, examId = 1) =>
      signListeningMasterGrant({ examId, attemptId, userId }, getJwtSecret());

    const make = (attempt: Record<string, unknown> | null) => {
      const prisma: any = {
        toeicAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
      };
      const service: any = new ToeicService(prisma, {} as any);
      service.localMasterFile = jest.fn(() => '/tmp/master.mp3');
      service.isPublished = jest.fn().mockResolvedValue(false);
      return { service, prisma };
    };
    const active = {
      userId: 3,
      examId: 1,
      status: AttemptStatus.IN_PROGRESS,
      section: null,
    };

    it('owner of an active attempt: streams', async () => {
      const { service } = make(active);
      expect(
        await service.resolveListeningMasterStream(1, grantFor(7, 3)),
      ).toEqual({ file: '/tmp/master.mp3' });
    });

    it('owner of a submitted attempt: streams (review replay)', async () => {
      const { service } = make({ ...active, status: AttemptStatus.SUBMITTED });
      expect(
        await service.resolveListeningMasterStream(1, grantFor(7, 3)),
      ).not.toBeNull();
    });

    it('no, forged or expired grant: refused before any lookup', async () => {
      const { service, prisma } = make(active);
      const expired = signListeningMasterGrant(
        { examId: 1, attemptId: 7, userId: 3 },
        getJwtSecret(),
        Date.now() - (LISTENING_MASTER_GRANT_TTL_SECONDS + 60) * 1000,
      );
      for (const grant of [undefined, '1.7.3.9999999999.forged', expired])
        expect(await service.resolveListeningMasterStream(1, grant)).toBeNull();
      expect(prisma.toeicAttempt.findUnique).not.toHaveBeenCalled();
    });

    it('grant for another exam: refused', async () => {
      const { service } = make(active);
      expect(
        await service.resolveListeningMasterStream(2, grantFor(7, 3)),
      ).toBeNull();
    });

    it("grant naming someone else's attempt: refused", async () => {
      const { service } = make({ ...active, userId: 4 });
      expect(
        await service.resolveListeningMasterStream(1, grantFor(7, 3)),
      ).toBeNull();
    });

    it('attempt gone, not begun or legacy strict: refused', async () => {
      for (const attempt of [
        null,
        { ...active, status: AttemptStatus.PENDING_START },
        { ...active, section: 'LISTENING' },
        { ...active, examId: 2 },
      ]) {
        const { service } = make(attempt);
        expect(
          await service.resolveListeningMasterStream(1, grantFor(7, 3)),
        ).toBeNull();
      }
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

    it('a published master is offered only through the API path', async () => {
      const service = make({
        userId: 3,
        examId: 1,
        status: AttemptStatus.IN_PROGRESS,
        section: null,
      });
      service.isPublished.mockResolvedValue(true);
      service.localMasterFile.mockReturnValue(null);
      const previous = process.env.TOEIC_LISTENING_MASTER_BASE_URL;
      process.env.TOEIC_LISTENING_MASTER_BASE_URL = 'https://media.test';
      try {
        const out = await service.getListeningMaster(7, 3);
        expect(out).toMatchObject({ available: true, url: null });
        expect(out.path).toMatch(
          /^\/toeic\/listening-master\/1\/audio\?grant=/,
        );
        expect(JSON.stringify(out)).not.toContain('media.test');
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
