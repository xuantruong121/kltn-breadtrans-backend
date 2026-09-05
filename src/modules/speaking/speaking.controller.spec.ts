import { Test, TestingModule } from '@nestjs/testing';
import { SpeakingController } from './speaking.controller';
import { SpeakingService } from './speaking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';

describe('SpeakingController - Security & AI Quota', () => {
  let controller: SpeakingController;
  let service: jest.Mocked<Partial<SpeakingService>>;

  beforeEach(async () => {
    service = {
      evaluateSpeakingPart3To5: jest.fn().mockResolvedValue({
        score: 80,
        feedback: 'Good structure',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpeakingController],
      providers: [
        {
          provide: SpeakingService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SpeakingController>(SpeakingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('P3-PRE-03: submitPart3To5 must have AiRateLimitGuard applied', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      controller.submitPart3To5,
    );
    expect(guards).toBeDefined();
    expect(guards).toContain(AiRateLimitGuard);
  });

  it('submitPart3To5 delegates to speakingService.evaluateSpeakingPart3To5', async () => {
    const result = await controller.submitPart3To5(
      'Sample prompt',
      'Student answer',
    );
    expect(service.evaluateSpeakingPart3To5).toHaveBeenCalledWith(
      'Sample prompt',
      'Student answer',
    );
    expect(result).toEqual({
      score: 80,
      feedback: 'Good structure',
    });
  });
});

describe('AiRateLimitGuard on Speaking Endpoints', () => {
  let guard: AiRateLimitGuard;
  let mockRedis: {
    incr: jest.Mock;
    expire: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      incr: jest.fn(),
      expire: jest.fn(),
    };
    guard = new AiRateLimitGuard(mockRedis as any);
  });

  const createMockContext = (user: any) => {
    const req = { user };
    const res = { setHeader: jest.fn() };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
  };

  it('SEC03: Student Speaking within quota is allowed', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    const context = createMockContext({ id: 10, role: Role.STUDENT });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockRedis.incr).toHaveBeenCalled();
  });

  it('SEC04: Student Speaking exhausted quota throws 429 TooManyRequests', async () => {
    mockRedis.incr.mockResolvedValue(31); // Exceeds limit of 30

    const context = createMockContext({ id: 10, role: Role.STUDENT });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(context);
    } catch (err: unknown) {
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });

  it('TEACHER and ADMIN bypass quota counter', async () => {
    const teacherCtx = createMockContext({ id: 2, role: Role.TEACHER });
    const adminCtx = createMockContext({ id: 1, role: Role.ADMIN });

    expect(await guard.canActivate(teacherCtx)).toBe(true);
    expect(await guard.canActivate(adminCtx)).toBe(true);
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });
});
