/**
 * Loads the practice catalog and one learner's state for the recommender.
 *
 * Candidates are standalone, published skill practice with an authored CEFR
 * tag (untagged items have no level and are left out, as the access policy
 * never treats them as free):
 *   Quiz LISTENING_PRACTICE / BILINGUAL_READING / WRITING_*  -> QUIZ, quiz id
 *   SpeakingPracticeSet (SKILL_PRACTICE)                      -> SPEAKING_SET,
 *     contentId = the set's first exercise id (sets have string ids; the
 *     learner opens a set at its first exercise)
 * History scores are normalised to 0-100 (percentOfAttempt): each skill
 * stores its own scale.
 */
import type {
  LearningContentType,
  PracticeSkill,
  PrismaClient,
  QuizType,
} from '@prisma/client';

import {
  isDictationContent,
  parseCefrRange,
  planSatisfies,
  requiredPracticePlan,
} from '../subscription/practice-level';
import { itemLevel, seedDifficulty } from './ability.logic';
import { percentOfAttempt } from './progression.logic';
import {
  contentKey,
  type Candidate,
  type HistoryEntry,
  type LearnerState,
  type SkillState,
} from './recommendation.logic';

const QUIZ_SKILL: Partial<Record<QuizType, PracticeSkill>> = {
  LISTENING_PRACTICE: 'LISTENING',
  BILINGUAL_READING: 'READING',
  WRITING_PICTURE: 'WRITING',
  WRITING_EMAIL: 'WRITING',
};
const ROUTE: Record<Exclude<PracticeSkill, 'SPEAKING'>, string> = {
  LISTENING: '/listening',
  READING: '/reading',
  WRITING: '/writing',
};
const MINUTES: Record<PracticeSkill, number> = {
  LISTENING: 10,
  READING: 10,
  SPEAKING: 10,
  WRITING: 15,
};

type Db = Pick<
  PrismaClient,
  | 'quiz'
  | 'speakingPracticeSet'
  | 'contentTrackTag'
  | 'contentDifficulty'
  | 'submission'
  | 'speakingSubmission'
  | 'learnerProfile'
  | 'learnerSkillLevel'
  | 'learningPlanItem'
>;

export type Catalog = {
  candidates: Candidate[];
  /** Speaking exercise id -> its set's first exercise id (the set's key). */
  setKeyOfExercise: Map<number, number>;
};

export async function loadCandidates(
  db: Db,
  planCode: string | null,
): Promise<Catalog> {
  const [quizzes, sets, tags, difficulties] = await Promise.all([
    db.quiz.findMany({
      where: {
        type: { in: Object.keys(QUIZ_SKILL) as QuizType[] },
        publicationStatus: 'PUBLISHED',
        courseId: null,
        // A Writing task inside a TOEIC exam set is not standalone practice.
        toeicWritingSetItems: {
          none: { writingSet: { assessmentComponents: { some: {} } } },
        },
      },
      select: { id: true, type: true, title: true, bilingualContent: true },
    }),
    db.speakingPracticeSet.findMany({
      where: { scope: 'SKILL_PRACTICE', publicationStatus: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        level: true,
        exercises: {
          where: { publicationStatus: 'PUBLISHED' },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true },
        },
      },
    }),
    db.contentTrackTag.findMany(),
    db.contentDifficulty.findMany(),
  ]);
  const tracksOf = (type: LearningContentType, id: number) =>
    tags
      .filter((t) => t.contentType === type && t.contentId === id)
      .map((t) => t.track);
  const difficultyOf = (type: LearningContentType, id: number) =>
    difficulties.find((d) => d.contentType === type && d.contentId === id)
      ?.difficulty;

  const out: Candidate[] = [];
  const setKeyOfExercise = new Map<number, number>();
  for (const q of quizzes) {
    const skill = QUIZ_SKILL[q.type];
    const range = parseCefrRange(q.title);
    if (!skill || skill === 'SPEAKING' || !range) continue;
    out.push({
      type: 'QUIZ',
      id: q.id,
      skill,
      level: itemLevel(range),
      title: q.title,
      route: `${ROUTE[skill]}/${q.id}`,
      difficulty: difficultyOf('QUIZ', q.id) ?? seedDifficulty(range),
      tracks: tracksOf('QUIZ', q.id),
      planLocked: !planSatisfies(
        planCode,
        requiredPracticePlan(skill, range, {
          dictation: isDictationContent(q.bilingualContent),
        }),
      ),
      minutes: MINUTES[skill],
    });
  }
  for (const set of sets) {
    const range = parseCefrRange(set.level);
    const first = set.exercises[0];
    if (!range || !first) continue;
    for (const e of set.exercises) setKeyOfExercise.set(e.id, first.id);
    out.push({
      type: 'SPEAKING_SET',
      id: first.id,
      skill: 'SPEAKING',
      level: itemLevel(range),
      title: set.title,
      route: `/speaking/${first.id}?set=${encodeURIComponent(set.id)}`,
      difficulty:
        difficultyOf('SPEAKING_SET', first.id) ?? seedDifficulty(range),
      tracks: tracksOf('SPEAKING_SET', first.id),
      planLocked: !planSatisfies(
        planCode,
        requiredPracticePlan('SPEAKING', range),
      ),
      minutes: MINUTES.SPEAKING,
    });
  }
  return { candidates: out, setKeyOfExercise };
}

