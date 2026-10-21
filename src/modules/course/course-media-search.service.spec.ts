import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CourseMediaSearchService } from './course-media-search.service';
import { ImageSearchCandidateDto } from './course-media.dto';

const admin = { id: 1, role: Role.ADMIN };
const student = { id: 2, role: Role.STUDENT };

const candidate = (
  overrides: Partial<ImageSearchCandidateDto> = {},
): ImageSearchCandidateDto => ({
  provider: 'PIXABAY',
  providerAssetId: '123',
  previewUrl: 'https://images.pixabay.com/preview.jpg',
  downloadUrl: 'https://images.pixabay.com/large.jpg',
  sourcePageUrl: 'https://pixabay.com/photos/123',
  width: 800,
  height: 600,
  author: 'Someone',
  tags: ['greeting'],
  license: 'Pixabay Content License — human review required',
  ...overrides,
});

const downloaded = (overrides: Partial<Record<string, unknown>> = {}) => ({
  buffer: Buffer.from('fake-image-bytes'),
  mimeType: 'image/jpeg',
  width: 800,
  height: 600,
  ...overrides,
});

const diag = (
  candidates: ImageSearchCandidateDto[],
  attempted: Array<{ provider: string; outcome: string }> = [
    { provider: 'PIXABAY', outcome: candidates.length ? 'OK' : 'OK_EMPTY' },
  ],
) => ({ candidates, attempted });

