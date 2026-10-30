import { BadRequestException } from '@nestjs/common';
import { AttemptMode, AttemptStatus } from '@prisma/client';
import { PassThrough, Readable } from 'node:stream';

import { R2Service } from '../upload/r2.service';
import { GenericExamService } from './generic-exam.service';
import {
  listeningMasterFor,
  privateListeningMasterKey,
} from './toeic-listening-master';
import { ToeicController } from './toeic.controller';
import { ToeicService } from './toeic.service';

/**
 * Exam Listening media read from the private bucket by key (P04): the clip
 * proxy, the master stream and the admin player. No real storage: the S3
 * client and the upload service are mocks.
 */
const CLIP_KEY = 'premium/listening/toeic/exams/1/groups/2.mp3';

describe('R2Service.openPrivateObject', () => {
  const make = () => {
    const env = {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'public-key',
      R2_SECRET_ACCESS_KEY: 'public-secret',
      R2_BUCKET_NAME: 'public-bucket',
      R2_PRIVATE_BUCKET_NAME: 'private-bucket',
      R2_PRIVATE_ENDPOINT: 'http://127.0.0.1:9',
      R2_PRIVATE_ACCESS_KEY_ID: 'private-key',
      R2_PRIVATE_SECRET_ACCESS_KEY: 'private-secret',
    };
    const previous = Object.fromEntries(
      Object.keys(env).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, env);
    const service = new R2Service();
    Object.assign(process.env, previous);
    const send = jest.fn();
    (service as any).privateClient.send = send;
    return { service, send };
  };

  it('forwards a byte range and reports 206 with the range headers', async () => {
    const { service, send } = make();
    send.mockResolvedValue({
      Body: Readable.from(['abc']),
      ContentLength: 3,
      ContentRange: 'bytes 0-2/10',
      ContentType: 'audio/mpeg',
    });
    const out = await service.openPrivateObject(CLIP_KEY, 'bytes=0-2');
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: 'private-bucket',
      Key: CLIP_KEY,
      Range: 'bytes=0-2',
    });
    expect(out).toMatchObject({
      status: 206,
      contentLength: 3,
      contentRange: 'bytes 0-2/10',
    });
  });

  it('a whole-object read is 200; a malformed range is not forwarded', async () => {
    const { service, send } = make();
    send.mockResolvedValue({ Body: Readable.from(['abc']), ContentLength: 3 });
    const out = await service.openPrivateObject(CLIP_KEY, 'bytes=0-1\r\nX: y');
    expect(send.mock.calls[0][0].input.Range).toBeUndefined();
    expect(out?.status).toBe(200);
  });

  it('a missing object is null; a public key is refused', async () => {
    const { service, send } = make();
    send.mockRejectedValue(
      Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }),
    );
    expect(await service.openPrivateObject(CLIP_KEY)).toBeNull();
    await expect(
      service.openPrivateObject('toeic/exams/1/groups/2.mp3'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ToeicService private exam media', () => {
  const master = listeningMasterFor(1)!;

  const make = (upload: Record<string, jest.Mock> | undefined) => {
    const prisma: any = {
      toeicQuestionGroup: { findUnique: jest.fn() },
      toeicAttempt: { findUnique: jest.fn() },
    };
    const service: any = new ToeicService(
      prisma,
      {} as any,
      undefined,
      upload as any,
    );
    service.localMasterFile = jest.fn(() => null);
    service.isPublished = jest.fn().mockResolvedValue(true);
    return { service, prisma };
  };

  it('the master is served from the private bucket once it is there', async () => {
    const upload = { privateObjectExists: jest.fn().mockResolvedValue(true) };
    const { service } = make(upload);
    expect(await service.listeningMasterSource(1)).toEqual({
      privateKey: privateListeningMasterKey(master),
    });
    expect(privateListeningMasterKey(master)).toBe(
      'premium/listening/toeic/exam-1/listening-master/55065e0dfc19f3e5.v1.mp3',
    );
    expect(service.isPublished).not.toHaveBeenCalled();
  });

  it('falls back to the legacy published object until it is migrated', async () => {
    const upload = { privateObjectExists: jest.fn().mockResolvedValue(false) };
    const { service } = make(upload);
    const previous = process.env.TOEIC_LISTENING_MASTER_BASE_URL;
    process.env.TOEIC_LISTENING_MASTER_BASE_URL = 'https://media.test';
    try {
      expect(await service.listeningMasterSource(1)).toEqual({
        url: `https://media.test/${master.key}`,
      });
    } finally {
      process.env.TOEIC_LISTENING_MASTER_BASE_URL = previous;
    }
  });

  it('without private storage it never claims a private copy', async () => {
    const { service } = make(undefined);
    expect(await service.isPrivatelyStored('premium/listening/x.mp3')).toBe(
      false,
    );
  });

  it('a migrated clip is read from the private bucket, never fetched', async () => {
    const upload = {
      downloadPrivateFileBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from('mp3')),
    };
    const { service, prisma } = make(upload);
    prisma.toeicQuestionGroup.findUnique.mockResolvedValue({
      id: 2,
      examId: 1,
      part: 1,
      audioUrl: CLIP_KEY,
      transcriptText: 'x',
      canonicalAccent: 'US',
    });
    prisma.toeicAttempt.findUnique.mockResolvedValue({
      userId: 3,
      examId: 1,
      status: AttemptStatus.IN_PROGRESS,
      mode: AttemptMode.PRACTICE,
      section: null,
      listeningPosition: 0,
    });
    const fetchSpy = jest.spyOn(global, 'fetch');
    const buffer = await service.generateGroupAudio(2, 3, 7);
    expect(buffer.toString()).toBe('mp3');
    expect(upload.downloadPrivateFileBuffer).toHaveBeenCalledWith(CLIP_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('master stream route, private source', () => {
  it('pipes the private object with its range status and headers', async () => {
    const service = {
      resolveListeningMasterStream: jest
        .fn()
        .mockResolvedValue({ privateKey: 'premium/listening/toeic/m.mp3' }),
      openPrivateMedia: jest.fn().mockResolvedValue({
        status: 206,
        body: Readable.from(['abc']),
        contentLength: 3,
        contentRange: 'bytes 0-2/10',
      }),
    };
    const controller = new ToeicController(service as any);
    const res: any = Object.assign(new PassThrough(), {
      status: jest.fn(() => res),
      json: jest.fn(() => res),
      setHeader: jest.fn(),
      sendFile: jest.fn(),
    });
    await controller.getLocalListeningMaster(
      1,
      'g',
      { headers: { range: 'bytes=0-2' } } as any,
      res,
    );
    const body: Buffer[] = [];
    for await (const chunk of res) body.push(Buffer.from(chunk));
    expect(service.openPrivateMedia).toHaveBeenCalledWith(
      'premium/listening/toeic/m.mp3',
      'bytes=0-2',
    );
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-2/10');
    expect(Buffer.concat(body).toString()).toBe('abc');
  });

  it('a missing private object is a 404', async () => {
    const service = {
      resolveListeningMasterStream: jest
        .fn()
        .mockResolvedValue({ privateKey: 'premium/listening/toeic/m.mp3' }),
      openPrivateMedia: jest.fn().mockResolvedValue(null),
    };
    const controller = new ToeicController(service as any);
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(() => res),
      setHeader: jest.fn(),
    };
    await controller.getLocalListeningMaster(
      1,
      'g',
      { headers: {} } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('admin exam view of migrated clips', () => {
  it('keeps the key in audioUrl and adds a signed audioPlaybackUrl', async () => {
    const service: any = Object.create(GenericExamService.prototype);
    service.uploadService = {
      getPrivatePresignedDownloadUrl: jest.fn().mockResolvedValue('signed-url'),
    };
    service.findExam = jest.fn().mockResolvedValue({});
    service.project = jest.fn(() => ({
      id: 4,
      groups: [
        { id: 2, audioUrl: CLIP_KEY },
        { id: 3, audioUrl: 'https://legacy/a.mp3' },
      ],
    }));
    const out = await service.getAdmin(4);
    expect(out.groups[0]).toEqual({
      id: 2,
      audioUrl: CLIP_KEY,
      audioPlaybackUrl: 'signed-url',
    });
    expect(out.groups[1]).toEqual({ id: 3, audioUrl: 'https://legacy/a.mp3' });
    expect(
      service.uploadService.getPrivatePresignedDownloadUrl,
    ).toHaveBeenCalledWith(CLIP_KEY, 3600);
  });
});

describe('AI exam audio regeneration', () => {
  it('writes the audio to the private bucket and stores the key', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ToeicAiExamService } = require('./toeic-ai-exam.service');
    const service: any = Object.create(ToeicAiExamService.prototype);
    service.editableDraft = jest
      .fn()
      .mockResolvedValue({ toeicExamSet: { id: 9 } });
    service.makeAudio = jest.fn().mockResolvedValue(Buffer.from('mp3'));
    const group = {
      id: 2,
      part: 1,
      canonicalAccent: 'US',
      transcriptText: null,
      passageText: null,
      mediaMetadata: {},
      questions: [
        {
          text: null,
          options: ['A man', 'A desk', 'A car', 'A door'],
          correctIndex: 0,
        },
      ],
    };
    service.prisma = {
      toeicQuestionGroup: {
        findFirst: jest.fn().mockResolvedValue(group),
        update: jest.fn((args: any) => args.data),
      },
    };
    service.r2 = {
      putPrivateObjectAtKey: jest.fn((key: string) =>
        Promise.resolve({ key, url: '', contentType: 'audio/mpeg' }),
      ),
      privateObjectExists: jest.fn().mockResolvedValue(true),
      putObjectAtKey: jest.fn(),
    };
    const data = await service.regenerateMedia(4, 2, 'audio');
    expect(service.r2.putObjectAtKey).not.toHaveBeenCalled();
    expect(service.r2.putPrivateObjectAtKey.mock.calls[0][0]).toBe(
      'premium/listening/toeic/exams/9/groups/2/audio-regenerated.mp3',
    );
    expect(data.audioUrl).toBe(
      'premium/listening/toeic/exams/9/groups/2/audio-regenerated.mp3',
    );
  });
});
