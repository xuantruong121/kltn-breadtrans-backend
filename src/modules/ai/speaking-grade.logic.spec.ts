import { ServiceUnavailableException } from '@nestjs/common';
import { GeminiEvaluatorStrategy } from './strategies/gemini-evaluator.strategy';
import { OpenAIEvaluatorStrategy } from './strategies/openai-evaluator.strategy';
import {
  SpeakingGradeOutputError,
  parseSpeakingPart3To5Grade,
} from './speaking-grade.logic';

describe('parseSpeakingPart3To5Grade', () => {
  it('returns a valid grade unchanged', () => {
    expect(
      parseSpeakingPart3To5Grade(
        '```json\n{"score":2,"feedback":"Ổn","suggestions":["a"]}\n```',
      ),
    ).toEqual({ score: 2, feedback: 'Ổn', suggestions: ['a'] });
  });

  it.each([
    ['not json', 'GRADER_OUTPUT_INVALID'],
    ['{"feedback":"x"}', 'GRADER_OUTPUT_INVALID'],
    ['{"score":"3","feedback":"x"}', 'GRADER_OUTPUT_INVALID'],
    ['{"score":3}', 'GRADER_OUTPUT_INVALID'],
    ['{"score":6,"feedback":"x"}', 'SCORE_OUT_OF_RANGE'],
    ['{"score":-1,"feedback":"x"}', 'SCORE_OUT_OF_RANGE'],
    ['{"score":2.5,"feedback":"x"}', 'SCORE_OUT_OF_RANGE'],
  ])('rejects %s as %s', (raw, code) => {
    try {
      parseSpeakingPart3To5Grade(raw);
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SpeakingGradeOutputError);
      expect((error as SpeakingGradeOutputError).code).toBe(code);
    }
  });
});

describe('Speaking Part 3-5 grading never invents a score', () => {
  const failureBody = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      return (error as ServiceUnavailableException).getResponse() as any;
    }
    throw new Error('expected GRADING_FAILED');
  };

  const strategyWith = (execute: jest.Mock) => {
    const redis = { hincrby: jest.fn().mockResolvedValue(1) };
    const strategy = new GeminiEvaluatorStrategy(redis as any) as any;
    strategy.hasKeys = () => true;
    strategy.executeWithRotation = execute;
    jest.spyOn(strategy.logger, 'error').mockImplementation(() => undefined);
    return { strategy, redis };
  };

  it('returns GRADING_FAILED with score null when the grader is down', async () => {
    const { strategy, redis } = strategyWith(
      jest.fn().mockRejectedValue(new Error('503 overloaded')),
    );
    const body = await failureBody(
      strategy.evaluateSpeakingPart3To5('Q', 'answer'),
    );
    expect(body).toMatchObject({
      status: 'GRADING_FAILED',
      score: null,
      code: 'GRADER_UNAVAILABLE',
    });
    expect(redis.hincrby).toHaveBeenCalledWith(
      expect.stringMatching(
        /^ai:grading-failed:speaking-p3-5:\d{4}-\d{2}-\d{2}$/,
      ),
      'GRADER_UNAVAILABLE',
      1,
    );
  });

  it('returns GRADING_FAILED when the score is out of range', async () => {
    const { strategy } = strategyWith(
      jest.fn().mockResolvedValue({
        response: { text: () => '{"score":9,"feedback":"x"}' },
      }),
    );
    const body = await failureBody(
      strategy.evaluateSpeakingPart3To5('Q', 'answer'),
    );
    expect(body).toMatchObject({ score: null, code: 'SCORE_OUT_OF_RANGE' });
  });

  it('returns the grader score when it is valid', async () => {
    const { strategy } = strategyWith(
      jest.fn().mockResolvedValue({
        response: {
          text: () => '{"score":3,"feedback":"Tốt","suggestions":[]}',
        },
      }),
    );
    await expect(
      strategy.evaluateSpeakingPart3To5('Q', 'answer'),
    ).resolves.toEqual({ score: 3, feedback: 'Tốt', suggestions: [] });
  });

  it('the OpenAI placeholder strategy refuses instead of returning 3', async () => {
    const body = await failureBody(
      new OpenAIEvaluatorStrategy().evaluateSpeakingPart3To5('Q', 'answer'),
    );
    expect(body).toMatchObject({ score: null, code: 'GRADER_NOT_CONFIGURED' });
  });
});
