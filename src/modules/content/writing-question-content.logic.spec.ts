import {
  PICTURE_WRITING_EXERCISES,
  pictureTaskContent,
} from '../../../prisma/data/picture-writing-practice';
import { practiceWritingTask } from '../writing/practice-writing-grading';
import { writingQuestionContent } from './writing-question-content.logic';

/**
 * A CMS edit of a seeded picture task (owner 2026-11-19): the form used to
 * rewrite the whole content and keep only dismissedAnswers, so the rubric,
 * scene, sample answer and requirements were lost and the task stopped being
 * graded by its rubric.
 */
describe('writingQuestionContent', () => {
  const exercise = PICTURE_WRITING_EXERCISES[0];
  const seeded = pictureTaskContent(
    exercise,
    exercise.tasks[0],
    'https://cdn.example.com',
  );
  const formOf = (content: typeof seeded) => ({
    prompt: `${content.prompt} (sửa)`,
    taskType: content.taskType,
    imageUrl: content.imageUrl,
    keywords: content.requiredKeywords,
  });

  it('keeps the rubric, scene, sample, requirements and word range of a seeded picture task', () => {
    const saved = writingQuestionContent(formOf(seeded), seeded);
    expect(saved).toMatchObject({
      prompt: `${seeded.prompt} (sửa)`,
      rubric: seeded.rubric,
      sceneDescription: seeded.sceneDescription,
      sampleResponse: seeded.sampleResponse,
      requirements: seeded.requirements,
      requireLinking: seeded.requireLinking,
      wordRange: [1, 40],
    });
    expect(practiceWritingTask(saved, '')).not.toBeNull();
  });

  it('writes the suggested words where the grader reads them', () => {
    const saved = writingQuestionContent(
      { ...formOf(seeded), keywords: [' bench ', 'park', 'park'] },
      seeded,
    );
    expect(saved.keywords).toEqual(['bench', 'park']);
    expect(saved.requiredKeywords).toEqual(['bench', 'park']);
    expect(practiceWritingTask(saved, '')?.requiredKeywords).toEqual([
      'bench',
      'park',
    ]);
  });

  it('drops words the admin removed instead of keeping the seeded ones', () => {
    const saved = writingQuestionContent(
      { ...formOf(seeded), keywords: [] },
      seeded,
    );
    expect(saved.keywords).toBeUndefined();
    expect(saved.requiredKeywords).toBeUndefined();
  });

  it('starts clean when the task type changes, so no other rubric grades it', () => {
    const saved = writingQuestionContent(
      { prompt: 'Viết một câu.', taskType: 'SENTENCE' },
      seeded,
    );
    expect(saved.rubric).toBeUndefined();
    expect(saved.sceneDescription).toBeUndefined();
    expect(saved.wordRange).toBeUndefined();
  });

  it('keeps a translation task’s dismissed answers and drops its answers when it becomes another type', () => {
    const translation = {
      skill: 'WRITING',
      taskType: 'SENTENCE_TRANSLATION',
      prompt: 'Tôi thích cà phê.',
      acceptedAnswers: ['I like coffee.'],
      dismissedAnswers: ['I likes coffee.'],
    };
    const edited = writingQuestionContent(
      {
        prompt: 'Tôi thích cà phê sữa.',
        taskType: 'SENTENCE_TRANSLATION',
        acceptedAnswers: ['I like milk coffee.', ' I like milk coffee. '],
      },
      translation,
    );
    expect(edited.acceptedAnswers).toEqual(['I like milk coffee.']);
    expect(edited.dismissedAnswers).toEqual(['I likes coffee.']);

    const switched = writingQuestionContent(
      { prompt: 'Viết một câu.', taskType: 'SENTENCE' },
      translation,
    );
    expect(switched.acceptedAnswers).toBeUndefined();
    expect(switched.dismissedAnswers).toBeUndefined();
  });

  it('builds a new task from the form alone', () => {
    expect(
      writingQuestionContent({
        prompt: ' Write an email. ',
        taskType: 'EMAIL',
        wordRange: [120, 150],
      }),
    ).toEqual({
      skill: 'WRITING',
      prompt: 'Write an email.',
      taskType: 'EMAIL',
      wordRange: [120, 150],
    });
  });
});
