/**
 * R2 files of admin skill content (bug 2026-11-22). Deleting a listening quiz
 * removed its rows and left its audio public: `catalog/listening/practice/
 * audio/quiz-103/question-415/v1/<uuid>.mp3` stayed reachable after quiz 103
 * was gone, and the owner deleted 824 orphan objects by hand on 2026-11-20.
 *
 * Only keys the server wrote, under the owning item's own prefix, are delete
 * targets: the rule the account purge follows since the security review of
 * 2026-11-21 (ownedRecordingKey). A URL or key an admin typed into a free text
 * field is never one. Question images, "Viết theo tranh" pictures, Speaking
 * images and stimuli are generic uploads (`images/<uuid>`): they carry no
 * owner, exam copies share them, so they stay.
 *
 * Pure: no Prisma, no I/O.
 */
import { plainKey } from '../account/account-deletion.logic';

/**
 * Redis set of content keys whose delete failed. The weekly R2 cleanup job
 * retries it (ContentFilesService.retryFailed).
 */
export const CONTENT_R2_RETRY_SET = 'content:delete:r2-retry';

export type ContentFileOwner =
  | { kind: 'listening-quiz'; quizId: number }
  | { kind: 'listening-question'; quizId: number; questionId: number }
  | { kind: 'speaking-exercise'; exerciseId: number };

/** Where the server writes the files of one content item. */
export function contentFilePrefixes(owner: ContentFileOwner): string[] {
  if (owner.kind === 'speaking-exercise')
    // generateSpeakingReferenceAudio: `<exerciseId>.r<timestamp>.mp3`.
    return [
      `catalog/speaking/reference/${owner.exerciseId}.r`,
      `premium/speaking/reference/${owner.exerciseId}.r`,
    ];
  const quiz = `quiz-${owner.quizId}/`;
  const scope =
    owner.kind === 'listening-question'
      ? `${quiz}question-${owner.questionId}/`
      : quiz;
  const prefixes = [
    // Question clips: TTS, dialogue uploads and the audio repair scripts.
    `catalog/listening/practice/audio/${scope}`,
    `catalog/listening/practice/dialogue/${scope}`,
    // An uploaded clip of a free question that is not a dialogue.
    `listening/${scope}`,
    // Premium clips, and the premium whole-quiz audio.
    `premium/listening/${scope}`,
  ];
  // The whole-quiz audio of a free quiz: `.../quiz-<id>/audio/v<n>/full.mp3`.
  if (owner.kind === 'listening-quiz')
    prefixes.push(`catalog/listening/practice/${quiz}`);
  return prefixes;
}

/** The key, when it is a plain key under the owner's own prefix; else null. */
export function ownedContentKey(
  owner: ContentFileOwner,
  value: string | null | undefined,
): string | null {
  const key = plainKey(value);
  if (!key) return null;
  return contentFilePrefixes(owner).some((prefix) => key.startsWith(prefix))
    ? key
    : null;
}

/**
 * The object key behind a stored value: a bare key, or a URL on the public
 * bucket's own base (a free Speaking reference audio is stored as its URL).
 * A URL on any other host is null.
 */
export function storedObjectKey(
  value: string | null | undefined,
  publicBaseUrl: string | null | undefined,
): string | null {
  const stored = (value ?? '').trim();
  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (base && stored.startsWith(`${base}/`)) {
    const key = stored.slice(base.length + 1);
    // A query or a fragment belongs to a URL, not to a key the server wrote.
    return /[?#]/.test(key) ? null : plainKey(key);
  }
  return plainKey(stored);
}

const SPEAKING_KEY = /^(?:catalog|premium)\/speaking\/reference\/(\d+)\.r/;
const LISTENING_KEY =
  /^(?:catalog\/listening\/practice\/(?:audio\/|dialogue\/)?|listening\/|premium\/listening\/)quiz-(\d+)\/(?:question-(\d+)\/)?/;

/**
 * The content item a queued key belongs to, read from the key itself, or null
 * when the key is not a content file at all. The retry deletes a key only
 * when this owner is gone.
 */
export function contentKeyOwner(
  value: string | null | undefined,
): ContentFileOwner | null {
  const key = plainKey(value);
  if (!key) return null;
  let owner: ContentFileOwner | null = null;
  const speaking = SPEAKING_KEY.exec(key);
  const listening = LISTENING_KEY.exec(key);
  if (speaking)
    owner = { kind: 'speaking-exercise', exerciseId: Number(speaking[1]) };
  else if (listening)
    owner = listening[2]
      ? {
          kind: 'listening-question',
          quizId: Number(listening[1]),
          questionId: Number(listening[2]),
        }
      : { kind: 'listening-quiz', quizId: Number(listening[1]) };
  return owner && ownedContentKey(owner, key) ? owner : null;
}
