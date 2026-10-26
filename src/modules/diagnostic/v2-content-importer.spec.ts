/**
 * C2-FIND-001 regression: the importer left DiagnosticAssessment.contentVersion
 * at its schema default of 1 while importing approved content version 6. The
 * fake client records what would be written and stops the transaction right
 * after the assessment step; no database is involved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { importApprovedContent } from './v2-content-importer';

const ARTIFACTS = join(__dirname, '..', '..', '..', 'artifacts');
const approvedVersion: number = JSON.parse(
  readFileSync(
    join(ARTIFACTS, 'entry-diagnostic-v2-content-draft.json'),
    'utf8',
  ),
).contentVersion;

function fakeClient(existing: Record<string, unknown> | null) {
  const writes: Array<{ op: string; data: any }> = [];
  const tx = {
    diagnosticAssessment: {
      findUnique: jest.fn(() => Promise.resolve(existing)),
      create: jest.fn(({ data }: any) => {
        writes.push({ op: 'create', data });
        return Promise.resolve({ id: 5, ...data });
      }),
      update: jest.fn(({ data }: any) => {
        writes.push({ op: 'update', data });
        return Promise.resolve({ ...existing, ...data });
      }),
    },
  };
  return {
    writes,
    client: { $transaction: <T>(fn: (t: any) => Promise<T>) => fn(tx) },
  };
}

describe('importApprovedContent contentVersion (C2-FIND-001)', () => {
  it('the approved draft is content version 6', () => {
    expect(approvedVersion).toBe(6);
  });

  it('writes the approved contentVersion when creating the assessment', async () => {
    const { client, writes } = fakeClient(null);
    await expect(
      importApprovedContent(client, {
        artifactDir: ARTIFACTS,
        failAfter: 'assessment',
      }),
    ).rejects.toThrow('injected failure: assessment');
    expect(writes).toEqual([
      {
        op: 'create',
        data: expect.objectContaining({
          sourceKey: 'DIAG_V2_ASSESSMENT',
          contentVersion: 6,
          isActive: false,
          status: 'DRAFT',
        }),
      },
    ]);
  });

  it('corrects an existing row left at contentVersion 1, keeping it inactive DRAFT', async () => {
    const { client, writes } = fakeClient({
      id: 5,
      sourceKey: 'DIAG_V2_ASSESSMENT',
      title: 'Kiểm tra đầu vào',
      description: '',
      isActive: false,
      status: 'DRAFT',
      scoringVersion: 'FOUR_SKILL_PLACEMENT_V2',
      blueprintVersion: 'V2_2026_01',
      contentVersion: 1,
    });
    await expect(
      importApprovedContent(client, {
        artifactDir: ARTIFACTS,
        failAfter: 'assessment',
      }),
    ).rejects.toThrow('injected failure: assessment');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      op: 'update',
      data: { contentVersion: 6, isActive: false, status: 'DRAFT' },
    });
  });
});
