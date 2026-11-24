import { levelUpNotice, petLevelUpNotice } from './level-up.logic';
import { xpLevel } from './ranking.logic';

describe('levelUpNotice', () => {
  it('names the new level and the XP still needed for the next one', () => {
    // Cấp 5 starts at 1.000 XP, Cấp 6 at 1.500.
    expect(xpLevel(1020)).toBe(5);
    expect(levelUpNotice({ level: 5, totalPoints: 1020 })).toEqual({
      type: 'level_up:5',
      title: 'Bạn đã lên Cấp 5',
      body: 'Bạn đã có 1.020 XP. Còn 480 XP để lên Cấp 6.',
      url: '/ranking',
    });
  });

  it('gives one line for the level reached when an award skips a level', () => {
    // 250 -> 650 XP goes from Cấp 2 past Cấp 3 to Cấp 4.
    expect(xpLevel(650)).toBe(4);
    const notice = levelUpNotice({ level: xpLevel(650), totalPoints: 650 });
    expect(notice.type).toBe('level_up:4');
    expect(notice.body).toBe('Bạn đã có 650 XP. Còn 350 XP để lên Cấp 5.');
  });

  it('writes large totals with Vietnamese thousands', () => {
    expect(levelUpNotice({ level: 15, totalPoints: 10500 }).body).toBe(
      'Bạn đã có 10.500 XP. Còn 1.500 XP để lên Cấp 16.',
    );
  });
});

describe('petLevelUpNotice', () => {
  it('names the new level and the EXP still needed', () => {
    expect(petLevelUpNotice({ level: 3, expToNext: 990 })).toEqual({
      type: 'pet_level_up:3',
      title: 'Thú ảo đã lên Cấp 3',
      body: 'Thú ảo lớn lên nhờ bài luyện tập và bữa ăn mỗi ngày. Còn 990 EXP để lên Cấp 4.',
      url: '/pet',
    });
  });

  it('says nothing about the next level when the level ran ahead of its EXP', () => {
    expect(petLevelUpNotice({ level: 4, expToNext: -20 }).body).toBe(
      'Thú ảo lớn lên nhờ bài luyện tập và bữa ăn mỗi ngày.',
    );
  });
});
