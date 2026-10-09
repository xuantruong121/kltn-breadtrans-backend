import { buildCourseCurriculum } from './course-curriculum';

describe('buildCourseCurriculum', () => {
  it('orders lessons and preserves exact skill routes without inventing speaking', () => {
    const curriculum = buildCourseCurriculum(
      [
        {
          id: 2,
          title: 'Reading Emails',
          description: null,
          order: 2,
          materials: [],
        },
        {
          id: 1,
          title: 'Listening for Details',
          description: null,
          order: 1,
          materials: [],
        },
      ],
      [
        {
          id: 9,
          title: 'Reading A2',
          type: 'BILINGUAL_READING',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
          _count: { questions: 4 },
        },
        {
          id: 5,
          title: 'Listening A2',
          type: 'LISTENING_PRACTICE',
          publicationStatus: 'PUBLISHED',
          isPremiumContent: false,
          _count: { questions: 2 },
        },
      ],
    );

    expect(curriculum.lessons.map((lesson) => lesson.order)).toEqual([1, 2]);
    expect(curriculum.lessons[0].activities[0].route).toBe('/listening/5');
    expect(curriculum.lessons[1].activities[0].route).toBe('/reading/9');
    expect(curriculum.skillCoverage).toEqual({
      LISTENING: 1,
      SPEAKING: 0,
      READING: 1,
      WRITING: 0,
    });
    expect(curriculum.readiness).toBe('PARTIAL');
  });

  it('does not mark drafts or empty quizzes as required ready activities', () => {
    const curriculum = buildCourseCurriculum(
      [{ id: 1, title: 'Review', description: null, order: 1, materials: [] }],
      [
        {
          id: 1,
          title: 'Draft Reading',
          type: 'BILINGUAL_READING',
          publicationStatus: 'DRAFT',
          isPremiumContent: false,
          _count: { questions: 0 },
        },
      ],
    );
    expect(curriculum.requiredActivityCount).toBe(0);
    expect(curriculum.readiness).toBe('BROKEN');
  });

  it('uses persisted activity order and stable Speaking set routes', () => {
    const curriculum = buildCourseCurriculum(
      [
        { id: 10, title: 'Unit 1', order: 1, description: null, materials: [] },
        { id: 11, title: 'Unit 2', order: 2, description: null, materials: [] },
      ],
      [
        {
          id: 20,
          title: 'Listening B1',
          type: 'LISTENING_PRACTICE',
          publicationStatus: 'PUBLISHED',
          _count: { questions: 5 },
        },
      ],
      [
        {
          id: 2,
          lessonId: 11,
          order: 2,
          kind: 'SPEAKING',
          title: 'Business conversation',
          isRequired: false,
          speakingPracticeSetId: 'question-response-business',
          speakingPracticeSet: {
            id: 'question-response-business',
            title: 'Question Response Business',
            description: 'Workplace response practice',
            exercises: [{ id: 31 }, { id: 32 }],
          },
        },
        {
          id: 1,
          lessonId: 10,
          order: 1,
          kind: 'LISTENING',
          isRequired: true,
          quizId: 20,
          quiz: {
            id: 20,
            title: 'Listening B1',
            type: 'LISTENING_PRACTICE',
            publicationStatus: 'PUBLISHED',
            _count: { questions: 5 },
          },
        },
      ],
      'FOUR_SKILLS',
    );

    expect(curriculum.lessons[0].activities[0]).toMatchObject({
      id: 'activity:1',
      sourceId: 20,
      required: true,
      order: 1,
    });
    expect(curriculum.lessons[1].activities[0]).toMatchObject({
      id: 'activity:2',
      sourceId: 'question-response-business',
      required: false,
      route: '/speaking/31?set=question-response-business',
      speakingPracticeSetId: 'question-response-business',
    });
    expect(curriculum.optionalActivityCount).toBe(1);
    expect(curriculum.skillCoverage).toEqual({
      LISTENING: 1,
      SPEAKING: 1,
      READING: 0,
      WRITING: 0,
    });
    expect(curriculum.readiness).toBe('PARTIAL');
  });

  it('applies truthful readiness rules for focused and TOEIC courses', () => {
    const lessons = [
      { id: 1, title: 'Grammar', order: 1, description: null, materials: [] },
    ];
    expect(
      buildCourseCurriculum(lessons, [], [], 'FOCUSED_GRAMMAR_VOCAB').readiness,
    ).toBe('FOCUSED');
    expect(buildCourseCurriculum(lessons, [], [], 'TOEIC').readiness).toBe(
      'DEFERRED_TO_TOEIC_WORKFLOW',
    );
  });
});
