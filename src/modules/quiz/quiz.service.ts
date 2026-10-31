import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ListeningPracticeAttemptStatus,
  Prisma,
  QuizType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
  CheckPracticeQuestionDto,
  SaveListeningAttemptDto,
  PublishQuizDto,
} from './dto/quiz.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../ai/ai.service';
import { SpeakingService } from '../speaking/speaking.service';
import {
  isPrivateListeningMediaKey,
  PRIVATE_LISTENING_MEDIA_PREFIX,
  UploadService,
} from '../upload/upload.service';
import {
  ListeningAudioAuthoringService,
  PublishedListeningAudioIdentity,
} from './listening-audio-authoring.service';
import {
  normalizeDialogueSegments,
  withSpeakerTurnIds,
  type NormalizedDialogueSegment,
} from './listening-dialogue.contract';
import {
  resolveReadingCorrectOption,
  validateReadingQuestionContent,
} from './reading-content.validation';
import { QuizContentAccessService } from './quiz-content-access.service';
import { loadWritingExerciseProgress } from '../writing/writing-exercise-progress';
import {
  isWritingQuizType,
  learnerVisibleTaskContent,
} from '../writing/writing-task-visibility';

/**
 * Compare learner dictation without penalising typography that does not change
 * what was heard (capitalisation, punctuation, curly apostrophes or spacing).
 */
export function normalizeListeningAnswer(value: unknown): string {
  return normalizeStandardListeningTokens(value).join(' ');
}

/**
 * Validate a Reading submission against the server-owned current question set.
 * The validator intentionally runs before any persistence or side effect.
 */
export function validateReadingSubmission(
  questions: Array<{ id: number; type?: string; content?: unknown }>,
  answers: Array<{ questionId: number; answer: unknown }>,
) {
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new BadRequestException(
      'Hãy trả lời đầy đủ tất cả câu hỏi trước khi nộp bài',
    );
  }

  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const seenQuestionIds = new Set<number>();

  for (const submitted of answers) {
    const question = questionsById.get(submitted.questionId);
    if (!question) {
      throw new BadRequestException(
        'Câu trả lời chứa câu hỏi không thuộc bài này',
      );
    }
    if (seenQuestionIds.has(submitted.questionId)) {
      throw new BadRequestException('Không được gửi trùng câu hỏi');
    }
    if (
      typeof submitted.answer !== 'string' ||
      submitted.answer.trim().length === 0
    ) {
      throw new BadRequestException('Mỗi câu hỏi phải có một câu trả lời');
    }

    const content = (question.content ?? {}) as Record<string, unknown>;
    const options = content.options;
    if (
      question.type === 'MULTIPLE_CHOICE' &&
      Array.isArray(options) &&
      !options.some((option) => option === submitted.answer)
    ) {
      throw new BadRequestException(
        'Câu trả lời không nằm trong các lựa chọn hiện tại',
      );
    }

    seenQuestionIds.add(submitted.questionId);
  }
}

function canonicalizeAttemptAnswer(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFKC');
  return value;
}

export function canonicalizeReadingAttemptAnswers(
  answers: Array<{ questionId: number; answer: unknown }>,
): string {
  return JSON.stringify(
    [...answers]
      .sort((a, b) => a.questionId - b.questionId)
      .map((answer) => ({
        questionId: answer.questionId,
        answer: canonicalizeAttemptAnswer(answer.answer),
      })),
  );
}

function isClientAttemptUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  return (
    Array.isArray(target) &&
    target.includes('userId') &&
    target.includes('quizId') &&
    target.includes('clientAttemptId')
  );
}

/** Resolve a pedagogical Reading micro-skill without treating READING as one. */
export function resolveReadingMicroSkill(
  quizType: QuizType | (string & {}),
  content: unknown,
  legacyQuestionType?: string,
): string {
  const record =
    content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};

  if (quizType !== QuizType.BILINGUAL_READING) {
    const category = record.category;
    return typeof category === 'string' && category.trim().length > 0
      ? category
      : legacyQuestionType || 'General';
  }

  const skill = record.skill;
  if (
    typeof skill === 'string' &&
    skill.trim().length > 0 &&
    !['READING', 'BILINGUAL_READING'].includes(skill.trim().toUpperCase())
  ) {
    return skill.trim().toUpperCase();
  }

  for (const key of ['questionType', 'category']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().toUpperCase();
    }
  }
  return 'UNKNOWN';
}

const STANDARD_CONTRACTIONS: Record<string, string[]> = {
  "we're": ['we', 'are'],
  "you're": ['you', 'are'],
  "they're": ['they', 'are'],
  "we've": ['we', 'have'],
  "i've": ['i', 'have'],
  "they've": ['they', 'have'],
  "we'll": ['we', 'will'],
  "i'll": ['i', 'will'],
  "they'll": ['they', 'will'],
  "can't": ['cannot'],
  "won't": ['will', 'not'],
  "don't": ['do', 'not'],
  "doesn't": ['does', 'not'],
  "didn't": ['did', 'not'],
  "isn't": ['is', 'not'],
  "aren't": ['are', 'not'],
  "wasn't": ['was', 'not'],
  "weren't": ['were', 'not'],
  "hasn't": ['has', 'not'],
  "haven't": ['have', 'not'],
  "hadn't": ['had', 'not'],
  "let's": ['let', 'us'],
  // Apostrophe-free forms remain compatible with STANDARD's punctuation policy.
  lets: ['let', 'us'],
  its: ['it', 'is'],
};

const AMBIGUOUS_CONTRACTIONS: Record<string, [string[], string[]]> = {
  "i'd": [
    ['i', 'would'],
    ['i', 'had'],
  ],
  "we'd": [
    ['we', 'would'],
    ['we', 'had'],
  ],
  "they'd": [
    ['they', 'would'],
    ['they', 'had'],
  ],
  "he's": [
    ['he', 'is'],
    ['he', 'has'],
  ],
  "she's": [
    ['she', 'is'],
    ['she', 'has'],
  ],
  "it's": [
    ['it', 'is'],
    ['it', 'has'],
  ],
  "that's": [
    ['that', 'is'],
    ['that', 'has'],
  ],
  "there's": [
    ['there', 'is'],
    ['there', 'has'],
  ],
};

function tokenizeStandardListeningAnswer(value: unknown): string[] {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])'+|'+(?![\p{L}\p{N}])/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikePastParticiple(token: string | undefined): boolean {
  if (!token) return false;
  return (
    /(?:ed|en)$/.test(token) ||
    new Set([
      'gone',
      'done',
      'seen',
      'been',
      'had',
      'made',
      'left',
      'read',
    ]).has(token)
  );
}

function expandStandardContraction(
  token: string,
  nextToken?: string,
): string[] {
  const direct = STANDARD_CONTRACTIONS[token];
  if (direct) return direct;
  const ambiguous = AMBIGUOUS_CONTRACTIONS[token];
  if (!ambiguous) return [token];
  return looksLikePastParticiple(nextToken) ? ambiguous[1] : ambiguous[0];
}

/**
 * STANDARD mode compares lexical content while treating ordinary contractions
 * and their canonical full forms as equivalent. Ambiguous forms are resolved
 * from their local sentence context instead of being expanded many-to-many.
 */
export function normalizeStandardListeningTokens(value: unknown): string[] {
  const tokens = tokenizeStandardListeningAnswer(value);
  return tokens.flatMap((token, index) =>
    expandStandardContraction(token, tokens[index + 1]),
  );
}

/**
 * Keep speaker labels for the visual transcript, but never send labels such as
 * "Customer:" or "Agent:" to speech synthesis. Reading those labels aloud
 * makes a dialogue sound like metadata instead of a natural conversation.
 */
