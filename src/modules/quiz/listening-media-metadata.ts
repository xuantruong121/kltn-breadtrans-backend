/* eslint-disable @typescript-eslint/no-implied-eval -- load the ESM parser from CJS */
type MusicMetadataModule = typeof import('music-metadata');

let modulePromise: Promise<MusicMetadataModule> | undefined;

function loadMusicMetadata(): Promise<MusicMetadataModule> {
  modulePromise ??=
    // music-metadata is ESM-only; keep the import dynamic so the CJS Nest/Jest
    // runtime does not ask ts-jest to require an ESM package.

    (
      Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<MusicMetadataModule>
    )('music-metadata');
  return modulePromise;
}

/**
 * Reads the duration of the final encoded media, not the provider speech clock.
 * The MP3 bytes are the durable source of truth for artifact media metadata.
 */
export async function parseEncodedMp3DurationMs(
  audio: Buffer,
): Promise<number> {
  if (!audio.length) throw new Error('Encoded audio is empty.');
  const { parseBuffer } = await loadMusicMetadata();
  const metadata = await parseBuffer(audio, {
    mimeType: 'audio/mpeg',
    size: audio.length,
  });
  const seconds = metadata.format.duration;
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Encoded MP3 duration is unavailable.');
  }
  return Math.max(1, Math.round(seconds * 1000));
}
