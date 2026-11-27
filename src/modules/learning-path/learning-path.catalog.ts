/**
 * Loads the practice catalog and one learner's state for the recommender.
 *
 * Candidates are standalone, published skill practice with an authored CEFR
 * tag (untagged items have no level and are left out, as the access policy
 * never treats them as free):
 *   Quiz LISTENING_PRACTICE / BILINGUAL_READING / WRITING_*  -> QUIZ, quiz id
 *   SpeakingPracticeSet (SKILL_PRACTICE)                      -> SPEAKING_SET,
 *     contentId = the set's first exercise id (sets have string ids; the
 *     learner opens a set at its first exercise). Its tracks are the set's
 *     own (SpeakingSetTrack), read by set id.
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
  planSatisfies,
  requiredPracticePlan,
} from '../subscription/practice-level';
import { GENERAL_TRACK } from '../learning-track/learning-track.logic';
import { seedDifficulty } from './ability.logic';
import { weakFocus } from './weak-focus.logic';
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
  | 'learningTrack'
  | 'contentDifficulty'
  | 'submission'
  | 'speakingSubmission'
  | 'learnerProfile'
  | 'learnerSkillLevel'
  | 'learningPlanItem'
  | 'diagnosticAttempt'
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
        // A Writing task inside a TOEIC exam set is not standalone practice.
        toeicWritingSetItems: {
          none: { writingSet: { assessmentComponents: { some: {} } } },
        },
      },
      select: {
        id: true,
        type: true,
        title: true,
        practiceLevel: true,
        bilingualContent: true,
      },
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
          select: { id: true, taskType: true },
        },
        tracks: { select: { track: true } },
      },
    }),
    db.contentTrackTag.findMany({
      where: { contentType: 'QUIZ' },
      select: { contentId: true, track: true },
    }),
    db.contentDifficulty.findMany(),
  ]);
  const quizTracksOf = (id: number) =>
    tags.filter((t) => t.contentId === id).map((t) => t.track);
  const difficultyOf = (type: LearningContentType, id: number) =>
    difficulties.find((d) => d.contentType === type && d.contentId === id)
      ?.difficulty;

  const out: Candidate[] = [];
  const setKeyOfExercise = new Map<number, number>();
  for (const q of quizzes) {
    const skill = QUIZ_SKILL[q.type];
    const level = q.practiceLevel;
    if (!skill || skill === 'SPEAKING' || !level) continue;
    const requiredPlan = requiredPracticePlan(skill, level, {
      dictation: isDictationContent(q.bilingualContent),
    });
    out.push({
      type: 'QUIZ',
      id: q.id,
      skill,
      level,
      title: q.title,
      route: `${ROUTE[skill]}/${q.id}`,
      difficulty: difficultyOf('QUIZ', q.id) ?? seedDifficulty(level),
      tracks: quizTracksOf(q.id),
      kinds: [q.type],
      planLocked: !planSatisfies(planCode, requiredPlan),
      requiredPlan,
      minutes: MINUTES[skill],
    });
  }
  for (const set of sets) {
    const level = set.level;
    const first = set.exercises[0];
    if (!first) continue;
    for (const e of set.exercises) setKeyOfExercise.set(e.id, first.id);
    const requiredPlan = requiredPracticePlan('SPEAKING', level);
    out.push({
      type: 'SPEAKING_SET',
      id: first.id,
      skill: 'SPEAKING',
      level,
      title: set.title,
      route: `/speaking/${first.id}?set=${encodeURIComponent(set.id)}`,
      difficulty:
        difficultyOf('SPEAKING_SET', first.id) ?? seedDifficulty(level),
      tracks: set.tracks.map((t) => t.track),
      kinds: [...new Set(set.exercises.map((e) => String(e.taskType)))],
      planLocked: !planSatisfies(planCode, requiredPlan),
      requiredPlan,
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
  const [profile, levels, submissions, speaking, saved, diagnostic] =
    await Promise.all([
      db.learnerProfile.findUnique({
        where: { userId },
        include: { trackRef: { select: { name: true } } },
      }),
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
      db.diagnosticAttempt.findFirst({
        where: { userId, status: 'COMPLETED' },
        orderBy: { id: 'desc' },
        select: {
          speakingResponses: {
            where: { status: 'GRADED' },
            select: { scoreMetadata: true },
          },
          writingResponses: {
            where: { status: 'GRADED' },
            select: { scoreMetadata: true },
          },
        },
      }),
    ]);
  const criteriaOf = (meta: unknown) =>
    (meta as { criteria?: Record<string, number | null> } | null)?.criteria;
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
  // Before onboarding there is no profile: the learner is on GENERAL.
  const trackName =
    profile?.trackRef?.name ??
    (
      await db.learningTrack.findUnique({
        where: { code: GENERAL_TRACK },
        select: { name: true },
      })
    )?.name ??
    GENERAL_TRACK;
  return {
    track: profile?.track ?? GENERAL_TRACK,
    trackName,
    goal: profile?.goal ?? 'GENERAL',
    weakFocus: weakFocus([
      ...(diagnostic?.speakingResponses ?? []).map((r) => ({
        skill: 'SPEAKING' as const,
        criteria: criteriaOf(r.scoreMetadata),
      })),
      ...(diagnostic?.writingResponses ?? []).map((r) => ({
        skill: 'WRITING' as const,
        criteria: criteriaOf(r.scoreMetadata),
      })),
    ]),
    minutesPerDay: profile?.minutesPerDay ?? 15,
    skills,
    history,
    saved: new Set(
      saved.map((s) => contentKey({ type: s.contentType, id: s.contentId })),
    ),
    now,
  };
}