export function buildNaturalListeningAudioText(
  content: Record<string, unknown>,
): string {
  const segments = content.transcriptSegments;
  if (Array.isArray(segments)) {
    const spokenLines = segments
      .filter(
        (segment): segment is { text: string } =>
          Boolean(segment) &&
          typeof segment === 'object' &&
          typeof (segment as { text?: unknown }).text === 'string',
      )
      .map((segment) => segment.text.trim())
      .filter(Boolean);

    if (spokenLines.length > 0) return spokenLines.join(' ');
  }

  const audioText =
    typeof content.audioText === 'string' ? content.audioText : '';
  return audioText
    .replace(
      /(^|\s)(?:customer|agent|barista|assistant|employee|manager|interviewer|caller|staff|speaker\s*\d*)\s*:\s*/gi,
      '$1',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export { normalizeDialogueSegments } from './listening-dialogue.contract';

function dedupeDialogueBlocks(
  blocks: NormalizedDialogueSegment[][],
): NormalizedDialogueSegment[] {
  const seen = new Set<string>();
  return blocks.flatMap((block) => {
    const key = JSON.stringify(
      block.map(({ speaker, speakerId, text, translation }) => ({
        speaker,
        speakerId,
        text,
        translation,
      })),
    );
    if (seen.has(key)) return [];
    seen.add(key);
    return block;
  });
}

function normalizeQuestionContent(
  quizType: QuizType,
  questionType: string,
  value: unknown,
  readingMode: 'DRAFT' | 'PUBLISHED' = 'DRAFT',
): Record<string, unknown> {
  const content =
    value && typeof value === 'object'
      ? { ...(value as Record<string, unknown>) }
      : {};

  if (
    quizType === QuizType.LISTENING_PRACTICE &&
    questionType.toUpperCase() === 'DIALOGUE'
  ) {
    const transcriptSegments = withSpeakerTurnIds(
      normalizeDialogueSegments(content.transcriptSegments),
    );
    const speakers = new Set(
      transcriptSegments.map((segment) => segment.speakerId ?? segment.speaker),
    );
    if (transcriptSegments.length < 2 || speakers.size < 2) {
      throw new BadRequestException(
        'Hội thoại cần ít nhất 2 lượt lời và 2 người nói khác nhau.',
      );
    }
    content.transcriptSegments = transcriptSegments;
    content.audioText = transcriptSegments
      .map((segment) => segment.text)
      .join(' ');
  }

  if (quizType === QuizType.BILINGUAL_READING) {
    return validateReadingQuestionContent(content, readingMode);
  }

  return content;
}

function normalizeStrictListeningAnswer(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateDictationWordAccuracy(
  expected: string,
  submitted: string,
  mode: 'STANDARD' | 'STRICT',
): number {
  const normalize =
    mode === 'STRICT'
      ? normalizeStrictListeningAnswer
      : normalizeListeningAnswer;
  const expectedWords =
    mode === 'STANDARD'
      ? normalizeStandardListeningTokens(expected)
      : normalize(expected).split(/\s+/).filter(Boolean);
  const submittedWords =
    mode === 'STANDARD'
      ? normalizeStandardListeningTokens(submitted)
      : normalize(submitted).split(/\s+/).filter(Boolean);
  if (expectedWords.length === 0) return 0;

  const dp = Array.from({ length: expectedWords.length + 1 }, () =>
    new Array<number>(submittedWords.length + 1).fill(0),
  );
  for (let i = 1; i <= expectedWords.length; i += 1) {
    for (let j = 1; j <= submittedWords.length; j += 1) {
      dp[i][j] =
        expectedWords[i - 1] === submittedWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return Math.round(
    (dp[expectedWords.length][submittedWords.length] / expectedWords.length) *
      100,
  );
}

export type DictationTokenStatus = 'CORRECT' | 'WRONG' | 'MISSING' | 'EXTRA';

export interface DictationFeedbackToken {
  status: DictationTokenStatus;
  text?: string;
}

const COMMON_PREPOSITIONS = new Set([
  'to',
  'at',
  'in',
  'on',
  'for',
  'by',
  'with',
  'from',
  'about',
  'into',
  'through',
  'after',
  'before',
  'under',
  'between',
  'among',
  'of',
  'off',
  'over',
  'up',
  'down',
  'out',
]);

const COMMON_DETERMINERS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'its',
]);

const COMMON_AUXILIARIES = new Set([
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'is',
  'am',
  'are',
  'was',
  'were',
  'will',
  'would',
  'can',
  'could',
  'should',
  'must',
]);

export function alignDictationFeedbackTokens(
  expected: string,
  submitted: string,
  mode: 'STANDARD' | 'STRICT',
): DictationFeedbackToken[] {
  const normalize =
    mode === 'STRICT'
      ? normalizeStrictListeningAnswer
      : normalizeListeningAnswer;
  const expectedWords =
    mode === 'STANDARD'
      ? normalizeStandardListeningTokens(expected)
      : normalize(expected).split(/\s+/).filter(Boolean);
  const submittedWords =
    mode === 'STANDARD'
      ? normalizeStandardListeningTokens(submitted)
      : normalize(submitted).split(/\s+/).filter(Boolean);

  if (expectedWords.length === 0) {
    return submittedWords.map((word) => ({ status: 'EXTRA', text: word }));
  }
  if (submittedWords.length === 0) {
    return expectedWords.map(() => ({ status: 'MISSING' }));
  }

  const rows = expectedWords.length + 1;
  const cols = submittedWords.length + 1;
  const dp = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );

  for (let i = expectedWords.length - 1; i >= 0; i -= 1) {
    for (let j = submittedWords.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        expectedWords[i] === submittedWords[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rawDiff: Array<{
    type: 'same' | 'missing' | 'extra';
    expWord?: string;
    subWord?: string;
  }> = [];

  let i = 0;
  let j = 0;
  while (i < expectedWords.length || j < submittedWords.length) {
    if (
      i < expectedWords.length &&
      j < submittedWords.length &&
      expectedWords[i] === submittedWords[j]
    ) {
      rawDiff.push({
        type: 'same',
        expWord: expectedWords[i],
        subWord: submittedWords[j],
      });
      i += 1;
      j += 1;
    } else if (
      j < submittedWords.length &&
      (i === expectedWords.length || dp[i][j + 1] >= dp[i + 1][j])
    ) {
      rawDiff.push({ type: 'extra', subWord: submittedWords[j] });
      j += 1;
    } else {
      rawDiff.push({ type: 'missing', expWord: expectedWords[i] });
      i += 1;
    }
  }

  // Pair consecutive (extra, missing) or (missing, extra) as WRONG (substituted word)
  const tokens: DictationFeedbackToken[] = [];
  let k = 0;
  while (k < rawDiff.length) {
    const curr = rawDiff[k];
    const next = rawDiff[k + 1];

    if (
      (curr.type === 'extra' && next?.type === 'missing') ||
      (curr.type === 'missing' && next?.type === 'extra')
    ) {
      tokens.push({ status: 'WRONG' });
      k += 2;
    } else if (curr.type === 'same') {
      tokens.push({ status: 'CORRECT', text: curr.subWord });
      k += 1;
    } else if (curr.type === 'extra') {
      tokens.push({ status: 'EXTRA', text: curr.subWord });
      k += 1;
    } else {
      tokens.push({ status: 'MISSING' });
      k += 1;
    }
  }

  return tokens;
}

export function generateSafeRelativeDictationHint(
  expected: string,
  submitted: string,
  tokens?: DictationFeedbackToken[],
): string {
  const safeTokens =
    tokens ?? alignDictationFeedbackTokens(expected, submitted, 'STANDARD');

  const expTokens = normalizeStandardListeningTokens(expected);
  const subTokens = normalizeStandardListeningTokens(submitted);

  if (subTokens.length === 0) {
    return 'Lắng nghe kỹ câu trong audio và nhập những gì bạn nghe được.';
  }

  const hasExtra = safeTokens.some((t) => t.status === 'EXTRA');
  const hasWrongOrMissing = safeTokens.some(
    (t) => t.status === 'WRONG' || t.status === 'MISSING',
  );

  if (hasExtra && !hasWrongOrMissing) {
    return 'Có từ thừa trong câu trả lời, hãy nghe kỹ lại và lược bỏ.';
  }

  let mismatchIdx = -1;
  for (let idx = 0; idx < expTokens.length; idx += 1) {
    if (idx >= subTokens.length || expTokens[idx] !== subTokens[idx]) {
      mismatchIdx = idx;
      break;
    }
  }

  if (mismatchIdx === -1) {
    if (subTokens.length > expTokens.length) {
      return 'Có từ thừa trong câu trả lời, hãy nghe kỹ lại và lược bỏ.';
    }
    return 'Hãy tiếp tục lắng nghe các từ còn lại.';
  }

  const expWord = expTokens[mismatchIdx];
  const subWord = subTokens[mismatchIdx];
  const prevExpWord = mismatchIdx > 0 ? expTokens[mismatchIdx - 1] : null;

  if (COMMON_PREPOSITIONS.has(expWord)) {
    return 'Kiểm tra giới từ hoặc từ nối ở vị trí này.';
  }

  if (COMMON_DETERMINERS.has(expWord)) {
    return 'Kiểm tra mạo từ (a, an, the) hoặc từ hạn định ở vị trí này.';
  }

  if (COMMON_AUXILIARIES.has(expWord)) {
    return 'Kiểm tra trợ động từ hoặc dạng viết tắt (auxiliary verb).';
  }

  if (subWord) {
    const baseExp = expWord.replace(/(?:ing|ed|es|s)$/, '');
    const baseSub = subWord.replace(/(?:ing|ed|es|s)$/, '');
    if (baseExp.length >= 3 && baseExp === baseSub) {
      if (expWord.endsWith('s') || expWord.endsWith('es')) {
        if (prevExpWord && ['he', 'she', 'it'].includes(prevExpWord)) {
          return `Kiểm tra dạng động từ phù hợp với chủ ngữ ngôi thứ ba số ít (“${prevExpWord}”).`;
        }
        return 'Kiểm tra dạng động từ theo chủ ngữ (chú ý ngôi và số ít / số nhiều).';
      }
      if (expWord.endsWith('ed')) {
        return 'Chú ý thì của động từ (kiểm tra âm đuôi quá khứ -ed).';
      }
      if (expWord.endsWith('ing')) {
        return 'Chú ý dạng động từ đuôi -ing (dạng tiếp diễn hoặc danh động từ).';
      }
      return 'Chú ý phụ âm cuối hoặc dạng biến đổi của từ.';
    }
  }

  if (expWord.endsWith('ed') || looksLikePastParticiple(expWord)) {
    return 'Câu đang nói về một hành động trong quá khứ, hãy chú ý thì của động từ.';
  }

  if (
    prevExpWord &&
    ['he', 'she', 'it'].includes(prevExpWord) &&
    (expWord.endsWith('s') || expWord.endsWith('es'))
  ) {
    return `Động từ cần phù hợp với chủ ngữ ngôi thứ ba số ít (“${prevExpWord}”).`;
  }

  if (prevExpWord) {
    return `Nghe kỹ lại phần ngay sau từ “${prevExpWord}”.`;
  }

  return 'Nghe kỹ lại phần đầu của câu.';
}

export function getLexicalLetterCount(word: string): number {
  return word.replace(/[^A-Za-z]/g, '').length;
}

export function maskExpectedWord(canonicalToken: string): string {
  const letterCount = getLexicalLetterCount(canonicalToken);
  const asterisks = '*'.repeat(letterCount > 0 ? letterCount : 1);
  const trailingPunctMatch = canonicalToken.match(/([.,!?:;]+)$/);
  const trailingPunct = trailingPunctMatch ? trailingPunctMatch[1] : '';
  return `${asterisks}${trailingPunct}`;
}

export interface ProgressiveDictationFeedback {
  isCorrect: boolean;
  verifiedPrefix: string;
  nextWordMask: string;
  remainingMasks: string[];
  nextErrorType: 'WRONG' | 'MISSING' | 'EXTRA' | null;
  hint: string | null;
  wordAccuracy: number;
}

function generateProgressiveRelativeHint(
  canonicalTokens: string[],
  normSubmittedTokens: string[],
  matchedCanonicalCount: number,
  subIndex: number,
  nextErrorType: 'WRONG' | 'MISSING' | 'EXTRA',
): string {
  if (normSubmittedTokens.length === 0) {
    return 'Hãy nghe kỹ phần đầu câu.';
  }

  const prevCanonical =
    matchedCanonicalCount > 0
      ? canonicalTokens[matchedCanonicalCount - 1].replace(/[^A-Za-z]/g, '')
      : null;

  if (nextErrorType === 'EXTRA') {
    if (prevCanonical) {
      return `Có một từ thừa ngay sau “${prevCanonical}”. Hãy nghe lại phần này.`;
    }
    return 'Có từ thừa ở đầu câu trả lời, hãy nghe lại và lược bỏ.';
  }

  if (matchedCanonicalCount >= canonicalTokens.length) {
    return 'Có từ thừa ở cuối câu trả lời, hãy nghe lại và lược bỏ.';
  }

  const nextCanonical = canonicalTokens[matchedCanonicalCount];
  const nextExpWord = normalizeStandardListeningTokens(nextCanonical)[0] ?? '';
  const currentSubWord =
    subIndex < normSubmittedTokens.length ? normSubmittedTokens[subIndex] : '';

  if (COMMON_PREPOSITIONS.has(nextExpWord)) {
    if (prevCanonical) {
      return `Kiểm tra từ nối hoặc giới từ ngay sau “${prevCanonical}”.`;
    }
    return 'Kiểm tra giới từ hoặc từ nối ở vị trí này.';
  }

  if (COMMON_DETERMINERS.has(nextExpWord)) {
    return 'Kiểm tra mạo từ (a, an, the) hoặc từ hạn định ở vị trí này.';
  }

  if (COMMON_AUXILIARIES.has(nextExpWord)) {
    return 'Kiểm tra trợ động từ hoặc dạng viết tắt (auxiliary verb).';
  }

  if (currentSubWord) {
    const baseExp = nextExpWord.replace(/(?:ing|ed|es|s)$/, '');
    const baseSub = currentSubWord.replace(/(?:ing|ed|es|s)$/, '');
    if (baseExp.length >= 3 && baseExp === baseSub) {
      if (nextExpWord.endsWith('s') || nextExpWord.endsWith('es')) {
        if (
          prevCanonical &&
          ['he', 'she', 'it'].includes(prevCanonical.toLowerCase())
        ) {
          return `Kiểm tra dạng động từ với chủ ngữ “${prevCanonical}”.`;
        }
        return 'Kiểm tra dạng động từ theo chủ ngữ (chú ý ngôi và số ít / số nhiều).';
      }
      if (nextExpWord.endsWith('ed')) {
        return 'Chú ý thì của động từ (kiểm tra âm đuôi quá khứ -ed).';
      }
      if (nextExpWord.endsWith('ing')) {
        return 'Chú ý dạng động từ đuôi -ing (dạng tiếp diễn hoặc danh động từ).';
      }
      return 'Chú ý phụ âm cuối hoặc dạng biến đổi của từ.';
    }
  }

  if (nextExpWord.endsWith('ed') || looksLikePastParticiple(nextExpWord)) {
    return 'Câu đang nói về một hành động trong quá khứ, hãy chú ý thì của động từ.';
  }

  if (
    prevCanonical &&
    ['he', 'she', 'it'].includes(prevCanonical.toLowerCase()) &&
    (nextExpWord.endsWith('s') || nextExpWord.endsWith('es'))
  ) {
    return `Kiểm tra dạng động từ với chủ ngữ “${prevCanonical}”.`;
  }

  if (prevCanonical) {
    return `Nghe kỹ lại phần ngay sau “${prevCanonical}”.`;
  }

  return 'Hãy nghe kỹ phần đầu câu.';
}

export function canonicalizeSubmittedDictation(
  expected: string,
  submitted: string,
): string {
  if (!submitted || typeof submitted !== 'string') return '';
  const trimmedSubmitted = submitted.trim();
  if (trimmedSubmitted.length === 0) return '';
  if (!expected || typeof expected !== 'string') return trimmedSubmitted;

  const expectedWords = expected.trim().split(/\s+/).filter(Boolean);
  const submittedWords = trimmedSubmitted.split(/\s+/).filter(Boolean);
  if (expectedWords.length === 0) return trimmedSubmitted;

  let mismatchFound = false;
  const normalizedWords: string[] = [];

  for (let i = 0; i < submittedWords.length; i += 1) {
    const subWord = submittedWords[i];
    const expWord = expectedWords[i];

    const normSub = normalizeStandardListeningTokens(subWord).join(' ');
    const normExp = normalizeStandardListeningTokens(expWord).join(' ');
    const strippedSub = normSub.replace(/[^a-z0-9]/g, '');
    const strippedExp = normExp.replace(/[^a-z0-9]/g, '');

    const isMatch =
      normSub === normExp ||
      (strippedSub.length > 0 && strippedSub === strippedExp);

    if (!mismatchFound && expWord && isMatch) {
      normalizedWords.push(expWord);
    } else {
      mismatchFound = true;
      normalizedWords.push(subWord);
    }
  }

  return normalizedWords.join(' ');
}

export function calculateProgressiveDictationFeedback(
  expected: string,
  submitted: string,
): ProgressiveDictationFeedback {
  const trimmedExpected = String(expected ?? '').trim();
  const trimmedSubmitted = String(submitted ?? '').trim();

  const canonicalTokens = trimmedExpected.split(/\s+/).filter(Boolean);
  const normSubmittedTokens =
    normalizeStandardListeningTokens(trimmedSubmitted);
  const normExpectedTokens = normalizeStandardListeningTokens(trimmedExpected);

  const isCorrect =
    normSubmittedTokens.length === normExpectedTokens.length &&
    normSubmittedTokens.every((t, i) => t === normExpectedTokens[i]);

  const wordAccuracy = calculateDictationWordAccuracy(
    trimmedExpected,
    trimmedSubmitted,
    'STANDARD',
  );

  if (isCorrect) {
    return {
      isCorrect: true,
      verifiedPrefix: trimmedExpected,
      nextWordMask: '',
      remainingMasks: [],
      nextErrorType: null,
      hint: null,
      wordAccuracy: 100,
    };
  }

  let subIndex = 0;
  let matchedCanonicalCount = 0;

  for (let idx = 0; idx < canonicalTokens.length; idx += 1) {
    const canonicalToken = canonicalTokens[idx];
    const expNorm = normalizeStandardListeningTokens(canonicalToken);

    if (
      expNorm.length > 0 &&
      subIndex + expNorm.length <= normSubmittedTokens.length &&
      expNorm.every((token, k) => normSubmittedTokens[subIndex + k] === token)
    ) {
      matchedCanonicalCount += 1;
      subIndex += expNorm.length;
    } else {
      break;
    }
  }

  const verifiedTokens = canonicalTokens.slice(0, matchedCanonicalCount);
  const verifiedPrefix = verifiedTokens.join(' ');

  let nextWordMask = '';
  let remainingMasks: string[] = [];
  let nextErrorType: 'WRONG' | 'MISSING' | 'EXTRA' = 'WRONG';

  if (matchedCanonicalCount < canonicalTokens.length) {
    const nextCanonicalToken = canonicalTokens[matchedCanonicalCount];
    nextWordMask = maskExpectedWord(nextCanonicalToken);

    const remainingTokens = canonicalTokens.slice(matchedCanonicalCount + 1);
    remainingMasks = remainingTokens.map((t) => maskExpectedWord(t));

    if (subIndex >= normSubmittedTokens.length) {
      nextErrorType = 'MISSING';
    } else {
      const nextExpectedToken =
        normalizeStandardListeningTokens(nextCanonicalToken)[0];
      const remainingSubmitted = normSubmittedTokens.slice(subIndex);
      const foundLater = remainingSubmitted.includes(nextExpectedToken);
      nextErrorType = foundLater ? 'EXTRA' : 'WRONG';
    }
  } else {
    nextErrorType = 'EXTRA';
    nextWordMask = '';
  }

  const hint = generateProgressiveRelativeHint(
    canonicalTokens,
    normSubmittedTokens,
    matchedCanonicalCount,
    subIndex,
    nextErrorType,
  );

  return {
    isCorrect: false,
    verifiedPrefix,
    nextWordMask,
    remainingMasks,
    nextErrorType,
    hint,
    wordAccuracy,
  };
}

@Injectable()
export class QuizService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,
    private speakingService: SpeakingService,
    private uploadService: UploadService,
    private listeningAudioAuthoringService: ListeningAudioAuthoringService,
    private readonly quizContentAccess: QuizContentAccessService,
  ) {}

  async createQuiz(dto: CreateQuizDto, user?: { id: number; role: Role }) {
    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền tạo bài kiểm tra',
      );
    }
    if (
      dto.type === QuizType.LISTENING_PRACTICE &&
      dto.isPremiumContent === true &&
      !this.uploadService.isPrivateStorageConfigured()
    ) {
      throw new ServiceUnavailableException(
        'Protected Listening media storage is not configured',
      );
    }
    if (dto.type) this.assertGenericAdminOwnership(dto.type);
    return this.prisma.quiz.create({ data: dto });
  }

  async updateQuiz(
    id: number,
    dto: Partial<CreateQuizDto>,
    user?: { id: number; role: Role },
  ) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('Quiz not found');

    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền chỉnh sửa bài kiểm tra',
      );
    }

    const effectiveType = dto.type ?? existing.type;
    this.assertGenericAdminOwnership(effectiveType);
    if (
      effectiveType === QuizType.LISTENING_PRACTICE &&
      dto.isPremiumContent === true
    ) {
      await this.assertPremiumListeningMediaReady(id);
    }

    return this.prisma.quiz.update({
      where: { id },
      data: dto,
    });
  }

  async publishQuiz(id: number, status: PublishQuizDto['status']) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        questions: {
          select: { id: true, order: true, type: true, content: true },
        },
      },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    this.assertGenericAdminOwnership(quiz.type);
    if (
      status === 'PUBLISHED' &&
      quiz.type === QuizType.LISTENING_PRACTICE &&
      quiz.isPremiumContent
    ) {
      await this.assertPremiumListeningMediaReady(id);
    }
    if (status === 'PUBLISHED' && quiz.type === QuizType.BILINGUAL_READING) {
      if (quiz.questions.length === 0) {
        throw new BadRequestException(
          'Reading quiz cần ít nhất một câu hỏi hợp lệ',
        );
      }
      for (const question of quiz.questions) {
        try {
          validateReadingQuestionContent(question.content, 'PUBLISHED');
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw new BadRequestException(
              `Reading question #${question.id} (order ${question.order}): ${error.message}`,
            );
          }
          throw error;
        }
      }
    }
    if (
      status === 'PUBLISHED' &&
      quiz.type === QuizType.LISTENING_PRACTICE &&
      quiz.questions.length > 0 &&
      quiz.questions.every((question) => question.type === 'DICTATION') &&
      quiz.questions.length < 20
    ) {
      throw new BadRequestException(
        'Bài nghe chép cần có ít nhất 20 câu trước khi xuất bản',
      );
    }
    return this.prisma.quiz.update({
      where: { id },
      data: {
        publicationStatus: status,
        publishedAt: status === 'PUBLISHED' ? new Date() : quiz.publishedAt,
      },
    });
  }

  async deleteQuiz(id: number, user?: { id: number; role: Role }) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('Quiz not found');

    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền xóa bài kiểm tra',
      );
    }
    this.assertGenericAdminOwnership(existing.type);

    return this.prisma.quiz.delete({
      where: { id },
    });
  }

  async getAllQuizzes() {
    return this.prisma.quiz.findMany({
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  private async assertPremiumListeningMediaReady(quizId: number) {
    if (!this.uploadService.isPrivateStorageConfigured()) {
      throw new ServiceUnavailableException(
        'Protected Listening media storage is not configured',
      );
    }
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        type: true,
        questions: {
          select: {
            audioAssets: {
              where: { isActive: true },
              select: { key: true, url: true },
            },
            diagnosticClips: { select: { key: true, url: true } },
          },
        },
        listeningAudioArtifacts: {
          select: { r2Key: true, r2Url: true },
        },
      },
    });
    if (!quiz || quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy bài luyện nghe');
    }

    const assets = [
      ...quiz.questions.flatMap((question) => [
        ...question.audioAssets,
        ...question.diagnosticClips,
      ]),
      ...quiz.listeningAudioArtifacts
        .filter((artifact) => artifact.r2Key)
        .map((artifact) => ({
          key: artifact.r2Key as string,
          url: artifact.r2Url ?? '',
        })),
    ];
    const publicAssets = assets.filter(
      (asset) => !isPrivateListeningMediaKey(asset.key) || asset.url.length > 0,
    );
    if (publicAssets.length > 0) {
      throw new BadRequestException(
        'Không thể bật premium cho bài nghe còn media public; hãy chuyển media sang private storage trước',
      );
    }
    const missingPrivateObjects = await Promise.all(
      assets.map(async (asset) =>
        (await this.uploadService.privateObjectExists(asset.key))
          ? null
          : asset,
      ),
    );
    if (missingPrivateObjects.some(Boolean)) {
      throw new BadRequestException(
        'Không thể bật premium khi media private chưa tồn tại trong storage',
      );
    }
  }

  async getListeningPractices(userId?: number, role?: Role) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: 'LISTENING_PRACTICE',
        publicationStatus: 'PUBLISHED',
      },
      select: {
        id: true,
        courseId: true,
        practiceTopicId: true,
        title: true,
        description: true,
        type: true,
        bilingualContent: true,
        timeLimit: true,
        isPremiumContent: true,
        _count: {
          select: { questions: true },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const accessByQuiz = await this.quizContentAccess.resolveMany(
      quizzes,
      userId,
      role,
    );

    const toCatalogItem = (
      quiz: (typeof quizzes)[number],
      isCompleted: boolean,
    ) => {
      const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
      const stringArray = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
      const durationMinutes = Number(metadata.durationMinutes);

      return {
        id: quiz.id,
        courseId: quiz.courseId,
        practiceTopicId: quiz.practiceTopicId,
        title: quiz.title,
        description: quiz.description,
        type: quiz.type,
        timeLimit: quiz.timeLimit,
        mode:
          metadata.mode === 'DICTATION'
            ? 'DICTATION'
            : metadata.mode === 'DIALOGUE'
              ? 'DIALOGUE'
              : 'COMPREHENSION',
        track:
          metadata.track === 'TOEIC_LISTENING'
            ? 'TOEIC_LISTENING'
            : 'GENERAL_ENGLISH',
        levels: stringArray(metadata.levels),
        topics: stringArray(metadata.topics),
        accents: stringArray(metadata.accents),
        questionCount: quiz._count.questions,
        durationMinutes: Number.isFinite(durationMinutes)
          ? durationMinutes
          : quiz.timeLimit,
        isCompleted,
        isPremiumContent: accessByQuiz.get(quiz.id)?.isPremiumContent ?? false,
        isLocked: accessByQuiz.get(quiz.id)?.isLocked ?? false,
        requiredPlan: accessByQuiz.get(quiz.id)?.requiredPlan ?? 'FREE',
        cefrLevel: accessByQuiz.get(quiz.id)?.cefrLevel ?? null,
      };
    };

    if (!userId) return quizzes.map((quiz) => toCatalogItem(quiz, false));

    // Check user submissions to see which ones are completed
    const userSubmissions = await this.prisma.submission.findMany({
      where: {
        userId,
        quizId: { in: quizzes.map((q) => q.id) },
      },
      select: { quizId: true },
    });

    const completedQuizIds = new Set(userSubmissions.map((s) => s.quizId));

    return quizzes.map((quiz) =>
      toCatalogItem(quiz, completedQuizIds.has(quiz.id)),
    );
  }

  private async assertListeningPracticeQuiz(
    quizId: number,
    userId?: number,
    role?: Role,
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        type: true,
        isPremiumContent: true,
        courseId: true,
      },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy bài luyện nghe');
    if (quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException('Phiên chỉ dành cho bài luyện nghe');
    }
    await this.quizContentAccess.assertAccess(quiz, userId, role);
    return quiz;
  }

  async getOrCreateListeningAttempt(userId: number, quizId: number) {
    await this.assertListeningPracticeQuiz(quizId, userId);
    const existing = await this.prisma.listeningPracticeAttempt.findFirst({
      where: {
        userId,
        quizId,
        status: ListeningPracticeAttemptStatus.IN_PROGRESS,
      },
      orderBy: { updatedAt: 'desc' },
    });
    let attempt = existing;
    if (!attempt) {
      try {
        attempt = await this.prisma.listeningPracticeAttempt.create({
          data: { userId, quizId },
        });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        attempt = await this.prisma.listeningPracticeAttempt.findFirst({
          where: {
            userId,
            quizId,
            status: ListeningPracticeAttemptStatus.IN_PROGRESS,
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (!attempt) throw error;
      }
    }
    return {
      id: attempt.id,
      quizId: attempt.quizId,
      currentQuestionId: attempt.currentQuestionId,
      answers: attempt.answers,
      questionStates: attempt.questionStates,
      status: attempt.status,
      startedAt: attempt.startedAt,
      updatedAt: attempt.updatedAt,
    };
  }

  async saveListeningAttempt(
    userId: number,
    quizId: number,
    attemptId: number,
    dto: SaveListeningAttemptDto,
  ) {
    await this.assertListeningPracticeQuiz(quizId, userId);
    const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
      where: { id: attemptId, userId, quizId },
    });
    if (!attempt)
      throw new NotFoundException('Không tìm thấy phiên luyện nghe');
    if (attempt.status !== ListeningPracticeAttemptStatus.IN_PROGRESS) {
      throw new ForbiddenException('Phiên luyện nghe đã kết thúc');
    }
    if (dto.currentQuestionId !== undefined) {
      const question = await this.prisma.question.findFirst({
        where: { id: dto.currentQuestionId, quizId },
        select: { id: true },
      });
      if (!question)
        throw new BadRequestException('Câu hỏi không thuộc bài luyện này');
    }
    const updated = await this.prisma.listeningPracticeAttempt.update({
      where: { id: attemptId },
      data: {
        ...(dto.currentQuestionId !== undefined
          ? { currentQuestionId: dto.currentQuestionId }
          : {}),
        ...(dto.answers !== undefined
          ? { answers: dto.answers as Prisma.InputJsonValue }
          : {}),
        ...(dto.questionStates !== undefined
          ? { questionStates: dto.questionStates as Prisma.InputJsonValue }
          : {}),
      },
    });
    return {
      id: updated.id,
      quizId: updated.quizId,
      currentQuestionId: updated.currentQuestionId,
      answers: updated.answers,
      questionStates: updated.questionStates,
      status: updated.status,
      startedAt: updated.startedAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Discard an unfinished listening session.  This is deliberately separate
   * from saving progress: confirming "Thoát bài luyện" must make the next
   * launch start clean instead of restoring a server checkpoint.
   */
  async cancelListeningAttempt(
    userId: number,
    quizId: number,
    attemptId: number,
  ) {
    await this.assertListeningPracticeQuiz(quizId, userId);
    const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
      where: { id: attemptId, userId, quizId },
      select: { id: true, status: true },
    });
    if (!attempt) {
      throw new NotFoundException('Không tìm thấy phiên luyện nghe');
    }
    if (attempt.status !== ListeningPracticeAttemptStatus.IN_PROGRESS) {
      return { id: attempt.id, status: attempt.status, discarded: false };
    }

    const updated = await this.prisma.listeningPracticeAttempt.update({
      where: { id: attempt.id },
      data: {
        status: ListeningPracticeAttemptStatus.ABANDONED,
        completedAt: new Date(),
      },
      select: { id: true, status: true },
    });
    return { id: updated.id, status: updated.status, discarded: true };
  }

  async getToeicPapers(userId?: number) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: { in: [QuizType.TOEIC, QuizType.TOEIC_FOUR_SKILL] },
        OR: [
          { bilingualContent: { path: ['examFormat'], equals: 'TOEIC_LR' } },
          { bilingualContent: { path: ['examFormat'], equals: 'TOEIC_SW' } },
          {
            bilingualContent: {
              path: ['examFormat'],
              equals: 'TOEIC_4_SKILLS',
            },
          },
          { bilingualContent: { path: ['examFormat'], equals: 'TWO_SKILL' } },
          {
            bilingualContent: {
              path: ['examFormat'],
              equals: 'SPEAKING_WRITING',
            },
          },
          { bilingualContent: { path: ['examFormat'], equals: 'FOUR_SKILL' } },
        ],
      },
      include: { _count: { select: { questions: true } } },
      orderBy: { id: 'asc' },
    });

    const completedQuizIds = new Set<number>();
    if (userId) {
      const userSubmissions = await this.prisma.submission.findMany({
        where: {
          userId,
          quizId: { in: quizzes.map((quiz) => quiz.id) },
        },
        select: { quizId: true },
      });
      userSubmissions.forEach((s) => completedQuizIds.add(s.quizId));
    }

    return quizzes.map((quiz) => {
      const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
      const linkedCount = Number(metadata.totalQuestions);
      return {
        ...quiz,
        questionsCount:
          Number.isFinite(linkedCount) && linkedCount > 0
            ? linkedCount
            : quiz._count.questions,
        isBundle: metadata.isBundle === true,
        isCompleted: completedQuizIds.has(quiz.id),
      };
    });
  }

  async getQuizById(
    id: number,
    includeAnswers = false,
    userId?: number,
    role?: Role,
  ) {
    const accessQuiz = await this.prisma.quiz.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        isPremiumContent: true,
        courseId: true,
        publicationStatus: true,
        toeicWritingSetItems: { select: { id: true }, take: 1 },
      },
    });
    if (!accessQuiz) throw new NotFoundException('Quiz not found');
    // TOEIC exam Writing tasks are exam content: learners read them only
    // inside their assessment attempt (/writing/quizzes/:id with the attempt
    // context). The generic quiz route never serves them to non-admins.
    if (
      role !== Role.ADMIN &&
      (accessQuiz.toeicWritingSetItems?.length ?? 0) > 0
    )
      throw new NotFoundException('Quiz not found');

    if (
      accessQuiz.type === QuizType.LISTENING_PRACTICE &&
      userId === undefined
    ) {
      throw new UnauthorizedException('Đăng nhập để bắt đầu luyện nghe');
    }
    if (
      role !== Role.ADMIN &&
      accessQuiz.publicationStatus !== undefined &&
      accessQuiz.publicationStatus !== 'PUBLISHED'
    ) {
      throw new NotFoundException('Bài luyện chưa được xuất bản');
    }
    await this.quizContentAccess.assertAccess(accessQuiz, userId, role);

    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: {
            audioAssets: {
              where: { isActive: true },
              orderBy: { version: 'desc' },
            },
            diagnosticClips: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');

    // Deliver artifact timing separately from transcript text. The timeline is
    // authoritative media metadata; it is safe for the player before reveal,
    // while the transcript itself remains behind the reveal endpoint.
    let listeningAudioArtifact: {
      id: number;
      version: number;
      checksumSha256: string | null;
      durationMs: number | null;
    } | null = null;
    if (
      quiz.type === QuizType.LISTENING_PRACTICE &&
      userId !== undefined &&
      quiz.questions.length > 0
    ) {
      const artifact =
        await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
          quiz.id,
        );
      if (artifact) {
        listeningAudioArtifact = {
          id: artifact.id,
          version: artifact.version,
          checksumSha256: artifact.checksumSha256,
          durationMs: artifact.durationMs,
        };
      }
      const timeline = Array.isArray(artifact?.timeline)
        ? new Map(
            artifact.timeline
              .filter(
                (
                  item,
                ): item is { turnId: string; startMs: number; endMs: number } =>
                  Boolean(item) &&
                  typeof item === 'object' &&
                  typeof (item as Record<string, unknown>).turnId ===
                    'string' &&
                  Number.isInteger((item as Record<string, unknown>).startMs) &&
                  Number.isInteger((item as Record<string, unknown>).endMs),
              )
              .map((item) => [item.turnId, item]),
          )
        : new Map<string, { turnId: string; startMs: number; endMs: number }>();
      quiz.questions = quiz.questions.map((question) => {
        const content =
          question.content && typeof question.content === 'object'
            ? { ...(question.content as Record<string, unknown>) }
            : null;
        const targetTurnId =
          content && typeof content.targetTurnId === 'string'
            ? content.targetTurnId
            : null;
        const turn = targetTurnId ? timeline.get(targetTurnId) : null;
        return turn
          ? {
              ...question,
              listeningSegment: {
                turnId: turn.turnId,
                startMs: turn.startMs,
                endMs: turn.endMs,
              },
            }
          : question;
      });
    }

    if (!includeAnswers && quiz.questions) {
      const sanitizedQuestions = quiz.questions.map((q) => {
        if (!q.content || typeof q.content !== 'object') return q;
        const content = { ...(q.content as any) };
        delete content.correct;
        delete content.correctAnswer;
        delete content.correctIndex;
        delete content.explanation;
        if (quiz.type === QuizType.LISTENING_PRACTICE) {
          delete content.audioText;
          delete content.translation;
          // This text is the learner-facing transcript/answer for Listening.
          // Timing is provided in `question.listeningSegment` above instead.
          delete content.transcriptSegments;
        }
        // Writing: only the learner-visible contract (no reference answer,
        // no authored picture description). Admins take the includeAnswers path.
        if (isWritingQuizType(quiz.type))
          return { ...q, content: learnerVisibleTaskContent(content) };
        return { ...q, content };
      });
      const safeQuiz = await this.protectPremiumListeningMedia(
        { ...quiz, questions: sanitizedQuestions },
        accessQuiz,
      );
      return {
        ...safeQuiz,
        ...(listeningAudioArtifact ? { listeningAudioArtifact } : {}),
      };
    }

    const safeQuiz = await this.protectPremiumListeningMedia(quiz, accessQuiz);
    return {
      ...safeQuiz,
      ...(listeningAudioArtifact ? { listeningAudioArtifact } : {}),
    };
  }

  private async protectPremiumListeningMedia<
    T extends {
      type?: QuizType;
      isPremiumContent?: boolean;
      questions?: Array<{
        audioAssets?: Array<{ key: string; url: string }>;
        diagnosticClips?: Array<{ key: string; url: string }>;
      }>;
    },
  >(quiz: T, accessQuiz: { type: QuizType; isPremiumContent: boolean }) {
    if (accessQuiz.type !== QuizType.LISTENING_PRACTICE || !quiz.questions) {
      return quiz;
    }
    // Presign every private object (premium, or an A1/A2 quiz that kept its
    // private assets after moving to free); public objects keep their URL.
    const sign = async (item: { key: string; url: string }) =>
      isPrivateListeningMediaKey(item.key)
        ? {
            ...item,
            url: await this.uploadService.getPrivatePresignedDownloadUrl(
              item.key,
              300,
            ),
          }
        : item;

    const questions = await Promise.all(
      quiz.questions.map(async (question) => {
        const [audioAssets, diagnosticClips] = await Promise.all([
          Promise.all((question.audioAssets ?? []).map(sign)),
          Promise.all((question.diagnosticClips ?? []).map(sign)),
        ]);
        return { ...question, audioAssets, diagnosticClips };
      }),
    );
    return { ...quiz, questions };
  }

  /**
   * Transcript is intentionally loaded on demand. The regular learner quiz
   * payload redacts answers/audio text until the learner asks to review them;
   * the durable reveal record is the authorization boundary for every
   * listening-practice mode, including dialogue exercises.
   */
  async revealListeningTranscript(userId: number, quizId: number, role?: Role) {
    await this.assertListeningPracticeQuiz(quizId, userId, role);
    let attempt = await this.prisma.listeningPracticeAttempt.findFirst({
      where: {
        userId,
        quizId,
        status: {
          in: [
            ListeningPracticeAttemptStatus.IN_PROGRESS,
            ListeningPracticeAttemptStatus.COMPLETED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!attempt) {
      const created = await this.getOrCreateListeningAttempt(userId, quizId);
      attempt = { id: created.id };
    }
    return this.prisma.listeningTranscriptReveal.upsert({
      where: { userId_quizId: { userId, quizId } },
      create: { userId, quizId, attemptId: attempt.id },
      update: { attemptId: attempt.id, revealedAt: new Date() },
      select: { revealedAt: true },
    });
  }

  async getListeningTranscript(userId: number, quizId: number, role?: Role) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        type: true,
        isPremiumContent: true,
        courseId: true,
        publicationStatus: true,
      },
    });

    if (!quiz) throw new NotFoundException('Không tìm thấy bài luyện nghe');
    if (quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException(
        'Transcript chỉ khả dụng cho bài luyện nghe chép',
      );
    }
    if (quiz.publicationStatus !== 'PUBLISHED') {
      throw new NotFoundException('Bài luyện chưa được xuất bản');
    }
    await this.quizContentAccess.assertAccess(quiz, userId, role);
    const questions = await this.prisma.question.findMany({
      where: { quizId },
      orderBy: { order: 'asc' },
      select: { id: true, type: true, order: true, content: true },
    });
    const transcriptQuestions = questions.filter((question) => {
      const content = (question.content ?? {}) as Record<string, unknown>;
      return (
        question.type === 'DICTATION' ||
        question.type === 'DIALOGUE' ||
        Array.isArray(content.transcriptSegments)
      );
    });
    if (transcriptQuestions.length > 0) {
      const reveal = await this.prisma.listeningTranscriptReveal.findUnique({
        where: { userId_quizId: { userId, quizId } },
        select: { id: true },
      });
      if (!reveal) {
        throw new ForbiddenException(
          'Hãy xác nhận xem transcript trước khi tải nội dung.',
        );
      }
    }

    const dialogueBlocks = transcriptQuestions
      .map((question) =>
        normalizeDialogueSegments(
          (question.content as Record<string, unknown> | null)
            ?.transcriptSegments,
        ),
      )
      .filter((segments) => segments.length > 0);
    const hasMultiTurnDialogue = dialogueBlocks.some(
      (segments) => segments.length > 1,
    );
    const dedupedDialogueSegments = withSpeakerTurnIds(
      hasMultiTurnDialogue
        ? dedupeDialogueBlocks(dialogueBlocks)
        : dialogueBlocks.flat(),
    );
    let turnNumber = 0;
    const items = transcriptQuestions
      .flatMap((question) => {
        const content = (question.content ?? {}) as Record<string, unknown>;
        const canonicalSegments = normalizeDialogueSegments(
          content.transcriptSegments,
        );

        if (canonicalSegments.length > 0) {
          return canonicalSegments
            .map(() => {
              const segment = dedupedDialogueSegments[turnNumber];
              if (!segment) return null;
              turnNumber += 1;
              return {
                questionId: question.id,
                turnId: `turn-${String(turnNumber).padStart(3, '0')}`,
                order: turnNumber,
                transcript: segment.text,
                speaker: segment.speaker ?? segment.speakerId ?? null,
                speakerId: segment.speakerId ?? null,
                speakerTurnId: segment.speakerTurnId ?? null,
                translation: segment.translation ?? null,
                startMs: segment.startMs ?? null,
                endMs: segment.endMs ?? null,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        }

        const transcript =
          typeof content.correctAnswer === 'string'
            ? content.correctAnswer.trim()
            : typeof content.audioText === 'string'
              ? content.audioText.trim()
              : '';
        if (!transcript) return [];
        turnNumber += 1;
        return [
          {
            questionId: question.id,
            turnId: `turn-${String(turnNumber).padStart(3, '0')}`,
            order: turnNumber,
            transcript,
            speaker:
              typeof content.speaker === 'string' && content.speaker.trim()
                ? content.speaker.trim()
                : null,
            speakerId:
              typeof content.speakerId === 'string' && content.speakerId.trim()
                ? content.speakerId.trim()
                : null,
            speakerTurnId: null,
            translation:
              typeof content.translation === 'string'
                ? content.translation.trim() || null
                : null,
            startMs: null,
            endMs: null,
          },
        ];
      })
      .filter((item) => item.transcript.length > 0);

    const artifact =
      await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
        quiz.id,
      );
    const timelineByTurn = new Map<
      string,
      { startMs: number; endMs: number }
    >();
    if (artifact?.timeline && Array.isArray(artifact.timeline)) {
      for (const item of artifact.timeline) {
        if (!item || typeof item !== 'object') continue;
        const timelineItem = item as Record<string, unknown>;
        if (typeof timelineItem.turnId !== 'string') continue;
        if (
          !Number.isInteger(timelineItem.startMs) ||
          !Number.isInteger(timelineItem.endMs)
        )
          continue;
        timelineByTurn.set(timelineItem.turnId, {
          startMs: timelineItem.startMs as number,
          endMs: timelineItem.endMs as number,
        });
      }
    }
    return {
      quizId: quiz.id,
      audioArtifact: artifact
        ? {
            id: artifact.id,
            version: artifact.version,
            checksumSha256: artifact.checksumSha256,
            durationMs: artifact.durationMs,
          }
        : null,
      items: items.map((item) => ({
        ...item,
        startMs: timelineByTurn.get(item.turnId)?.startMs ?? null,
        endMs: timelineByTurn.get(item.turnId)?.endMs ?? null,
      })),
    };
  }

  /**
   * Builds one continuous audio track for a dictation exercise. The transcript
   * playlist may still move between individual lines, but playback must not
   * tear down and reload a new audio element for every line.
   */
  async streamListeningTranscriptAudio(
    quizId: number,
    requestedIdentity: PublishedListeningAudioIdentity = {},
    userId?: number,
    role?: Role,
  ) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        type: true,
        isPremiumContent: true,
        courseId: true,
        publicationStatus: true,
      },
    });
    if (!quiz || quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy bài luyện nghe');
    }
    if (quiz.publicationStatus !== 'PUBLISHED') {
      throw new NotFoundException('Bài luyện chưa được xuất bản');
    }
    await this.quizContentAccess.assertAccess(quiz, userId, role);
    const result = await this.listeningAudioAuthoringService.getPublishedAudio(
      quizId,
      requestedIdentity,
    );
    return result;
  }

  async createQuestion(quizId: number, dto: CreateQuestionDto) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, type: true, publicationStatus: true },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy đề thi');
    this.assertGenericAdminOwnership(quiz.type);

    const content = normalizeQuestionContent(
      quiz.type,
      dto.type,
      dto.content,
      quiz.publicationStatus === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    );
    return this.prisma.question.create({
      data: {
        type: dto.type,
        content: content as Prisma.InputJsonValue,
        order: dto.order ?? 0,
        quizId,
      },
    });
  }

  async createAudioAsset(questionId: number, file: Express.Multer.File) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: { select: { id: true, type: true, isPremiumContent: true } },
        audioAssets: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!question || question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy câu luyện nghe');
    }
    if (
      question.quiz.isPremiumContent &&
      !this.uploadService.isPrivateStorageConfigured()
    ) {
      throw new ServiceUnavailableException(
        'Protected Listening media storage is not configured',
      );
    }
    const next = await this.prisma.quizAudioAsset.aggregate({
      where: { questionId },
      _max: { version: true },
    });
    const version = (next._max.version ?? 0) + 1;
    const isDialogue =
      question.type.toUpperCase() === 'DIALOGUE' &&
      Array.isArray(
        (question.content as Record<string, unknown>).transcriptSegments,
      );
    const folder = question.quiz.isPremiumContent
      ? `${PRIVATE_LISTENING_MEDIA_PREFIX}quiz-${question.quiz.id}/question-${questionId}/v${version}`
      : isDialogue
        ? `catalog/listening/practice/dialogue/quiz-${question.quiz.id}/question-${questionId}/v${version}`
        : `listening/quiz-${question.quiz.id}/question-${questionId}/v${version}`;
    const upload = question.quiz.isPremiumContent
      ? await this.uploadService.putPrivateObjectAtKey(
          `${folder}/${file.originalname || 'audio'}`,
          file.buffer,
          file.mimetype,
        )
      : await this.uploadService.uploadRawBuffer(
          file.buffer,
          file.mimetype,
          folder,
          file.originalname,
        );
    return this.prisma.$transaction(async (tx) => {
      await tx.quizAudioAsset.updateMany({
        where: { questionId },
        data: { isActive: false },
      });
      return tx.quizAudioAsset.create({
        data: {
          questionId,
          version,
          key: upload.key,
          url: upload.url,
          mimeType: upload.contentType,
          isActive: true,
        },
      });
    });
  }

  /** Kept for the existing dialogue route; same as generateQuestionAudioAsset. */
  async generateDialogueAudioAsset(questionId: number) {
    return this.generateQuestionAudioAsset(questionId);
  }

  /**
   * Synthesizes a question's own clip and makes it the active asset:
   * a DIALOGUE question reads its turns; a comprehension MCQ reads its
   * audioText; a DICTATION item reads its answer sentence.
   */
  async generateQuestionAudioAsset(questionId: number) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: { select: { id: true, type: true, isPremiumContent: true } },
      },
    });
    if (!question || question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy câu luyện nghe');
    }
    if (
      question.quiz.isPremiumContent &&
      !this.uploadService.isPrivateStorageConfigured()
    ) {
      throw new ServiceUnavailableException(
        'Protected Listening media storage is not configured',
      );
    }

    const type = question.type.toUpperCase();
    const content = (question.content ?? {}) as Record<string, unknown>;
    let nextContent = content;
    let audioBuffer: Buffer;
    if (type === 'DIALOGUE') {
      nextContent = normalizeQuestionContent(
        question.quiz.type,
        question.type,
        content,
      );
      audioBuffer = await this.speakingService.generateDialogueTts(
        nextContent.transcriptSegments as NormalizedDialogueSegment[],
        nextContent.accent === 'UK' ? 'UK' : 'US',
        1,
      );
    } else {
      const text = [
        type === 'DICTATION' ? content.correctAnswer : undefined,
        content.audioText,
      ].find((value) => typeof value === 'string' && value.trim());
      if (typeof text !== 'string') {
        throw new BadRequestException('Câu này chưa có câu để đọc.');
      }
      audioBuffer = await this.speakingService.generateTts(
        text.trim(),
        content.accent === 'UK' ? 'UK' : 'US',
        1,
      );
    }

    const next = await this.prisma.quizAudioAsset.aggregate({
      where: { questionId },
      _max: { version: true },
    });
    const version = (next._max.version ?? 0) + 1;
    const fileName = type === 'DIALOGUE' ? 'dialogue.mp3' : 'audio.mp3';
    const folder = type === 'DIALOGUE' ? 'dialogue' : 'audio';
    const upload = question.quiz.isPremiumContent
      ? await this.uploadService.putPrivateObjectAtKey(
          `${PRIVATE_LISTENING_MEDIA_PREFIX}quiz-${question.quiz.id}/question-${questionId}/v${version}/${fileName}`,
          audioBuffer,
          'audio/mpeg',
        )
      : await this.uploadService.uploadRawBuffer(
          audioBuffer,
          'audio/mpeg',
          `catalog/listening/practice/${folder}/quiz-${question.quiz.id}/question-${questionId}/v${version}`,
          fileName,
        );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.quizAudioAsset.updateMany({
          where: { questionId },
          data: { isActive: false },
        });
        if (nextContent !== content) {
          await tx.question.update({
            where: { id: questionId },
            data: { content: nextContent as Prisma.InputJsonValue },
          });
        }
        return tx.quizAudioAsset.create({
          data: {
            questionId,
            version,
            key: upload.key,
            url: upload.url,
            mimeType: upload.contentType,
            isActive: true,
          },
        });
      });
    } catch (error) {
      await this.uploadService.deleteFile(upload.key).catch(() => undefined);
      throw error;
    }
  }

  async createDiagnosticClip(
    questionId: number,
    dto: {
      label: string;
      key: string;
      url: string;
      startMs?: number;
      endMs?: number;
    },
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, quiz: { select: { type: true } } },
    });
    if (!question || question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy câu luyện nghe');
    }
    return this.prisma.listeningDiagnosticClip.create({
      data: { questionId, ...dto },
    });
  }

  async updateQuestion(questionId: number, dto: Partial<CreateQuestionDto>) {
    const existing = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { quiz: { select: { type: true, publicationStatus: true } } },
    });
    if (!existing) throw new NotFoundException('Question not found');
    this.assertGenericAdminOwnership(existing.quiz.type);

    const data = { ...dto };
    if (dto.content !== undefined) {
      data.content = normalizeQuestionContent(
        existing.quiz.type,
        dto.type ?? existing.type,
        dto.content,
        existing.quiz.publicationStatus === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
      ) as any;
    }
    return this.prisma.question.update({
      where: { id: questionId },
      data,
    });
  }

  async deleteQuestion(questionId: number) {
    const existing = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { quiz: { select: { type: true } } },
    });
    if (!existing) throw new NotFoundException('Question not found');
    this.assertGenericAdminOwnership(existing.quiz.type);
    return this.prisma.question.delete({
      where: { id: questionId },
    });
  }

  private assertGenericAdminOwnership(type: QuizType) {
    if (
      type === QuizType.LISTENING_PRACTICE ||
      type === QuizType.BILINGUAL_READING ||
      type === QuizType.WRITING_EMAIL ||
      type === QuizType.WRITING_PICTURE
    ) {
      throw new ConflictException(
        'Nội dung kỹ năng này được quản lý trong Skill CMS chuyên biệt',
      );
    }
  }

  private async replayReadingSubmission(
    userId: number,
    quizId: number,
    clientAttemptId: string,
    answers: Array<{ questionId: number; answer: unknown }>,
  ) {
    const existing = await this.prisma.submission.findFirst({
      where: { userId, quizId, clientAttemptId },
      include: { results: true },
    });
    if (!existing) return null;

    const persistedAnswers = existing.results.map((result) => ({
      questionId: result.questionId,
      answer: result.answer,
    }));
    if (
      canonicalizeReadingAttemptAnswers(persistedAnswers) !==
      canonicalizeReadingAttemptAnswers(answers)
    ) {
      throw new ConflictException(
        'ClientAttemptId đã được dùng cho một lần nộp khác',
      );
    }
    return { ...existing, isFirstSubmission: false };
  }

  private async assertReadingAttemptKeyScope(
    userId: number,
    quizId: number,
    clientAttemptId: string,
  ) {
    const otherQuizSubmission = await this.prisma.submission.findFirst({
      where: {
        userId,
        clientAttemptId,
        NOT: { quizId },
      },
      select: { id: true },
    });
    if (otherQuizSubmission) {
      throw new ConflictException(
        'ClientAttemptId đã được dùng cho một bài khác',
      );
    }
  }

  async submitQuiz(quizId: number, userId: number, dto: SubmitQuizDto) {
    const quiz = await this.getQuizById(quizId, true, userId);

    // This endpoint grades only Listening and Reading practice, whose answers
    // are validated below (complete, each question once). TOEIC and Writing
    // quizzes have their own submit flows; reaching them here scored
    // `dto.answers` as sent, so one question repeated N times earned N points
    // and N x 10 XP on the leaderboard.
    if (
      quiz.type !== QuizType.LISTENING_PRACTICE &&
      quiz.type !== QuizType.BILINGUAL_READING
    ) {
      throw new BadRequestException(
        'Bài này không được nộp qua luyện Nghe/Đọc',
      );
    }

    if (quiz.type === QuizType.LISTENING_PRACTICE) {
      this.assertCompleteListeningSubmission(quiz.questions, dto.answers);
    } else if (quiz.type === QuizType.BILINGUAL_READING) {
      validateReadingSubmission(quiz.questions, dto.answers);

      if (dto.clientAttemptId) {
        const replay = await this.replayReadingSubmission(
          userId,
          quizId,
          dto.clientAttemptId,
          dto.answers,
        );
        if (replay) return replay;
        await this.assertReadingAttemptKeyScope(
          userId,
          quizId,
          dto.clientAttemptId,
        );
      }
    }

    if (
      dto.attemptId !== undefined &&
      quiz.type === QuizType.LISTENING_PRACTICE
    ) {
      const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
        where: {
          id: dto.attemptId,
          userId,
          quizId,
          status: ListeningPracticeAttemptStatus.IN_PROGRESS,
        },
        select: { id: true },
      });
      if (!attempt)
        throw new ForbiddenException('Phiên luyện nghe không còn hiệu lực');
    }

    let totalScore = 0;
    const answersByQuestionId = new Map(
      dto.answers.map((answer) => [answer.questionId, answer.answer]),
    );
    const answersForScoring =
      quiz.type === QuizType.BILINGUAL_READING
        ? quiz.questions.map((question) => ({
            questionId: question.id,
            answer: answersByQuestionId.get(question.id),
          }))
        : dto.answers;

    const resultsData = answersForScoring.map((ans) => {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      let isCorrect = false;
      let score = 0;

      if (question) {
        if (question.type === 'MULTIPLE_CHOICE') {
          const content = question.content;
          const resolvedCorrect =
            quiz.type === QuizType.BILINGUAL_READING
              ? resolveReadingCorrectOption(content)
              : null;
          if (resolvedCorrect?.status === 'available') {
            if (resolvedCorrect.answer === ans.answer) {
              isCorrect = true;
              score = 1;
              totalScore += score;
            }
          } else {
            const listeningCorrect =
              quiz.type === QuizType.LISTENING_PRACTICE &&
              Array.isArray(content.options) &&
              Number.isInteger(content.correctIndex)
                ? content.options[content.correctIndex as number]
                : content.correct;
            if (listeningCorrect === ans.answer) {
              isCorrect = true;
              score = 1;
              totalScore += score;
            }
          }
        } else if (
          question.type === 'DICTATION' ||
          question.type === 'FILL_IN_BLANK'
        ) {
          const content = question.content;
          const cleanCorrect = normalizeListeningAnswer(
            content.correctAnswer || content.correct || '',
          );
          const cleanAns = normalizeListeningAnswer(ans.answer);
          if (cleanCorrect === cleanAns) {
            isCorrect = true;
            score = 1;
            totalScore += score;
          }
        } else if (question.type === 'WRITING') {
          // Sẽ gọi AI chấm bài và gom overallAiFeedback ở vòng lặp bên dưới
        }
      }

      return {
        questionId: ans.questionId,
        answer: ans.answer,
        isCorrect,
        score,
        // (Optional: You could save this feedback into the Result JSON if you want.
        // We will just accumulate it into the Submission aiFeedback for now)
      };
    });

    // Accumulate all AI feedback to store in the Submission
    let overallAiFeedback = '';
    // We run the map again just to combine (or we could have done it inside)
    for (const ans of dto.answers) {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      if (question && question.type === 'WRITING') {
        const content = question.content;
        const feedback = await this.aiService.generateFeedback(
          content.text,
          ans.answer,
        );
        overallAiFeedback += `Question: ${content.text}\nFeedback: ${feedback}\n\n`;
      }
    }

    // Persist the submission and close the listening attempt atomically. This
    // prevents a successful submission from being left behind while its
    // server checkpoint remains IN_PROGRESS (or vice versa).
    let submission;
    try {
      submission = await this.prisma.$transaction(async (tx) => {
        const created = await tx.submission.create({
          data: {
            quizId,
            userId,
            ...(quiz.type === QuizType.BILINGUAL_READING && dto.clientAttemptId
              ? { clientAttemptId: dto.clientAttemptId }
              : {}),
            score: totalScore,
            aiFeedback: overallAiFeedback ? overallAiFeedback : null,
            results: {
              create: resultsData,
            },
          },
          include: {
            results: true,
          },
        });

        if (
          dto.attemptId !== undefined &&
          quiz.type === QuizType.LISTENING_PRACTICE
        ) {
          const completed = await tx.listeningPracticeAttempt.updateMany({
            where: {
              id: dto.attemptId,
              userId,
              quizId,
              status: ListeningPracticeAttemptStatus.IN_PROGRESS,
            },
            data: {
              status: ListeningPracticeAttemptStatus.COMPLETED,
              completedAt: new Date(),
            },
          });
          if (completed.count !== 1) {
            throw new ForbiddenException('Phiên luyện nghe không còn hiệu lực');
          }
        }

        if (quiz.type === QuizType.BILINGUAL_READING) {
          await tx.learningActivity.create({
            data: {
              userId,
              type: 'READING_PRACTICE_COMPLETED',
              title: quiz.title,
              detail: `${totalScore}/${quiz.questions.length} câu đúng`,
              score:
                quiz.questions.length > 0
                  ? Math.round((totalScore / quiz.questions.length) * 100)
                  : 0,
              sourceType: 'QUIZ',
              sourceId: String(quizId),
            },
          });
        }

        return created;
      });
    } catch (error) {
      if (
        quiz.type === QuizType.BILINGUAL_READING &&
        dto.clientAttemptId &&
        isClientAttemptUniqueConflict(error)
      ) {
        const replay = await this.replayReadingSubmission(
          userId,
          quizId,
          dto.clientAttemptId,
          dto.answers,
        );
        if (replay) return replay;
      }
      throw error;
    }

    if (
      quiz.type === QuizType.LISTENING_PRACTICE &&
      this.prisma.learningActivity?.create
    ) {
      await this.prisma.learningActivity.create({
        data: {
          userId,
          type: 'LISTENING_PRACTICE_COMPLETED',
          title: quiz.title,
          detail: `${totalScore}/${quiz.questions.length} câu đúng`,
          score:
            quiz.questions.length > 0
              ? Math.round((totalScore / quiz.questions.length) * 100)
              : 0,
          sourceType: 'QUIZ',
          sourceId: String(quizId),
        },
      });
    }

    // Chống farm điểm thưởng Quiz bằng một insert idempotent.
    // createMany + skipDuplicates tránh ném/log P2002 trong lần nộp lại,
    // đồng thời vẫn giữ được tính nguyên tử của @@unique([userId, quizId]).
    const rewardInsert = await this.prisma.userQuizReward.createMany({
      data: { userId, quizId },
      skipDuplicates: true,
    });
    const isFirstSubmission = rewardInsert.count === 1;

    // Phát ra sự kiện cho Gamification kèm cờ isFirstSubmission
    this.eventEmitter.emit('quiz.submitted', {
      userId,
      quizId,
      score: totalScore,
      scorePercent: quiz.questions.length
        ? Math.round((totalScore / quiz.questions.length) * 100)
        : null,
      quizType: quiz.type,
      submissionId: submission.id,
      isFirstSubmission,
    });

    return {
      ...submission,
      isFirstSubmission,
    };
  }

  async checkPracticeQuestion(
    quizId: number,
    questionId: number,
    dto: CheckPracticeQuestionDto,
    userId?: number,
    role?: Role,
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          select: {
            id: true,
            type: true,
            isPremiumContent: true,
            courseId: true,
          },
        },
        audioAssets: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!question || question.quizId !== quizId) {
      throw new NotFoundException('Câu hỏi không thuộc bài luyện này');
    }
    if (question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException(
        'Chỉ hỗ trợ kiểm tra tức thời cho bài luyện nghe',
      );
    }
    await this.quizContentAccess.assertAccess(question.quiz, userId, role);

    const content = question.content as Record<string, unknown>;
    if (question.type === 'DICTATION') {
      const expectedAnswer =
        typeof content.correctAnswer === 'string'
          ? content.correctAnswer
          : typeof content.correct === 'string'
            ? content.correct
            : null;
      if (!expectedAnswer) {
        throw new BadRequestException('Câu nghe chép chưa có đáp án hợp lệ');
      }

      const evaluationMode =
        content.dictationMode === 'STRICT' ? 'STRICT' : 'STANDARD';
      const normalizedSubmitted =
        evaluationMode === 'STRICT'
          ? normalizeStrictListeningAnswer(dto.answer)
          : normalizeListeningAnswer(dto.answer);
      const normalizedExpected =
        evaluationMode === 'STRICT'
          ? normalizeStrictListeningAnswer(expectedAnswer)
          : normalizeListeningAnswer(expectedAnswer);

      const progressiveFeedback = calculateProgressiveDictationFeedback(
        expectedAnswer,
        dto.answer,
      );

      const isCorrect =
        evaluationMode === 'STRICT'
          ? normalizedSubmitted === normalizedExpected
          : normalizedSubmitted === normalizedExpected ||
            progressiveFeedback.isCorrect;
      const wordAccuracy = isCorrect
        ? 100
        : calculateDictationWordAccuracy(
            expectedAnswer,
            dto.answer,
            evaluationMode,
          );

      if (isCorrect) {
        const correctTokens = (
          evaluationMode === 'STANDARD'
            ? normalizeStandardListeningTokens(expectedAnswer)
            : expectedAnswer.split(/\s+/).filter(Boolean)
        ).map((text) => ({ status: 'CORRECT' as const, text }));

        return {
          questionId,
          isCorrect: true,
          submittedAnswer: dto.answer,
          correctAnswer: expectedAnswer,
          evaluationMode,
          wordAccuracy: 100,
          verifiedPrefix: expectedAnswer,
          canonicalizedAnswer: expectedAnswer,
          nextWordMask: '',
          nextErrorType: null,
          tokens: correctTokens,
          hint: null,
          remainingErrors: 0,
          explanation:
            typeof content.explanation === 'string' ||
            (content.explanation && typeof content.explanation === 'object')
              ? content.explanation
              : null,
          translation:
            typeof content.translation === 'string'
              ? content.translation
              : null,
        };
      }

      const safeTokens = alignDictationFeedbackTokens(
        expectedAnswer,
        dto.answer,
        evaluationMode,
      );

      return {
        questionId,
        isCorrect: false,
        submittedAnswer: dto.answer,
        evaluationMode,
        wordAccuracy,
        verifiedPrefix: progressiveFeedback.verifiedPrefix,
        nextWordMask: progressiveFeedback.nextWordMask,
        remainingMasks: progressiveFeedback.remainingMasks,
        nextErrorType: progressiveFeedback.nextErrorType,
        canonicalizedAnswer: canonicalizeSubmittedDictation(
          expectedAnswer,
          dto.answer,
        ),
        tokens: safeTokens,
        hint: progressiveFeedback.hint,
        remainingErrors: 1,
        explanation: null,
        translation: null,
      };
    }

    if (
      question.type !== 'MULTIPLE_CHOICE' ||
      !Array.isArray(content.options)
    ) {
      return {
        questionId,
        isCorrect: false,
        submittedAnswer: dto.answer,
        feedback: 'Loại câu hỏi này chưa được hỗ trợ kiểm tra tức thời.',
      };
    }

    const correctIndex = Number(content.correctIndex);
    const expectedAnswer = Number.isInteger(correctIndex)
      ? content.options[correctIndex]
      : content.correct;
    if (typeof expectedAnswer !== 'string') {
      throw new BadRequestException('Câu hỏi chưa có đáp án hợp lệ');
    }

    return {
      questionId,
      isCorrect: dto.answer.trim() === expectedAnswer.trim(),
      submittedAnswer: dto.answer,
      correctAnswer: expectedAnswer,
      explanation:
        typeof content.explanation === 'string' ||
        (content.explanation && typeof content.explanation === 'object')
          ? content.explanation
          : null,
      translation:
        typeof content.translation === 'string' ? content.translation : null,
    };
  }

  async streamQuestionAudio(
    quizId: number,
    questionId: number,
    requestedIdentity: PublishedListeningAudioIdentity = {},
    userId?: number,
    role?: Role,
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          select: {
            id: true,
            type: true,
            isPremiumContent: true,
            courseId: true,
          },
        },
        audioAssets: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!question || question.quizId !== quizId) {
      throw new NotFoundException('Câu hỏi không thuộc bài luyện này');
    }
    if (question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException('Chỉ hỗ trợ audio cho bài luyện nghe');
    }
    await this.quizContentAccess.assertAccess(question.quiz, userId, role);

    const content =
      question.content && typeof question.content === 'object'
        ? (question.content as Record<string, unknown>)
        : {};
    const targetTurnId =
      typeof content.targetTurnId === 'string' ? content.targetTurnId : null;
    const isArtifactBackedQuestion = Boolean(targetTurnId);
    if (isArtifactBackedQuestion) {
      const artifact =
        await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
          quizId,
        );
      if (artifact) {
        const timeline = Array.isArray(artifact.timeline)
          ? artifact.timeline
          : [];
        const segment = timeline.find(
          (item) =>
            item &&
            typeof item === 'object' &&
            (item as Record<string, unknown>).turnId === targetTurnId &&
            Number.isFinite((item as Record<string, unknown>).startMs) &&
            Number.isFinite((item as Record<string, unknown>).endMs) &&
            Number((item as Record<string, unknown>).endMs) >
              Number((item as Record<string, unknown>).startMs),
        );
        if (!segment) {
          throw new ServiceUnavailableException(
            'Audio toàn bài chưa có mốc thời gian hợp lệ cho câu này.',
          );
        }
        const result =
          await this.listeningAudioAuthoringService.getPublishedAudio(
            quizId,
            requestedIdentity,
          );
        return result;
      }

      // A caller that supplies an artifact identity is explicitly asking for
      // the quiz-level production track. Never silently downgrade that request
      // to a legacy question asset when the published artifact is unavailable.
      if (Object.keys(requestedIdentity).length > 0) {
        throw new ServiceUnavailableException(
          'Audio phiên bản hiện tại chưa được quản trị viên tạo và duyệt; vui lòng thử lại sau.',
        );
      }
    }

    const activeAsset = question.audioAssets[0];
    // A dialogue question shares the quiz conversation: with no clip of its
    // own it plays the whole published recording (the CMS records the
    // conversation once, not once per question).
    if (
      !activeAsset &&
      Array.isArray(content.transcriptSegments) &&
      content.transcriptSegments.length > 0 &&
      (await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
        quizId,
      ))
    ) {
      return this.listeningAudioAuthoringService.getPublishedAudio(
        quizId,
        requestedIdentity,
      );
    }
    // Published student playback is R2-only. Never call Azure from this
    // request path; content must be synthesized and approved by an author.
    // Private media is read from the private bucket whatever the quiz tier:
    // an A2 quiz moved to free keeps its private assets.
    if (activeAsset && isPrivateListeningMediaKey(activeAsset.key)) {
      return this.uploadService.downloadPrivateFileBuffer(activeAsset.key);
    }
    if (
      activeAsset &&
      !question.quiz.isPremiumContent &&
      (activeAsset.key.startsWith('catalog/listening/') ||
        activeAsset.key.startsWith('listening/'))
    )
      return this.uploadService.downloadFileBuffer(activeAsset.key);
    if (activeAsset && question.quiz.isPremiumContent) {
      throw new ServiceUnavailableException(
        'Premium Listening media is not stored in private storage',
      );
    }
    throw new ServiceUnavailableException(
      'Audio bài luyện chưa được quản trị viên tạo và duyệt; vui lòng thử lại sau.',
    );
  }

  private assertCompleteListeningSubmission(
    questions: Array<{ id: number }>,
    answers: Array<{ questionId: number; answer: unknown }>,
  ) {
    const questionIds = new Set(questions.map((question) => question.id));
    if (answers.length !== questionIds.size) {
      throw new BadRequestException(
        'Hãy trả lời đầy đủ tất cả câu hỏi trước khi nộp bài',
      );
    }

    const seenQuestionIds = new Set<number>();
    for (const answer of answers) {
      if (
        !questionIds.has(answer.questionId) ||
        seenQuestionIds.has(answer.questionId) ||
        typeof answer.answer !== 'string' ||
        answer.answer.trim().length === 0
      ) {
        throw new BadRequestException('Dữ liệu câu trả lời không hợp lệ');
      }
      seenQuestionIds.add(answer.questionId);
    }
  }

  /**
   * Quy đổi số câu đúng ra điểm TOEIC (10 - 990)
   */
  calculateToeicScore(listeningCorrect: number, readingCorrect: number) {
    const lCorrect = Math.min(100, Math.max(0, listeningCorrect));
    const rCorrect = Math.min(100, Math.max(0, readingCorrect));

    // Thang quy đổi chuẩn ETS TOEIC
    const convertListening = (c: number) => {
      if (c <= 5) return 5;
      if (c >= 96) return 495;
      return Math.round(5 + (c - 5) * (490 / 91));
    };

    const convertReading = (c: number) => {
      if (c <= 5) return 5;
      if (c >= 96) return 495;
      return Math.round(5 + (c - 5) * (490 / 91));
    };

    const listeningScore = convertListening(lCorrect);
    const readingScore = convertReading(rCorrect);
    const totalScore = listeningScore + readingScore;

    return {
      listening: { correct: lCorrect, total: 100, score: listeningScore },
      reading: { correct: rCorrect, total: 100, score: readingScore },
      totalScore,
    };
  }

  /**
   * Phân tích điểm mạnh / điểm yếu theo Tag & Category sau khi nộp bài (Analytics)
   */
  async getSubmissionAnalytics(
    submissionId: number,
    userId?: number,
    role?: Role,
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        quiz: {
          include: {
            questions: {
              orderBy: { order: 'asc' },
            },
          },
        },
        results: true,
      },
    });

    if (!submission) throw new NotFoundException('Submission not found');

    if (role === Role.STUDENT && submission.userId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem kết quả bài thi này',
      );
    }

    const tagStats: Record<string, { correct: number; total: number }> = {};
    let totalCorrect = 0;
    // Reading submissions are complete by contract, but the denominator must
    // remain owned by the current server question set for historical safety.
    const totalQuestions =
      submission.quiz.type === QuizType.BILINGUAL_READING
        ? submission.quiz.questions.length
        : submission.results.length;

    submission.results.forEach((res) => {
      if (res.isCorrect) totalCorrect++;
      const question = submission.quiz.questions.find(
        (q) => q.id === res.questionId,
      );
      const category = resolveReadingMicroSkill(
        submission.quiz.type,
        question?.content,
        question?.type,
      );

      if (!tagStats[category]) {
        tagStats[category] = { correct: 0, total: 0 };
      }
      tagStats[category].total += 1;
      if (res.isCorrect) {
        tagStats[category].correct += 1;
      }
    });

    const categoriesBreakdown = Object.entries(tagStats).map(
      ([category, stat]) => {
        const accuracy =
          stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
        return {
          category,
          correct: stat.correct,
          total: stat.total,
          accuracyPercent: accuracy,
        };
      },
    );

    const strengths = categoriesBreakdown
      .filter((c) => c.accuracyPercent >= 75)
      .map((c) => c.category);
    const weaknesses = categoriesBreakdown
      .filter((c) => c.accuracyPercent < 50)
      .map((c) => c.category);

    const overallAccuracy =
      totalQuestions > 0
        ? Math.round((totalCorrect / totalQuestions) * 100)
        : 0;

    const isWritingSubmission =
      submission.quiz.type === QuizType.WRITING_PICTURE ||
      submission.quiz.type === QuizType.WRITING_EMAIL;
    let writingFeedback: {
      feedback: string;
      suggestions: string[];
      maxScore: number;
      score: number;
      skill: 'WRITING';
      practice?: Record<string, unknown>;
    } | null = null;
    if (isWritingSubmission && submission.aiFeedback) {
      try {
        const parsed = JSON.parse(submission.aiFeedback) as Record<
          string,
          unknown
        >;
        if (
          typeof parsed.feedback === 'string' &&
          typeof parsed.score === 'number' &&
          typeof parsed.maxScore === 'number' &&
          Array.isArray(parsed.suggestions) &&
          parsed.suggestions.every((item) => typeof item === 'string')
        ) {
          writingFeedback = {
            feedback: parsed.feedback,
            suggestions: parsed.suggestions,
            maxScore: parsed.maxScore,
            score: parsed.score,
            skill: 'WRITING',
            // Practice tasks graded per criterion (PRACTICE_WRITING_V1).
            ...(parsed.rubricVersion === 'PRACTICE_WRITING_V1' &&
            Array.isArray(parsed.criteria)
              ? {
                  practice: {
                    rubricVersion: parsed.rubricVersion,
                    criteria: parsed.criteria,
                    strengths: parsed.strengths ?? [],
                    corrections: parsed.corrections ?? [],
                    wordCount: parsed.wordCount ?? null,
                    wordRange: parsed.wordRange ?? null,
                    keywords: parsed.keywords ?? [],
                  },
                }
              : {}),
          };
        }
      } catch {
        writingFeedback = null;
      }
    }

    // Catalog Writing exercises hold several tasks: say which one this is and
    // how far the learner is through the exercise.
    let writingExercise: Record<string, unknown> | null = null;
    const answeredTask = submission.results[0]?.questionId;
    if (
      isWritingSubmission &&
      submission.quiz.practiceTopicId &&
      answeredTask !== undefined
    ) {
      const ids = submission.quiz.questions.map((q) => q.id);
      const { summary } = await loadWritingExerciseProgress(
        this.prisma,
        submission.userId,
        submission.quizId,
        ids,
      );
      const task = submission.quiz.questions.find((q) => q.id === answeredTask);
      writingExercise = {
        questionId: answeredTask,
        position: ids.indexOf(answeredTask) + 1,
        prompt: (task?.content as { prompt?: string } | null)?.prompt ?? null,
        ...summary,
      };
    }

    return {
      submissionId,
      quizId: submission.quizId,
      quizTitle: submission.quiz.title,
      quizType: submission.quiz.type,
      overallScore: submission.score,
      totalQuestions,
      totalCorrect,
      overallAccuracyPercent: overallAccuracy,
      categoriesBreakdown,
      results: submission.results,
      // Writing reference answers and picture descriptions are grader-only.
      questions:
        isWritingSubmission && role !== Role.ADMIN
          ? submission.quiz.questions.map((q) => ({
              ...q,
              content: learnerVisibleTaskContent(q.content) as typeof q.content,
            }))
          : submission.quiz.questions,
      strengths:
        strengths.length > 0
          ? strengths
          : ['Cần luyện tập thêm để xác định điểm mạnh'],
      weaknesses:
        weaknesses.length > 0 ? weaknesses : ['Không có điểm yếu nghiêm trọng'],
      recommendation:
        weaknesses.length > 0
          ? `Bạn nên tập trung ôn luyện lại các mảng kiến thức: ${weaknesses.join(', ')}.`
          : 'Thành tích rất tốt! Hãy tiếp tục duy trì và thử sức ở đề thi khó hơn.',
      writingFeedback,
      writingExercise,
      submittedAnswer: isWritingSubmission
        ? (submission.results[0]?.answer ?? null)
        : null,
    };
  }
}
