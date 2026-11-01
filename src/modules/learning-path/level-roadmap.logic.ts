/**
 * The path for a learner past Mất gốc (F25). Milestones come from the unlock
 * rule and the content tags, not from a list of items, so new content joins
 * the path by itself. Same shape as the starter roadmap. No Prisma, no I/O.
 */
import type { PracticeLevel, PracticeSkill } from '@prisma/client';

import {
  decksToLearn,
  deckLevel,
  grammarLevel,
  grammarToStudy,
  type DeckInput,
  type GrammarInput,
} from './foundation.logic';
import { PRACTICE_LEVEL_LABEL, levelIndex } from './placement.logic';
import {
  PROGRESS_AVERAGE,
  PROGRESS_ITEMS,
  nextLevel,
} from './progression.logic';
import { deckDone } from './starter-roadmap.logic';
import { ITEM_MINUTES } from './week.logic';

const SKILL_LABEL: Record<PracticeSkill, string> = {
  LISTENING: 'Nghe',
  READING: 'Đọc',
  SPEAKING: 'Nói',
  WRITING: 'Viết',
};
const SKILL_ROUTE: Record<PracticeSkill, string> = {
  LISTENING: '/listening',
  READING: '/reading',
  SPEAKING: '/speaking',
  WRITING: '/writing',
};
const FOUNDATION_MINUTES = 10;

export type RoadmapSkill = {
  skill: PracticeSkill;
  unlockedLevel: PracticeLevel;
  done: number;
  average: number | null;
  /** The best open item to do next, when there is one. */
  nextRoute: string | null;
};

function skillStep(s: RoadmapSkill, level: PracticeLevel) {
  const passed = levelIndex(s.unlockedLevel) > levelIndex(level);
  const next = nextLevel(s.unlockedLevel);
  const met = s.done >= PROGRESS_ITEMS && (s.average ?? 0) >= PROGRESS_AVERAGE;
  const label = SKILL_LABEL[s.skill];
  return {
    key: `skill-${s.skill}`,
    title: next
      ? `${label}: mở mức ${PRACTICE_LEVEL_LABEL[next]}`
      : `${label}: giữ vững mức ${PRACTICE_LEVEL_LABEL[s.unlockedLevel]}`,
    why: passed
      ? `Đã vượt mức ${PRACTICE_LEVEL_LABEL[level]}.`
      : `Đã làm ${Math.min(s.done, PROGRESS_ITEMS)}/${PROGRESS_ITEMS} bài, cần trung bình từ ${PROGRESS_AVERAGE}%.`,
    minutes: ITEM_MINUTES[s.skill],
    route: s.nextRoute ?? SKILL_ROUTE[s.skill],
    done: passed || (!next && met),
    locked: false,
  };
}

function grammarStep(topics: GrammarInput[], level: PracticeLevel) {
  const own = topics.filter((t) => grammarLevel(t.level) === level);
  if (!own.length) return [];
  const open = grammarToStudy(own, level);
  return [
    {
      key: 'grammar',
      title: `Ngữ pháp mức ${PRACTICE_LEVEL_LABEL[level]}`,
      why: `Đã đạt ${own.length - open.length}/${own.length} chủ đề.`,
      minutes: FOUNDATION_MINUTES,
      route: open[0]?.route ?? '/reading?category=grammar',
      done: open.length === 0,
      locked: false,
    },
  ];
}

function vocabStep(decks: DeckInput[], level: PracticeLevel) {
  const own = decks.filter((d) => deckLevel(d.level) === level);
  if (!own.length) return [];
  const learned = own.filter((d) => deckDone(d.mastered, d.total)).length;
  const open = decksToLearn(own, level);
  return [
    {
      key: 'vocab',
      title: `Từ vựng mức ${PRACTICE_LEVEL_LABEL[level]}`,
      why: `Đã học ${learned}/${own.length} bộ từ.`,
      minutes: FOUNDATION_MINUTES,
      route: open[0]?.route ?? '/flashcard',
      done: learned === own.length,
      locked: false,
    },
  ];
}

export function buildLevelRoadmap(input: {
  level: PracticeLevel;
  skills: RoadmapSkill[];
  grammar: GrammarInput[];
  decks: DeckInput[];
}) {
  const { level } = input;
  const steps = [
    ...input.skills.map((s) => skillStep(s, level)),
    ...grammarStep(input.grammar, level),
    ...vocabStep(input.decks, level),
  ];
  return {
    level,
    title: `Lộ trình mức ${PRACTICE_LEVEL_LABEL[level]}`,
    steps,
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    nextKey: steps.find((step) => !step.done)?.key ?? null,
  };
}
