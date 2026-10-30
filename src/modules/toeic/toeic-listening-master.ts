/**
 * Continuous Listening recordings ("masters") for TOEIC L&R exam sets.
 *
 * A master is one MP3 built offline by scripts/toeic-listening-master.ts from
 * the exam's approved group clips plus original BreadTrans narration, with a
 * timeline of where each group starts and ends. It is used only by flexible
 * PRACTICE attempts (play, pause, seek, replay); strict FULL_TEST attempts
 * keep the server-enforced one-pass group audio.
 *
 * A master is offered only while its timeline still matches the exam's
 * current Listening groups in order; any content change makes it stale and
 * the learner falls back to per-group audio.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { EXAM_1_LISTENING_MASTER } from './listening-master/exam-1';

export type ListeningMasterSegment = {
  kind: 'INTRO' | 'DIRECTIONS' | 'GROUP' | 'END';
  part?: number;
  groupId?: number;
  questionNumbers?: number[];
  start: number;
  end: number;
};

export type ListeningMaster = {
  examId: number;
  key: string;
  sha256: string;
  bytes: number;
  durationSeconds: number;
  format: string;
  responseGapSeconds: Record<string, number>;
  timeline: ListeningMasterSegment[];
};

const REGISTRY: Record<number, ListeningMaster> = {
  [EXAM_1_LISTENING_MASTER.examId]: EXAM_1_LISTENING_MASTER,
};

export function listeningMasterFor(examId: number): ListeningMaster | null {
  return REGISTRY[examId] ?? null;
}

/** True when the master's groups are exactly the exam's Listening groups, in order. */
export function masterMatchesGroups(
  master: ListeningMaster,
  orderedGroupIds: number[],
): boolean {
  const masterIds = master.timeline
    .filter((segment) => segment.kind === 'GROUP')
    .map((segment) => segment.groupId);
  return (
    masterIds.length === orderedGroupIds.length &&
    masterIds.every((id, index) => id === orderedGroupIds[index])
  );
}

/**
 * Where the master lives in the private bucket. Exam audio is moved there
 * (copied, then the public object removed) so it can only be read through
 * the guarded stream route; the name keeps the public object's file name.
 */
export function privateListeningMasterKey(master: ListeningMaster): string {
  const file = master.key.split('/').pop();
  return `premium/listening/toeic/exam-${master.examId}/listening-master/${file}`;
}

export function listeningMasterUrl(master: ListeningMaster): string | null {
  const base = (
    process.env.TOEIC_LISTENING_MASTER_BASE_URL ??
    process.env.R2_PUBLIC_URL ??
    ''
  ).replace(/\/$/, '');
  return base ? `${base}/${master.key}` : null;
}

/**
 * The local master is the exam's whole Listening section, so its stream is
 * exam content. The stream URL is an <audio src> (no Authorization header):
 * it carries a short-lived grant that getListeningMaster issues only after
 * checking the attempt's owner and lifecycle. Format:
 * `<examId>.<attemptId>.<userId>.<expiresAtSeconds>.<hmac>`.
 */
export const LISTENING_MASTER_GRANT_TTL_SECONDS = 4 * 60 * 60;

const grantMac = (payload: string, secret: string) =>
  createHmac('sha256', secret)
    .update(`toeic-listening-master:${payload}`)
    .digest('base64url');

export function signListeningMasterGrant(
  grant: { examId: number; attemptId: number; userId: number },
  secret: string,
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now / 1000) + LISTENING_MASTER_GRANT_TTL_SECONDS;
  const payload = `${grant.examId}.${grant.attemptId}.${grant.userId}.${expiresAt}`;
  return `${payload}.${grantMac(payload, secret)}`;
}

/**
 * The grant's attempt and user when it is unexpired, untampered and issued
 * for this exam; otherwise null. The grant is a capability (whoever holds the
 * URL can use it until it expires); the stream route re-checks the attempt.
 */
export function readListeningMasterGrant(
  token: unknown,
  examId: number,
  secret: string,
  now = Date.now(),
): { attemptId: number; userId: number } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 5 || !parts.slice(0, 4).every((p) => /^\d+$/.test(p)))
    return null;
  if (Number(parts[0]) !== examId) return null;
  if (Number(parts[3]) * 1000 <= now) return null;
  const given = Buffer.from(parts[4]);
  const expected = Buffer.from(grantMac(parts.slice(0, 4).join('.'), secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  return { attemptId: Number(parts[1]), userId: Number(parts[2]) };
}

/** True only for an unexpired, untampered grant issued for this exam. */
export function verifyListeningMasterGrant(
  token: unknown,
  examId: number,
  secret: string,
  now = Date.now(),
): boolean {
  return readListeningMasterGrant(token, examId, secret, now) !== null;
}
