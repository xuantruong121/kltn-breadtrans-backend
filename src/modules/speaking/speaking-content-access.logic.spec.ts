import type { PracticeLevel } from '@prisma/client';
import {
  isPremiumSpeaking,
  speakingRequiredPlan,
} from './speaking-content-access.logic';

describe('Speaking plan rule shared by access and the CMS', () => {
  const inSet = (level: PracticeLevel, scope = 'SKILL_PRACTICE') => ({
    isPremiumContent: false,
    practiceSet: { scope, level },
  });

  it('reads the set level before the stored flag', () => {
    expect(isPremiumSpeaking(inSet('STARTER'))).toBe(false);
    expect(isPremiumSpeaking(inSet('BASIC'))).toBe(false);
    expect(isPremiumSpeaking(inSet('INTERMEDIATE'))).toBe(true);
    expect(speakingRequiredPlan(inSet('INTERMEDIATE'))).toBe('PLUS');
    expect(speakingRequiredPlan(inSet('ADVANCED'))).toBe('PRO');
  });

  it('falls back to the stored flag when there is no set level', () => {
    expect(speakingRequiredPlan({ isPremiumContent: false })).toBe('FREE');
    expect(speakingRequiredPlan({ isPremiumContent: true })).toBe('PRO');
  });

  it('gives an exam task no level of its own', () => {
    expect(isPremiumSpeaking(inSet('BASIC', 'EXAM_INTERNAL'))).toBe(false);
    expect(
      isPremiumSpeaking({
        ...inSet('BASIC', 'EXAM_INTERNAL'),
        isPremiumContent: true,
      }),
    ).toBe(true);
  });
});
