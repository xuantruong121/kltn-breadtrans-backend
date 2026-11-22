import {
  isPremiumSpeaking,
  speakingRequiredPlan,
} from './speaking-content-access.logic';

describe('Speaking plan rule shared by access and the CMS', () => {
  const inSet = (level: string, scope = 'SKILL_PRACTICE') => ({
    isPremiumContent: false,
    title: 'Task',
    practiceSet: { scope, level },
  });

  it('reads the set level before the stored flag', () => {
    expect(isPremiumSpeaking(inSet('A1-A2'))).toBe(false);
    expect(isPremiumSpeaking(inSet('B1-B2'))).toBe(true);
    expect(speakingRequiredPlan(inSet('B1'))).toBe('PLUS');
    expect(speakingRequiredPlan(inSet('C1'))).toBe('PRO');
  });

  it('falls back to the title tag, then to the stored flag', () => {
    expect(
      speakingRequiredPlan({
        isPremiumContent: false,
        title: 'Opinion B2 — Free Staff Lunches',
      }),
    ).toBe('PLUS');
    expect(speakingRequiredPlan({ isPremiumContent: false, title: 'x' })).toBe(
      'FREE',
    );
    expect(speakingRequiredPlan({ isPremiumContent: true, title: 'x' })).toBe(
      'PRO',
    );
  });

  it('gives an exam task no level of its own', () => {
    expect(isPremiumSpeaking(inSet('A2', 'EXAM_INTERNAL'))).toBe(false);
    expect(
      isPremiumSpeaking({
        ...inSet('A2', 'EXAM_INTERNAL'),
        isPremiumContent: true,
      }),
    ).toBe(true);
  });
});
