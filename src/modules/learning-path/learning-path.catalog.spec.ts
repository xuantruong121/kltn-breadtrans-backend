import { loadCandidates, loadLearnerState } from './learning-path.catalog';

function catalogDb() {
  return {
    quiz: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 5,
          type: 'BILINGUAL_READING',
          title: 'Reading B1 — Office memo',
          practiceLevel: 'INTERMEDIATE',
          bilingualContent: null,
        },
      ]),
    },
    speakingPracticeSet: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'set-1',
          title: 'Phản hồi câu hỏi',
          level: 'INTERMEDIATE',
          // Published exercises only, in order: 40 is the set's key.
          exercises: [
            { id: 40, taskType: 'RESPOND_TO_QUESTION' },
            { id: 41, taskType: 'RESPOND_TO_QUESTION' },
          ],
          tracks: [{ track: 'STUDENT_ACADEMIC' }, { track: 'OFFICE_BUSINESS' }],
        },
        {
          id: 'set-2',
          title: 'Chưa gắn',
          level: 'STARTER',
          exercises: [{ id: 50, taskType: 'READ_ALOUD' }],
          tracks: [],
        },
      ]),
    },
    contentTrackTag: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ contentId: 5, track: 'OFFICE_BUSINESS' }]),
    },
    contentDifficulty: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('loadCandidates', () => {
  it('reads a speaking set tags from the set, keyed by its first exercise', async () => {
    const db = catalogDb();
    const { candidates, setKeyOfExercise } = await loadCandidates(
      db as never,
      null,
    );
    const set = candidates.find(
      (c) => c.type === 'SPEAKING_SET' && c.id === 40,
    );
    expect(set).toMatchObject({
      tracks: ['STUDENT_ACADEMIC', 'OFFICE_BUSINESS'],
      route: '/speaking/40?set=set-1',
    });
    expect(
      candidates.find((c) => c.type === 'SPEAKING_SET' && c.id === 50)?.tracks,
    ).toEqual([]);
    expect(setKeyOfExercise.get(41)).toBe(40);
    expect(
      db.speakingPracticeSet.findMany.mock.calls[0][0].select.tracks,
    ).toEqual({ select: { track: true } });
  });

  it('reads quiz tags only from ContentTrackTag', async () => {
    const db = catalogDb();
    const { candidates } = await loadCandidates(db as never, null);
    expect(db.contentTrackTag.findMany).toHaveBeenCalledWith({
      where: { contentType: 'QUIZ' },
      select: { contentId: true, track: true },
    });
    expect(candidates.find((c) => c.type === 'QUIZ')?.tracks).toEqual([
      'OFFICE_BUSINESS',
    ]);
  });
});

function learnerDb(profile: unknown) {
  return {
    learnerProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
    learnerSkillLevel: { findMany: jest.fn().mockResolvedValue([]) },
    submission: { findMany: jest.fn().mockResolvedValue([]) },
    speakingSubmission: { findMany: jest.fn().mockResolvedValue([]) },
    learningPlanItem: { findMany: jest.fn().mockResolvedValue([]) },
    diagnosticAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
    learningTrack: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Chung' }),
    },
  };
}

describe('loadLearnerState', () => {
  it('carries the name of the learner track from the table', async () => {
    const db = learnerDb({
      userId: 7,
      track: 'IT_SOFTWARE',
      trackRef: { name: 'Công nghệ thông tin' },
      goal: 'GENERAL',
      minutesPerDay: 15,
    });
    const state = await loadLearnerState(db as never, 7, new Map());
    expect(state).toMatchObject({
      track: 'IT_SOFTWARE',
      trackName: 'Công nghệ thông tin',
    });
    expect(db.learnerProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 7 },
      include: { trackRef: { select: { name: true } } },
    });
    expect(db.learningTrack.findUnique).not.toHaveBeenCalled();
  });

  it('puts a learner without a profile on GENERAL, by its stored name', async () => {
    const db = learnerDb(null);
    const state = await loadLearnerState(db as never, 7, new Map());
    expect(state).toMatchObject({ track: 'GENERAL', trackName: 'Chung' });
  });
});
