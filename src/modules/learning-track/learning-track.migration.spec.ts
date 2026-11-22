import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GENERAL_TRACK,
  normalizeTrackName,
  TRACK_CODE_PATTERN,
} from './learning-track.logic';

const MIGRATION = join(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
  '20261121120000_learning_track_table',
  'migration.sql',
);

/** The rows the migration inserts into "LearningTrack". */
function seededTracks() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const insert = /INSERT INTO "LearningTrack"[^;]*;/.exec(sql)?.[0] ?? '';
  return [
    ...insert.matchAll(
      /\('([^']*)', '([^']*)', '([^']*)', '([^']*)', (\d+)\)/g,
    ),
  ].map(([, code, name, nameNormalized, description, sortOrder]) => ({
    code,
    name,
    nameNormalized,
    description,
    sortOrder: Number(sortOrder),
  }));
}

describe('migration 20261121120000_learning_track_table', () => {
  const tracks = seededTracks();

  it('seeds the six codes of the old enum', () => {
    expect(tracks.map((track) => track.code).sort()).toEqual([
      'GENERAL',
      'HOSPITALITY_TOURISM',
      'IT_SOFTWARE',
      'OFFICE_BUSINESS',
      'SALES_CUSTOMER_SERVICE',
      'STUDENT_ACADEMIC',
    ]);
    for (const track of tracks)
      expect(TRACK_CODE_PATTERN.test(track.code)).toBe(true);
  });

  it('stores what normalizeTrackName returns for every name', () => {
    // A parse that found no rows must not pass by checking nothing.
    expect(tracks).toHaveLength(6);
    for (const track of tracks)
      expect(track.nameNormalized).toBe(normalizeTrackName(track.name));
  });

  it('names GENERAL "Chung" and sorts it last', () => {
    const general = tracks.find((track) => track.code === GENERAL_TRACK)!;
    expect(general.name).toBe('Chung');
    expect(tracks.map((track) => track.sortOrder)).toEqual([
      10, 20, 30, 40, 50, 1000,
    ]);
    expect(tracks[tracks.length - 1].code).toBe(GENERAL_TRACK);
  });

  it('gives every track a description', () => {
    for (const track of tracks) expect(track.description.trim()).not.toBe('');
  });
});
