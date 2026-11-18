import { LearnerProgressService } from '../learning-path/learner-progress.service';
import { LearningEffectsQueueService } from './learning-effects-queue.service';

describe('LearningEffectsQueueService (capacity run 2026-11-09)', () => {
  const payload = {
    userId: 7,
    quizId: 3,
    submissionId: 11,
    score: 4,
    scorePercent: 80,
    isFirstSubmission: true,
  };
  const make = (progressAvailable = true) => {
    const listener = {
      handleQuizSubmittedEvent: jest.fn().mockResolvedValue(undefined),
    };
    const progress = {
      onQuizSubmitted: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === LearnerProgressService && progressAvailable)
          return progress;
        throw new Error('not in this process');
      }),
    };
    const events = { emit: jest.fn() };
    // LearningEffectClaim: INSERT ... ON CONFLICT DO NOTHING on submissionId.
    const claimed = new Set<number>();
    const prisma = {
      learningEffectClaim: {
        createMany: jest.fn(
          ({ data }: { data: { submissionId: number }[] }) => {
            const fresh = data.filter((d) => !claimed.has(d.submissionId));
            fresh.forEach((d) => claimed.add(d.submissionId));
            return Promise.resolve({ count: fresh.length });
          },
        ),
      },
    };
    const service = new LearningEffectsQueueService(
      listener as never,
      moduleRef as never,
      prisma as never,
      events as never,
    );
    return { service, listener, progress, events, prisma };
  };
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
  });

  it('runs inline under tests unless told otherwise', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.LEARNING_EFFECTS_MODE;
    expect(LearningEffectsQueueService.mode()).toBe('inline');
    process.env.LEARNING_EFFECTS_MODE = 'queue';
    expect(LearningEffectsQueueService.mode()).toBe('queue');
    process.env.NODE_ENV = 'production';
    delete process.env.LEARNING_EFFECTS_MODE;
    expect(LearningEffectsQueueService.mode()).toBe('queue');
  });

  it('inline: runs rewards and skill progress at once, with the day of submission', async () => {
    const { service, listener, progress } = make();
    await service.onQuizSubmitted(payload);
    const sent = listener.handleQuizSubmittedEvent.mock.calls[0][0];
    expect(sent).toMatchObject(payload);
    expect(sent.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(progress.onQuizSubmitted).toHaveBeenCalledWith(sent);
  });

  it('queue: hands the submission to the queue and runs nothing in the request', async () => {
    const { service, listener } = make();
    const add = jest.fn().mockResolvedValue({ id: '1' });
    (service as unknown as { queue: unknown }).queue = { add };
    await service.onQuizSubmitted({ ...payload, dateKey: '2026-11-09' });
    expect(add).toHaveBeenCalledWith(
      'quiz.submitted',
      { ...payload, dateKey: '2026-11-09' },
      // One job per submission: a second add of it is ignored (audit C1).
      { jobId: 'quiz-effects-11' },
    );
    expect(listener.handleQuizSubmittedEvent).not.toHaveBeenCalled();
  });

  it('queue down: runs the effects at once, so no reward is lost', async () => {
    const { service, listener, progress } = make();
    (service as unknown as { queue: unknown }).queue = {
      add: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    await service.onQuizSubmitted(payload);
    expect(listener.handleQuizSubmittedEvent).toHaveBeenCalled();
    expect(progress.onQuizSubmitted).toHaveBeenCalled();
  });

  it('queue hanging: gives up after 2 s and runs the effects', async () => {
    jest.useFakeTimers();
    const { service, listener } = make();
    (service as unknown as { queue: unknown }).queue = {
      add: () => new Promise(() => undefined),
    };
    const done = service.onQuizSubmitted(payload);
    await jest.advanceTimersByTimeAsync(2_001);
    await done;
    expect(listener.handleQuizSubmittedEvent).toHaveBeenCalled();
  });

  it('one effect failing does not stop the other', async () => {
    const { service, listener, progress } = make();
    listener.handleQuizSubmittedEvent.mockRejectedValue(new Error('db'));
    await service.run(payload);
    expect(progress.onQuizSubmitted).toHaveBeenCalled();
  });

  it('tells the learner when the effects are applied, so open pages refresh (owner 2026-11-17)', async () => {
    const { service, listener, progress, events } = make();
    await service.run(payload);
    expect(events.emit).toHaveBeenCalledWith('learning.effects_applied', {
      userId: 7,
    });
    // after both effects, never before
    const told = events.emit.mock.invocationCallOrder[0];
    expect(told).toBeGreaterThan(
      listener.handleQuizSubmittedEvent.mock.invocationCallOrder[0],
    );
    expect(told).toBeGreaterThan(
      progress.onQuizSubmitted.mock.invocationCallOrder[0],
    );
  });

  it('a failed effect still tells the learner, so the page shows what did change', async () => {
    const { service, listener, events } = make();
    listener.handleQuizSubmittedEvent.mockRejectedValue(new Error('db'));
    await service.run(payload);
    expect(events.emit).toHaveBeenCalledWith('learning.effects_applied', {
      userId: 7,
    });
  });

  it('a submission runs its effects once: an enqueue that timed out but landed finds the claim (audit C1)', async () => {
    const { service, listener, progress, events } = make();
    await service.run(payload);
    await service.run(payload);
    expect(listener.handleQuizSubmittedEvent).toHaveBeenCalledTimes(1);
    expect(progress.onQuizSubmitted).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('a payload without a submission id is not claimed and still runs', async () => {
    const { service, listener, prisma } = make();
    const withoutSubmission = { ...payload, submissionId: undefined };
    await service.run(withoutSubmission);
    await service.run(withoutSubmission);
    expect(prisma.learningEffectClaim.createMany).not.toHaveBeenCalled();
    expect(listener.handleQuizSubmittedEvent).toHaveBeenCalledTimes(2);
  });

  it('a claim that cannot be written runs nothing', async () => {
    const { service, listener, prisma } = make();
    prisma.learningEffectClaim.createMany.mockRejectedValueOnce(
      new Error('db down'),
    );
    await service.run(payload);
    expect(listener.handleQuizSubmittedEvent).not.toHaveBeenCalled();
  });

  it('a process without skill progress (the speaking worker) starts no queue', () => {
    process.env.LEARNING_EFFECTS_MODE = 'queue';
    const { service } = make(false);
    service.onModuleInit();
    expect((service as unknown as { queue?: unknown }).queue).toBeUndefined();
  });
});
