import { skillDeleteRefusal } from './skill-content-delete';

describe('skillDeleteRefusal (owner 2026-11-17)', () => {
  const base = { status: 'DRAFT', attempts: 0, examInternal: false };

  it('lets a speaking set with no recordings go, published or not', () => {
    expect(skillDeleteRefusal({ ...base, domain: 'speaking' })).toBeNull();
    expect(
      skillDeleteRefusal({ ...base, domain: 'speaking', status: 'PUBLISHED' }),
    ).toBeNull();
  });

  it('keeps a speaking set that learners have recorded on', () => {
    expect(
      skillDeleteRefusal({ ...base, domain: 'speaking', attempts: 3 }),
    ).toContain('chuyển về bản nháp');
  });

  it('keeps a speaking set that belongs to an exam', () => {
    expect(
      skillDeleteRefusal({ ...base, domain: 'speaking', examInternal: true }),
    ).toContain('đề thi');
  });

  it('lets a draft quiz with no submission go', () => {
    for (const domain of ['listening', 'reading', 'writing'] as const)
      expect(skillDeleteRefusal({ ...base, domain })).toBeNull();
  });

  it('keeps a published quiz, a quiz with submissions, and an exam task', () => {
    expect(
      skillDeleteRefusal({ ...base, domain: 'reading', status: 'PUBLISHED' }),
    ).toContain('bản nháp');
    expect(
      skillDeleteRefusal({ ...base, domain: 'listening', attempts: 1 }),
    ).toContain('học viên làm');
    expect(
      skillDeleteRefusal({ ...base, domain: 'writing', examInternal: true }),
    ).toContain('đề thi');
  });
});
