import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { QuizController } from './quiz.controller';

/**
 * DELETE /quizzes/:id is gone (owner 2026-11-18): it deleted a TOEIC quiz
 * with no learner-history check, and the learners' submissions cascaded.
 * No screen called it; admins delete exams through /admin/exams.
 */
describe('QuizController routes', () => {
  it('has no DELETE /quizzes/:id', () => {
    const routes = Object.getOwnPropertyNames(QuizController.prototype)
      .map((name) => (QuizController.prototype as any)[name])
      .filter((fn) => typeof fn === 'function')
      .map((fn) => ({
        method: Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod,
        path: Reflect.getMetadata(PATH_METADATA, fn) as string | undefined,
      }));
    expect(routes).not.toContainEqual({
      method: RequestMethod.DELETE,
      path: ':id',
    });
  });
});