describe('CourseMediaSearchService', () => {
  const prisma = {
    course: { findUnique: jest.fn(), update: jest.fn() },
    courseLesson: { findFirst: jest.fn() },
    courseLessonMedia: { create: jest.fn() },
  } as any;
  const upload = {
    putObjectAtKey: jest.fn(),
  } as any;
  const imageSearch = {
    searchWithDiagnostics: jest.fn(),
    download: jest.fn(),
  } as any;
  const vision = {
    validate: jest.fn(),
  } as any;
  const service = new CourseMediaSearchService(
    prisma,
    upload,
    imageSearch,
    vision,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.course.findUnique.mockResolvedValue({
      id: 17,
      title: 'Tiếng Anh Giao Tiếp Cơ Bản – AI Demo',
      level: 'BEGINNER',
    });
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 768,
      courseId: 17,
      title: 'Polite Small Talk and Daily Conversation',
    });
    upload.putObjectAtKey.mockResolvedValue({
      url: 'https://cdn.example.test/courses/17/cover-1.jpg',
      key: 'courses/17/cover-1.jpg',
      contentType: 'image/jpeg',
    });
  });

  it('rejects non-Admin callers', async () => {
    await expect(
      service.searchCourseCover(17, {}, student),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks media Accept before any download when the Course is published', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 17,
      title: 'Published course',
      status: 'PUBLISHED',
    });
    await expect(
      service.acceptCourseCover(17, { candidate: candidate() }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(imageSearch.download).not.toHaveBeenCalled();
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('returns PASS on the first candidate without trying further ones', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(
      diag([candidate(), candidate({ providerAssetId: '999' })]),
    );
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate.mockResolvedValue({
      status: 'PASS',
      confidence: 0.9,
      description: 'ok',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate?.providerAssetId).toBe('123');
    expect(result.vision?.status).toBe('PASS');
    expect(result.reason).toBe('SUCCESS');
    expect(imageSearch.download).toHaveBeenCalledTimes(1);
    expect(vision.validate).toHaveBeenCalledTimes(1);
  });

  it('derives a short keyword query for providers instead of a full sentence', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(diag([candidate()]));
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate.mockResolvedValue({
      status: 'PASS',
      confidence: 0.9,
      description: '',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    await service.searchCourseCover(17, {}, admin);
    const query = imageSearch.searchWithDiagnostics.mock.calls[0][0] as string;
    expect(query).not.toMatch(/scene for|everyday scene/i);
    expect(query.split(' ').length).toBeLessThanOrEqual(8);

    await service.searchLessonMedia(17, 768, {}, admin);
    const lessonQuery = imageSearch.searchWithDiagnostics.mock
      .calls[1][0] as string;
    expect(lessonQuery).not.toMatch(/scene for|everyday scene/i);
    expect(lessonQuery.toLowerCase()).toContain('polite');
  });

  it('skips a FAIL candidate and tries the next one, bounded at 3 total', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(
      diag([
        candidate({ providerAssetId: '1' }),
        candidate({ providerAssetId: '2' }),
        candidate({ providerAssetId: '3' }),
        candidate({ providerAssetId: '4' }),
      ]),
    );
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate
      .mockResolvedValueOnce({
        status: 'FAIL',
        confidence: 0.8,
        description: '',
        visibleFacts: [],
        issues: [],
        rejectionReasons: ['irrelevant'],
      })
      .mockResolvedValueOnce({
        status: 'FAIL',
        confidence: 0.8,
        description: '',
        visibleFacts: [],
        issues: [],
        rejectionReasons: ['irrelevant'],
      })
      .mockResolvedValueOnce({
        status: 'LOW_CONFIDENCE',
        confidence: 0.5,
        description: '',
        visibleFacts: [],
        issues: [],
        rejectionReasons: [],
      });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate?.providerAssetId).toBe('3');
    expect(result.vision?.status).toBe('LOW_CONFIDENCE');
    expect(vision.validate).toHaveBeenCalledTimes(3);
    // the 4th search result must never reach Vision — MAX_MEDIA_CANDIDATES_TO_VISION=3
    expect(imageSearch.download).toHaveBeenCalledTimes(3);
  });

  it('VISION_REJECTED_ALL: every candidate is explicitly rejected by Vision', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(
      diag([candidate(), candidate({ providerAssetId: '2' })]),
    );
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate.mockResolvedValue({
      status: 'FAIL',
      confidence: 0.9,
      description: '',
      visibleFacts: [],
      issues: [],
      rejectionReasons: ['irrelevant'],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate).toBeNull();
    expect(result.reason).toBe('VISION_REJECTED_ALL');
  });

  it('VISION_UNAVAILABLE: Vision itself could not be reached — surfaced distinctly, never labeled as a rejection or "no result"', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(diag([candidate()]));
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate.mockResolvedValue({
      status: 'UNAVAILABLE',
      confidence: 0,
      description: 'Gemini 503',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    // the candidate is still returned (the frontend gates Accept on `reason`,
    // not on candidate presence) so Admin can still judge it manually.
    expect(result.candidate?.providerAssetId).toBe('123');
    expect(result.reason).toBe('VISION_UNAVAILABLE');
  });

  it('SEARCH_PROVIDER_UNAVAILABLE: no provider could even be queried successfully', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue({
      candidates: [],
      attempted: [
        { provider: 'PIXABAY', outcome: 'PROVIDER_BLOCKED' },
        { provider: 'OPENVERSE', outcome: 'PROVIDER_TRANSIENT' },
        { provider: 'WIKIMEDIA_COMMONS', outcome: 'PROVIDER_TIMEOUT' },
      ],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate).toBeNull();
    expect(result.reason).toBe('SEARCH_PROVIDER_UNAVAILABLE');
    expect(vision.validate).not.toHaveBeenCalled();
  });

  it('SEARCH_NO_RESULT: at least one provider was queried successfully but found nothing', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue({
      candidates: [],
      attempted: [
        { provider: 'PIXABAY', outcome: 'PROVIDER_BLOCKED' },
        { provider: 'OPENVERSE', outcome: 'OK_EMPTY' },
        { provider: 'WIKIMEDIA_COMMONS', outcome: 'OK_EMPTY' },
      ],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate).toBeNull();
    expect(result.reason).toBe('SEARCH_NO_RESULT');
  });

  it('treats a download failure on one candidate as skip-and-continue, not a hard failure', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(
      diag([
        candidate({ providerAssetId: '1' }),
        candidate({ providerAssetId: '2' }),
      ]),
    );
    imageSearch.download
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce(downloaded());
    vision.validate.mockResolvedValue({
      status: 'PASS',
      confidence: 0.9,
      description: '',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate?.providerAssetId).toBe('2');
  });

  it('reports SEARCH_PROVIDER_UNAVAILABLE when every returned candidate fails to download (none ever reach Vision)', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(
      diag([candidate({ providerAssetId: '1' })]),
    );
    imageSearch.download.mockRejectedValue(new Error('HTTP 404'));
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate).toBeNull();
    expect(result.reason).toBe('SEARCH_PROVIDER_UNAVAILABLE');
    expect(vision.validate).not.toHaveBeenCalled();
  });

  it('LOW_CONFIDENCE never blocks the candidate from reaching Admin review', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(diag([candidate()]));
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate.mockResolvedValue({
      status: 'LOW_CONFIDENCE',
      confidence: 0.4,
      description: '',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    const result = await service.searchCourseCover(17, {}, admin);
    expect(result.candidate).not.toBeNull();
    expect(result.vision?.status).toBe('LOW_CONFIDENCE');
    expect(result.reason).toBe('SUCCESS');
  });

  it('search alone never writes to Course/Lesson — no R2 upload, no Prisma write', async () => {
    imageSearch.searchWithDiagnostics.mockResolvedValue(diag([candidate()]));
    imageSearch.download.mockResolvedValue(downloaded());
    vision.validate.mockResolvedValue({
      status: 'PASS',
      confidence: 0.9,
      description: '',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    await service.searchCourseCover(17, {}, admin);
    expect(upload.putObjectAtKey).not.toHaveBeenCalled();
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('Accept re-downloads and re-validates the candidate before writing Course.thumbnail', async () => {
    imageSearch.download.mockResolvedValue(downloaded());
    prisma.course.update.mockResolvedValue({ id: 17, thumbnail: 'x' });
    const result = await service.acceptCourseCover(
      17,
      { brief: 'beginner English learners', candidate: candidate() },
      admin,
    );
    expect(imageSearch.download).toHaveBeenCalledTimes(1);
    expect(upload.putObjectAtKey).toHaveBeenCalledTimes(1);
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { thumbnail: 'https://cdn.example.test/courses/17/cover-1.jpg' },
    });
    expect(result).toEqual({
      thumbnail: 'https://cdn.example.test/courses/17/cover-1.jpg',
    });
  });

  it('Accept for Lesson media creates a CourseLessonMedia row with auto-retrieved provenance', async () => {
    imageSearch.download.mockResolvedValue(downloaded());
    prisma.courseLessonMedia.create.mockResolvedValue({ id: 1 });
    await service.acceptLessonMedia(
      17,
      768,
      {
        brief: 'two people talking',
        candidate: candidate({ provider: 'OPENVERSE' }),
      },
      admin,
    );
    expect(prisma.courseLessonMedia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lessonId: 768,
        type: 'image',
        provenance: 'auto-retrieved:openverse',
      }),
    });
  });

  it('a download/validation failure on Accept propagates and does not touch the Draft', async () => {
    imageSearch.download.mockRejectedValue(new Error('HTTP 410'));
    await expect(
      service.acceptCourseCover(
        17,
        { brief: 'x', candidate: candidate() },
        admin,
      ),
    ).rejects.toThrow('HTTP 410');
    expect(upload.putObjectAtKey).not.toHaveBeenCalled();
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown Course or Lesson', async () => {
    prisma.course.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.searchCourseCover(999, {}, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.courseLesson.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.searchLessonMedia(17, 999, {}, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** Minimal buffer that passes validateImageBuffer's PNG header check
 * (8-byte signature + width/height at bytes 16-23) without needing a real
 * encoded image. */
function fakePngBase64(width = 800, height = 600) {
  const buf = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf.toString('base64');
}

/** Minimal shared-state fake for ioredis's get/set/del — good enough to prove
 * cross-instance behavior (two service instances pointed at the SAME fake
 * behave like two backend instances sharing real Redis). */
function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    get: jest.fn((key: string) =>
      Promise.resolve(store.has(key) ? store.get(key)! : null),
    ),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
  };
}

describe('CourseMediaSearchService — "Sinh ảnh bằng AI" (Cloudflare Workers AI generation)', () => {
  const prisma = {
    course: { findUnique: jest.fn(), update: jest.fn() },
    courseLesson: { findFirst: jest.fn() },
    courseLessonMedia: { create: jest.fn() },
  } as any;
  const upload = {
    putObjectAtKey: jest.fn(),
    downloadFileBuffer: jest.fn(),
    deleteFile: jest.fn(),
  } as any;
  const imageSearch = {} as any;
  const vision = { validate: jest.fn() } as any;
  let redis: ReturnType<typeof createFakeRedis>;
  let service: CourseMediaSearchService;
  const originalFetch = global.fetch;
  const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalToken = process.env.CLOUDFLARE_AI_API_TOKEN;

  const pngBuffer = Buffer.from(fakePngBase64(), 'base64');
  const passVision = () => ({
    status: 'PASS' as const,
    confidence: 0.9,
    description: '',
    visibleFacts: [],
    issues: [],
    rejectionReasons: [],
  });
  const mockGeneratedImageResponse = () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { image: fakePngBase64() } }),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redis = createFakeRedis();
    service = new CourseMediaSearchService(
      prisma,
      upload,
      imageSearch,
      vision,
      redis as any,
    );
    prisma.course.findUnique.mockResolvedValue({
      id: 17,
      title: 'Course',
      level: 'BEGINNER',
    });
    prisma.courseLesson.findFirst.mockResolvedValue({
      id: 768,
      courseId: 17,
      title: 'Lesson',
    });
    upload.putObjectAtKey.mockResolvedValue({
      url: 'https://cdn.example.test/courses/17/cover-1.jpg',
      key: 'courses/17/cover-1.jpg',
      contentType: 'image/png',
    });
    upload.downloadFileBuffer.mockResolvedValue(pngBuffer);
    upload.deleteFile.mockResolvedValue(undefined);
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    process.env.CLOUDFLARE_AI_API_TOKEN = 'token-xyz';
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
    process.env.CLOUDFLARE_AI_API_TOKEN = originalToken;
  });

  it('reports AI_IMAGE_GENERATION_NOT_CONFIGURED when Cloudflare credentials are absent, without throwing', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('AI_IMAGE_GENERATION_NOT_CONFIGURED');
    expect(result.candidate).toBeNull();
  });

  it('generates one candidate on PASS, stores it as a temp R2 object + Redis token, and Accept persists it to a final R2 key + Course.thumbnail', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateCourseCoverImage(17, admin);
    expect(generated.reason).toBe('SUCCESS');
    expect(generated.candidate?.previewUrl).toMatch(/^data:image\/png;base64,/);
    expect(generated.candidate?.token).toBeTruthy();
    expect(upload.putObjectAtKey).toHaveBeenCalledTimes(1);
    expect(upload.putObjectAtKey.mock.calls[0][0]).toMatch(
      /^tmp\/course-media\//,
    );

    prisma.course.update.mockResolvedValue({ id: 17 });
    const accepted = await service.acceptGeneratedCourseCover(
      17,
      { token: generated.candidate!.token, brief: 'x' },
      admin,
    );
    expect(upload.downloadFileBuffer).toHaveBeenCalledWith(
      upload.putObjectAtKey.mock.calls[0][0],
    );
    expect(upload.putObjectAtKey).toHaveBeenCalledTimes(2);
    expect(upload.putObjectAtKey.mock.calls[1][0]).toMatch(/^courses\/17\//);
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { thumbnail: 'https://cdn.example.test/courses/17/cover-1.jpg' },
    });
    expect(accepted).toEqual({
      thumbnail: 'https://cdn.example.test/courses/17/cover-1.jpg',
    });
    // cleanup: temp object + both Redis keys gone after a successful Accept
    expect(upload.deleteFile).toHaveBeenCalledWith(
      upload.putObjectAtKey.mock.calls[0][0],
    );
    expect(redis.del).toHaveBeenCalledWith(
      `media-gen:token:${generated.candidate!.token}`,
    );
    expect(redis.del).toHaveBeenCalledWith(
      `media-gen:latest:COURSE_COVER:17:-`,
    );
  });

  it('cross-instance: a candidate generated on one backend instance can be Accepted on another, via shared Redis metadata', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const serviceA = service;
    const serviceB = new CourseMediaSearchService(
      prisma,
      upload,
      imageSearch,
      vision,
      redis as any,
    );
    const generated = await serviceA.generateCourseCoverImage(17, admin);
    prisma.course.update.mockResolvedValue({ id: 17 });
    const accepted = await serviceB.acceptGeneratedCourseCover(
      17,
      { token: generated.candidate!.token, brief: 'x' },
      admin,
    );
    expect(accepted.thumbnail).toBe(
      'https://cdn.example.test/courses/17/cover-1.jpg',
    );
  });

  it('rejects Accept when the token was generated for a different Course — no mutation on either side', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateCourseCoverImage(17, admin);
    prisma.course.findUnique.mockResolvedValue({
      id: 18,
      title: 'Other course',
      level: 'BEGINNER',
    });
    await expect(
      service.acceptGeneratedCourseCover(
        18,
        { token: generated.candidate!.token, brief: 'x' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.course.update).not.toHaveBeenCalled();
    expect(upload.putObjectAtKey).toHaveBeenCalledTimes(1); // only the temp write from generate
  });

  it('rejects Accept when the token was generated for a different Lesson — no mutation', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateLessonMediaImage(17, 768, admin);
    await expect(
      service.acceptGeneratedLessonMedia(
        17,
        999,
        { token: generated.candidate!.token, brief: 'x' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.courseLessonMedia.create).not.toHaveBeenCalled();
  });

  it('a generated candidate is single-use — accepting the same token twice fails the second time', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateCourseCoverImage(17, admin);
    prisma.course.update.mockResolvedValue({ id: 17 });
    await service.acceptGeneratedCourseCover(
      17,
      { token: generated.candidate!.token, brief: 'x' },
      admin,
    );
    await expect(
      service.acceptGeneratedCourseCover(
        17,
        { token: generated.candidate!.token, brief: 'x' },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an expired (or never-issued) token fails Accept cleanly without mutating the Draft', async () => {
    await expect(
      service.acceptGeneratedCourseCover(
        17,
        { token: 'never-issued-token', brief: 'x' },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('VISION_REJECTED_ALL: Vision explicitly rejects the generated image — no candidate token is issued', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue({
      status: 'FAIL',
      confidence: 0.9,
      description: '',
      visibleFacts: [],
      issues: [],
      rejectionReasons: ['irrelevant'],
    });
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('VISION_REJECTED_ALL');
    expect(result.candidate).toBeNull();
    expect(upload.putObjectAtKey).not.toHaveBeenCalled();
  });

  it('VISION_UNAVAILABLE: Gemini down does not delete the generated candidate — Admin can still review/accept it', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue({
      status: 'UNAVAILABLE',
      confidence: 0,
      description: 'Gemini 503',
      visibleFacts: [],
      issues: [],
      rejectionReasons: [],
    });
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('VISION_UNAVAILABLE');
    expect(result.candidate?.token).toBeTruthy();
  });

  it('AI_IMAGE_GENERATION_FAILED when Cloudflare responds with invalid output', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: {} }),
    });
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('AI_IMAGE_GENERATION_FAILED');
    expect(vision.validate).not.toHaveBeenCalled();
  });

  it('AI_IMAGE_GENERATION_FAILED when the technical raster check fails (e.g. too small)', async () => {
    const tinyPng = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(tinyPng, 0);
    tinyPng.writeUInt32BE(10, 16);
    tinyPng.writeUInt32BE(10, 20);
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ result: { image: tinyPng.toString('base64') } }),
    });
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('AI_IMAGE_GENERATION_FAILED');
  });

  it('AI_IMAGE_GENERATION_FAILED on a Cloudflare network/HTTP failure', async () => {
    (global.fetch as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('network down'));
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('AI_IMAGE_GENERATION_FAILED');
  });

  it('TEMP_MEDIA_STORAGE_UNAVAILABLE when Redis is down at generate time — no token, no RAM fallback, temp object never orphaned', async () => {
    const noRedisService = new CourseMediaSearchService(
      prisma,
      upload,
      imageSearch,
      vision,
    );
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const result = await noRedisService.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('TEMP_MEDIA_STORAGE_UNAVAILABLE');
    expect(result.candidate).toBeNull();
    expect(upload.putObjectAtKey).toHaveBeenCalledTimes(1);
    expect(upload.deleteFile).toHaveBeenCalledWith(
      upload.putObjectAtKey.mock.calls[0][0],
    );
  });

  it('AI_IMAGE_GENERATION_STORAGE_FAILED when the temp R2 write fails at generate — no Redis write attempted, no token issued', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    upload.putObjectAtKey.mockRejectedValueOnce(new Error('r2 down'));
    const result = await service.generateCourseCoverImage(17, admin);
    expect(result.reason).toBe('AI_IMAGE_GENERATION_STORAGE_FAILED');
    expect(result.candidate).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('final R2 write failure at Accept leaves the Draft untouched and the token retryable', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateCourseCoverImage(17, admin);
    upload.putObjectAtKey.mockRejectedValueOnce(new Error('final write down'));
    await expect(
      service.acceptGeneratedCourseCover(
        17,
        { token: generated.candidate!.token, brief: 'x' },
        admin,
      ),
    ).rejects.toThrow('final write down');
    expect(prisma.course.update).not.toHaveBeenCalled();

    // retryable: the same token still resolves on a second Accept attempt
    prisma.course.update.mockResolvedValue({ id: 17 });
    const accepted = await service.acceptGeneratedCourseCover(
      17,
      { token: generated.candidate!.token, brief: 'x' },
      admin,
    );
    expect(accepted.thumbnail).toBe(
      'https://cdn.example.test/courses/17/cover-1.jpg',
    );
  });

  it('a DB failure at Accept after the final R2 write succeeds triggers compensation (orphaned final object deleted) and leaves the token retryable', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateCourseCoverImage(17, admin);
    prisma.course.update.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.acceptGeneratedCourseCover(
        17,
        { token: generated.candidate!.token, brief: 'x' },
        admin,
      ),
    ).rejects.toThrow('db down');
    // compensation: the orphaned FINAL object (not the temp one) was deleted
    expect(upload.deleteFile).toHaveBeenCalledWith('courses/17/cover-1.jpg');

    // retryable: token/temp object were never consumed by the failed attempt
    prisma.course.update.mockResolvedValue({ id: 17 });
    const accepted = await service.acceptGeneratedCourseCover(
      17,
      { token: generated.candidate!.token, brief: 'x' },
      admin,
    );
    expect(accepted.thumbnail).toBe(
      'https://cdn.example.test/courses/17/cover-1.jpg',
    );
  });

  it('regenerating for the same target invalidates/cleans up the previous outstanding candidate', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const first = await service.generateCourseCoverImage(17, admin);
    const firstTempKey = upload.putObjectAtKey.mock.calls[0][0];
    const second = await service.generateCourseCoverImage(17, admin);
    expect(second.candidate!.token).not.toBe(first.candidate!.token);
    expect(upload.deleteFile).toHaveBeenCalledWith(firstTempKey);
    expect(redis.del).toHaveBeenCalledWith(
      `media-gen:token:${first.candidate!.token}`,
    );
    // the stale first token can no longer be Accepted
    await expect(
      service.acceptGeneratedCourseCover(
        17,
        { token: first.candidate!.token, brief: 'x' },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('generation never mutates Course/Lesson until explicit Accept', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    await service.generateCourseCoverImage(17, admin);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('Accept for Lesson media stores synthetic provenance distinct from auto-retrieved search media', async () => {
    mockGeneratedImageResponse();
    vision.validate.mockResolvedValue(passVision());
    const generated = await service.generateLessonMediaImage(17, 768, admin);
    prisma.courseLessonMedia.create.mockResolvedValue({ id: 1 });
    await service.acceptGeneratedLessonMedia(
      17,
      768,
      { token: generated.candidate!.token, brief: 'x' },
      admin,
    );
    expect(prisma.courseLessonMedia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lessonId: 768,
        type: 'image',
        provenance: 'generated:cloudflare-workers-ai:flux-1-schnell',
      }),
    });
  });
});
