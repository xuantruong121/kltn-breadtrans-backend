import {
  getSpeakingPipelineMode,
  isMissingStorageError,
} from './speaking.constants';

describe('Speaking pipeline safety helpers', () => {
  const originalMode = process.env.SPEAKING_PIPELINE_MODE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.SPEAKING_PIPELINE_MODE;
    else process.env.SPEAKING_PIPELINE_MODE = originalMode;
  });

  it('accepts only the two supported pipeline modes', () => {
    process.env.SPEAKING_PIPELINE_MODE = 'bullmq';
    expect(getSpeakingPipelineMode()).toBe('bullmq');
    process.env.SPEAKING_PIPELINE_MODE = 'legacy';
    expect(getSpeakingPipelineMode()).toBe('legacy');
    process.env.SPEAKING_PIPELINE_MODE = 'invalid';
    expect(() => getSpeakingPipelineMode()).toThrow(/Invalid SPEAKING_PIPELINE_MODE/);
  });

  it('classifies missing-object storage errors as terminal', () => {
    expect(isMissingStorageError({ name: 'NoSuchKey' })).toBe(true);
    expect(isMissingStorageError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isMissingStorageError(new Error('The specified key does not exist.'))).toBe(true);
    expect(isMissingStorageError({ code: 'ETIMEDOUT', message: 'timeout' })).toBe(false);
  });
});
