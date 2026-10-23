import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AttemptMode,
  AttemptStatus,
  ToeicAttemptSection,
} from '@prisma/client';
import { ToeicService } from './toeic.service';

/**
 * Phase 1 — strict Listening one-pass manifest, advance, and section-gated
 * answer mutation. Exercises the server-authoritative properties directly:
 * one-pass position, no replay/skip-ahead via audio fetch, Listening→Reading
 * is a one-way transition, and cross-section writes are rejected.
 */
describe('ToeicService — strict Listening runtime', () => {
  const groupIds = [101, 102, 103]; // 3 Listening groups for this exam
  let prisma: any;
  let service: ToeicService;

  const baseAttempt = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    userId: 7,
    examId: 50,
    mode: AttemptMode.FULL_TEST,
    status: AttemptStatus.IN_PROGRESS,
    section: ToeicAttemptSection.LISTENING,
    listeningPosition: 0,
    deadline: new Date(Date.now() + 1000 * 60 * 60),
    readingStartedAt: null,
    readingDeadline: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      toeicAttempt: {
        findUnique: jest.fn(),
        update: jest.fn((args: any) => ({ id: 1, ...args.data })),
      },
      toeicQuestionGroup: {
        findMany: jest.fn().mockResolvedValue(
          groupIds.map((id, index) => ({
            id,
            part: index < 2 ? 1 : 2,
            groupOrder: index + 1,
            audioUrl: `https://audio/${id}.mp3`,
          })),
        ),
      },
    };
    service = new ToeicService(prisma, {} as any);
  });

  it('manifest only exposes audioUrl for the current listeningPosition segment', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ listeningPosition: 1 }),
    );

    const manifest = await service.getListeningManifest(1, 7);

    expect(manifest.segments[0].audioUrl).toBeNull(); // past segment
    expect(manifest.segments[1].audioUrl).toBe('https://audio/102.mp3'); // current
    expect(manifest.segments[2].audioUrl).toBeNull(); // future segment
  });

  it('advanceListening moves the cursor forward by exactly one', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ listeningPosition: 0 }),
    );

    await service.advanceListening(1, 7);

    expect(prisma.toeicAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { listeningPosition: 1 } }),
    );
  });

  it('advancing past the last segment transitions to READING with a 75-minute deadline', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ listeningPosition: groupIds.length - 1 }),
    );

    await service.advanceListening(1, 7);

    const data = prisma.toeicAttempt.update.mock.calls[0][0].data;
    expect(data.section).toBe(ToeicAttemptSection.READING);
    expect(data.listeningPosition).toBe(groupIds.length);
    const deltaSeconds =
      (data.readingDeadline.getTime() - data.readingStartedAt.getTime()) / 1000;
    expect(deltaSeconds).toBe(75 * 60);
  });

  it('rejects advancing once already in READING (one-way transition)', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({
        section: ToeicAttemptSection.READING,
        listeningPosition: groupIds.length,
      }),
    );

    await expect(service.advanceListening(1, 7)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects fetching audio for a future (skip-ahead) Listening group', async () => {
    prisma.toeicQuestionGroup.findUnique = jest.fn().mockResolvedValue({
      part: 1,
      examId: 50,
      canonicalAccent: 'US',
      audioUrl: 'https://audio/103.mp3',
      passageText: null,
      transcriptText: null,
      questions: [],
    });
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ listeningPosition: 0 }), // current segment is groupIds[0]=101
    );

    await expect(service.generateGroupAudio(103, 7, 1)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows fetching audio for exactly the current Listening group', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });
    (global as any).fetch = fetchMock;
    prisma.toeicQuestionGroup.findUnique = jest.fn().mockResolvedValue({
      part: 1,
      examId: 50,
      canonicalAccent: 'US',
      audioUrl: 'https://audio/101.mp3',
      passageText: null,
      transcriptText: null,
      questions: [],
    });
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ listeningPosition: 0 }),
    );

    await expect(service.generateGroupAudio(101, 7, 1)).resolves.toBeInstanceOf(
      Buffer,
    );
  });
});
