import {
  isRewardableQuiz,
  isRewardableSpeakingExercise,
} from './reward-eligibility';

const quiz = (over: Partial<Parameters<typeof isRewardableQuiz>[0]>) =>
  isRewardableQuiz({
    type: 'LISTENING_PRACTICE',
    practiceTopicId: null,
    courseId: null,
    inToeicWritingSet: false,
    inCourseActivity: false,
    ...over,
  });

describe('owner reward policy: who earns XP and Bánh mì', () => {
  it('standalone Listening, Reading and Writing practice are rewarded', () => {
    expect(quiz({ type: 'LISTENING_PRACTICE' })).toBe(true);
    expect(quiz({ type: 'BILINGUAL_READING' })).toBe(true);
    expect(quiz({ type: 'WRITING_EMAIL', practiceTopicId: 7 })).toBe(true);
    expect(quiz({ type: 'WRITING_PICTURE', practiceTopicId: 6 })).toBe(true);
  });

  it('TOEIC Writing tasks are never rewarded, even though they are Writing quizzes', () => {
    expect(quiz({ type: 'WRITING_PICTURE', inToeicWritingSet: true })).toBe(
      false,
    );
    expect(
      quiz({
        type: 'WRITING_EMAIL',
        practiceTopicId: 7,
        inToeicWritingSet: true,
      }),
    ).toBe(false);
  });

  it('course quizzes and course-linked practice are never rewarded', () => {
    expect(quiz({ courseId: 3 })).toBe(false);
    expect(quiz({ type: 'BILINGUAL_READING', inCourseActivity: true })).toBe(
      false,
    );
  });

  it('other quiz types (TOEIC, four-skill, grammar...) are not rewarded', () => {
    for (const type of ['TOEIC', 'TOEIC_FOUR_SKILL', 'GRAMMAR', 'VOCABULARY'])
      expect(quiz({ type })).toBe(false);
  });

  it('Speaking: standalone practice yes; exam sets and course sets no', () => {
    expect(
      isRewardableSpeakingExercise({
        practiceSetScope: null,
        inCourseActivity: false,
      }),
    ).toBe(true);
    expect(
      isRewardableSpeakingExercise({
        practiceSetScope: 'SKILL_PRACTICE',
        inCourseActivity: false,
      }),
    ).toBe(true);
    expect(
      isRewardableSpeakingExercise({
        practiceSetScope: 'EXAM_INTERNAL',
        inCourseActivity: false,
      }),
    ).toBe(false);
    expect(
      isRewardableSpeakingExercise({
        practiceSetScope: 'SKILL_PRACTICE',
        inCourseActivity: true,
      }),
    ).toBe(false);
  });
});