export async function loadLearnerState(
  db: Db,
  userId: number,
  setKeyOfExercise: Map<number, number>,
  now = new Date(),
): Promise<LearnerState & { minutesPerDay: number }> {
  const [profile, levels, submissions, speaking, saved] = await Promise.all([
    db.learnerProfile.findUnique({ where: { userId } }),
    db.learnerSkillLevel.findMany({ where: { userId } }),
    db.submission.findMany({
      where: { userId },
      select: {
        quizId: true,
        score: true,
        submittedAt: true,
        aiFeedback: true,
        quiz: {
          select: { type: true, _count: { select: { questions: true } } },
        },
      },
    }),
    db.speakingSubmission.findMany({
      where: { userId },
      select: { exerciseId: true, overallScore: true, submittedAt: true },
    }),
    db.learningPlanItem.findMany({
      where: { userId, status: 'SAVED' },
      select: { contentType: true, contentId: true },
    }),
  ]);
  const history = new Map<string, HistoryEntry>();
  const record = (key: string, percent: number | null, at: Date) => {
    const prev = history.get(key);
    history.set(key, {
      bestScore:
        prev?.bestScore == null
          ? percent
          : percent == null
            ? prev.bestScore
            : Math.max(prev.bestScore, percent),
      lastAt: prev && prev.lastAt > at ? prev.lastAt : at,
      attempts: (prev?.attempts ?? 0) + 1,
    });
  };
  for (const s of submissions) {
    const skill = QUIZ_SKILL[s.quiz.type];
    if (!skill) continue;
    record(
      contentKey({ type: 'QUIZ', id: s.quizId }),
      skill === 'WRITING'
        ? percentOfAttempt({
            skill,
            score: s.score,
            aiFeedback: s.aiFeedback,
          })
        : percentOfAttempt({
            skill,
            score: s.score,
            questions: s.quiz._count.questions,
          }),
      s.submittedAt,
    );
  }
  for (const s of speaking) {
    const first = setKeyOfExercise.get(s.exerciseId);
    if (first !== undefined)
      record(
        contentKey({ type: 'SPEAKING_SET', id: first }),
        percentOfAttempt({ skill: 'SPEAKING', score: s.overallScore }),
        s.submittedAt,
      );
  }
  const skills: Partial<Record<PracticeSkill, SkillState>> = {};
  for (const l of levels)
    skills[l.skill] = {
      level: l.level,
      unlockedLevel: l.unlockedLevel,
      ability: l.ability,
    };
  return {
    track: profile?.track ?? 'GENERAL',
    minutesPerDay: profile?.minutesPerDay ?? 15,
    skills,
    history,
    saved: new Set(
      saved.map((s) => contentKey({ type: s.contentType, id: s.contentId })),
    ),
    now,
  };
}
