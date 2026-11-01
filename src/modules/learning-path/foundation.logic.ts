/**
 * Vocabulary and grammar suggestions (F23). These are not one of the four
 * practice skills and have no ability estimate, so they are a short ordered
 * list beside the ranked practice items: due words, then grammar topics not
 * yet passed and decks not yet learned, nearest the learner's level first.
 * Pure: no Prisma, no I/O.
 */
import type { PracticeLevel } from '@prisma/client';

import { parseCefrRange } from '../subscription/practice-level';
import { itemLevel } from './ability.logic';
import { PRACTICE_LEVEL_LABEL, levelIndex } from './placement.logic';
import { PROGRESS_AVERAGE } from './progression.logic';

export type FoundationKind = 'VOCAB_REVIEW' | 'GRAMMAR' | 'VOCAB_DECK';

export type FoundationItem = {
  kind: FoundationKind;
  /** Topic or deck id; null for the review of all due words. */
  id: number | null;
  title: string;
  route: string;
  minutes: number;
  reason: string;
};

export type GrammarInput = {
  id: number;
  title: string;
  level: string;
  /** Best attempt, 0-100; null when never attempted. */
  best: number | null;
};

export type DeckInput = {
  id: number;
  title: string;
  /** CEFR content tag; null on a deck that has none yet. */
  level: string | null;
  total: number;
  mastered: number;
};

const ITEM_MINUTES = 10;
const WORDS_PER_MINUTE = 2;

const GRAMMAR_LEVELS: Record<string, PracticeLevel> = {
  BEGINNER: 'BASIC',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
};

export const grammarLevel = (level: string): PracticeLevel =>
  GRAMMAR_LEVELS[level] ?? 'BASIC';

export function deckLevel(level: string | null): PracticeLevel | null {
  if (!level) return null;
  const range = parseCefrRange(`(${level})`);
  return range ? itemLevel(range) : null;
}

/** Own level first, then one below, then one above; further away never. */
function distance(item: PracticeLevel, learner: PracticeLevel): number | null {
  const gap = levelIndex(item) - levelIndex(learner);
  if (gap === 0) return 0;
  if (gap === -1) return 1;
  if (gap === 1) return 2;
  return null;
}

function nearest<T>(
  items: T[],
  levelOf: (item: T) => PracticeLevel | null,
  learner: PracticeLevel,
): T[] {
  const ranked = items.map((item) => {
    const level = levelOf(item);
    return { item, rank: level === null ? 3 : distance(level, learner) };
  });
  return ranked
    .filter((r) => r.rank !== null)
    .sort((a, b) => (a.rank as number) - (b.rank as number))
    .map((r) => r.item);
}

export function grammarToStudy(
  topics: GrammarInput[],
  learner: PracticeLevel,
): FoundationItem[] {
  const open = topics.filter(
    (t) => t.best === null || t.best < PROGRESS_AVERAGE,
  );
  return nearest(open, (t) => grammarLevel(t.level), learner).map((t) => ({
    kind: 'GRAMMAR',
    id: t.id,
    title: t.title,
    route: `/reading?category=grammar&topicId=${t.id}`,
    minutes: ITEM_MINUTES,
    reason:
      t.best === null
        ? `Ngữ pháp mức ${PRACTICE_LEVEL_LABEL[grammarLevel(t.level)]}`
        : `Lần gần nhất bạn đạt ${t.best}%, nên ôn lại`,
  }));
}

export function decksToLearn(
  decks: DeckInput[],
  learner: PracticeLevel,
): FoundationItem[] {
  const open = decks.filter((d) => d.total > 0 && d.mastered < d.total);
  return nearest(open, (d) => deckLevel(d.level), learner).map((d) => {
    const level = deckLevel(d.level);
    return {
      kind: 'VOCAB_DECK',
      id: d.id,
      title: d.title,
      route: `/flashcard/${d.id}`,
      minutes: ITEM_MINUTES,
      reason:
        d.mastered > 0
          ? `Đã thuộc ${d.mastered}/${d.total} từ`
          : level
            ? `Từ vựng mức ${PRACTICE_LEVEL_LABEL[level]}`
            : 'Bộ từ vựng bạn chưa học',
    };
  });
}

/** Due words first, then grammar and decks in turn, up to `max` items. */
export function foundationPlan(
  input: {
    learner: PracticeLevel;
    dueWords: number;
    grammar: GrammarInput[];
    decks: DeckInput[];
  },
  max: number,
): FoundationItem[] {
  const plan: FoundationItem[] = [];
  if (input.dueWords > 0)
    plan.push({
      kind: 'VOCAB_REVIEW',
      id: null,
      title: `Ôn ${input.dueWords} từ đến hạn`,
      route: '/vocabulary/study',
      minutes: Math.max(1, Math.ceil(input.dueWords / WORDS_PER_MINUTE)),
      reason: 'Ôn đúng lúc để không quên',
    });
  const grammar = grammarToStudy(input.grammar, input.learner);
  const decks = decksToLearn(input.decks, input.learner);
  while (plan.length < max && (grammar.length || decks.length)) {
    const next = grammar.shift();
    if (next) plan.push(next);
    const deck = plan.length < max ? decks.shift() : undefined;
    if (deck) plan.push(deck);
  }
  return plan;
}
