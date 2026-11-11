import { NotificationsCronService } from './notifications.cron';
import {
  DEFAULT_REMINDER_HOUR,
  STUDY_REMINDER_TYPE,
  isQuietHour,
  reminderHour,
  studyReminderMessage,
  vietnamHour,
} from './study-reminder.logic';
import { weeklyReportMessage } from './weekly-report.logic';

/** A moment at `hour` Vietnam time on a day of November 2026. */
const vn = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour - 7, minute));

describe('study-reminder.logic', () => {
  it('reads the hour in Vietnam time', () => {
    expect(vietnamHour(new Date('2026-11-11T13:30:00Z'))).toBe(20);
    expect(vietnamHour(new Date('2026-11-11T18:00:00Z'))).toBe(1);
  });

  it('keeps 22:00 to 07:00 quiet', () => {
    expect([21, 22, 23, 0, 6, 7].map(isQuietHour)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('uses the default hour until there is a habit to read', () => {
    expect(reminderHour([])).toBe(DEFAULT_REMINDER_HOUR);
    // Five sessions, but on two days only.
    expect(
      reminderHour([vn(1, 7), vn(1, 7), vn(1, 8), vn(2, 7), vn(2, 7)]),
    ).toBe(DEFAULT_REMINDER_HOUR);
    // Three days, but four sessions only.
    expect(reminderHour([vn(1, 7), vn(2, 7), vn(3, 7), vn(3, 8)])).toBe(
      DEFAULT_REMINDER_HOUR,
    );
  });

  it('picks the hour practised most often, the earliest on a tie', () => {
    const habit = [vn(1, 12), vn(2, 12), vn(3, 12), vn(3, 19), vn(4, 19)];
    expect(reminderHour(habit)).toBe(12);
    expect(reminderHour([...habit, vn(5, 19)])).toBe(12);
    expect(reminderHour([...habit, vn(5, 19), vn(6, 19)])).toBe(19);
  });

  it('moves a late-night or early-morning habit out of the quiet hours', () => {
    const at = (hour: number) => [1, 2, 3, 4, 5].map((day) => vn(day, hour));
    expect(reminderHour(at(23))).toBe(21);
    expect(reminderHour(at(5))).toBe(7);
  });

  it('says nothing when nothing is waiting', () => {
    expect(
      studyReminderMessage({ streak: 0, dueWords: 0, openMistakes: 0 }),
    ).toBeNull();
  });

  it('leads with the streak and names what else is waiting', () => {
    const message = studyReminderMessage({
      learnerName: 'An',
      streak: 6,
      dueWords: 12,
      openMistakes: 3,
    })!;
    expect(message).toEqual({
      title: 'Giữ chuỗi 6 ngày: hôm nay bạn chưa học',
      body: 'Chào An. Học một bài trước nửa đêm để giữ chuỗi. Đang chờ bạn: 12 từ đến hạn ôn, 3 lỗi chưa khắc phục.',
      url: '/dashboard',
    });
  });

  it('without a streak, leads with due words, then with mistakes', () => {
    expect(
      studyReminderMessage({ streak: 0, dueWords: 4, openMistakes: 2 }),
    ).toEqual({
      title: '4 từ đến hạn ôn hôm nay',
      body: 'Ôn đúng lúc giúp nhớ lâu hơn. Sổ lỗi còn 2 lỗi chưa khắc phục.',
      url: '/flashcard',
    });
    expect(
      studyReminderMessage({ streak: 0, dueWords: 0, openMistakes: 5 }),
    ).toMatchObject({ title: '5 lỗi đang chờ bạn ôn', url: '/mistakes' });
  });

  it('uses no emoji', () => {
    const message = studyReminderMessage({
      streak: 3,
      dueWords: 1,
      openMistakes: 1,
    })!;
    expect(`${message.title}${message.body}`).not.toMatch(
      /\p{Extended_Pictographic}/u,
    );
  });
});

describe('weeklyReportMessage with the mistake notebook', () => {
  const skills = [
    {
      skill: 'READING' as const,
      count: 2,
      average: 70,
      previousAverage: null,
      target: 2,
    },
  ];
  const weekStart = new Date('2026-11-08T17:00:00Z');

  it('names the frequent mistakes of last week', () => {
    const message = weeklyReportMessage({
      weekStart,
      skills,
      daysToExam: null,
      mistakeTags: ['Ngữ pháp: Giới từ', 'Luyện đề: Part 5'],
    });
    expect(message.body).toContain(
      'Lỗi hay gặp tuần qua: Ngữ pháp: Giới từ; Luyện đề: Part 5. Mở Sổ lỗi để ôn lại.',
    );
  });

  it('leaves the line out when there is nothing to name', () => {
    const message = weeklyReportMessage({
      weekStart,
      skills,
      daysToExam: null,
    });
    expect(message.body).not.toContain('Lỗi hay gặp');
  });
});

describe('NotificationsCronService.runStudyReminder', () => {
  const learner = (userId: number, streakCount: number) => ({
    userId,
    streakCount,
    user: { profile: { fullName: `Learner ${userId}` } },
  });
  /** Five sessions at `hour` on five days: a habit. */
  const habit = (userId: number, hour: number) =>
    [1, 2, 3, 4, 5].map((day) => ({ userId, createdAt: vn(day, hour) }));

  function setup(options: {
    candidates: ReturnType<typeof learner>[];
    events?: Array<{ userId: number; createdAt: Date }>;
    words?: Array<{ userId: number; _count: { _all: number } }>;
    mistakes?: Array<{ userId: number; _count: { _all: number } }>;
    earlierToday?: number;
  }) {
    const prisma = {
      userStats: { findMany: jest.fn().mockResolvedValue(options.candidates) },
      learnerProgressEvent: {
        findMany: jest.fn().mockResolvedValue(options.events ?? []),
      },
      userVocabWordProgress: {
        groupBy: jest.fn().mockResolvedValue(options.words ?? []),
      },
      learnerMistake: {
        groupBy: jest.fn().mockResolvedValue(options.mistakes ?? []),
      },
      notification: {
        count: jest.fn().mockResolvedValue(options.earlierToday ?? 0),
      },
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 1 }),
      sendPushToUser: jest.fn().mockResolvedValue(undefined),
    };
    const cron = new NotificationsCronService(
      prisma as any,
      notifications as any,
    );
    return { cron, prisma, notifications };
  }

  it('sends nothing in the quiet hours, and reads nothing', async () => {
    const { cron, prisma, notifications } = setup({
      candidates: [learner(1, 3)],
    });
    expect(await cron.runStudyReminder(vn(11, 23))).toMatchObject({ sent: 0 });
    expect(prisma.userStats.findMany).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('asks only for learners who studied lately, not today, with no reminder today', async () => {
    const { cron, prisma } = setup({ candidates: [] });
    await cron.runStudyReminder(vn(11, 20));
    const where = prisma.userStats.findMany.mock.calls[0][0].where;
    const today = new Date('2026-11-10T17:00:00Z');
    expect(where.lastStreakUpdate).toEqual({
      gte: new Date(today.getTime() - 14 * 86_400_000),
      lt: today,
    });
    expect(where.user.notifications.none).toEqual({
      type: { in: [STUDY_REMINDER_TYPE, 'streak'] },
      createdAt: { gte: today },
    });
  });

  it('reminds each learner at their own hour: the habit hour, or 20:00 without one', async () => {
    const options = {
      candidates: [learner(1, 4), learner(2, 2)],
      events: habit(1, 12),
    };
    const noon = setup(options);
    expect(await noon.cron.runStudyReminder(vn(11, 12, 5))).toMatchObject({
      candidates: 2,
      sent: 1,
    });
    expect(noon.notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(noon.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        type: STUDY_REMINDER_TYPE,
        title: 'Giữ chuỗi 4 ngày: hôm nay bạn chưa học',
        url: '/dashboard',
      }),
    );

    const evening = setup(options);
    await evening.cron.runStudyReminder(vn(11, 20));
    expect(evening.notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(evening.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 2 }),
    );

    const other = setup(options);
    expect(await other.cron.runStudyReminder(vn(11, 15))).toMatchObject({
      sent: 0,
    });
  });

  it('puts the real counts in the text', async () => {
    const { cron, notifications } = setup({
      candidates: [learner(1, 0)],
      words: [{ userId: 1, _count: { _all: 7 } }],
      mistakes: [{ userId: 1, _count: { _all: 2 } }],
    });
    await cron.runStudyReminder(vn(11, 20));
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '7 từ đến hạn ôn hôm nay',
        body: expect.stringContaining('Sổ lỗi còn 2 lỗi chưa khắc phục.'),
        url: '/flashcard',
      }),
    );
    expect(notifications.sendPushToUser).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ url: '/flashcard' }),
    );
  });

  it('skips a learner with nothing waiting', async () => {
    const { cron, notifications } = setup({ candidates: [learner(1, 0)] });
    expect(await cron.runStudyReminder(vn(11, 20))).toMatchObject({ sent: 0 });
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('writes the inbox entry but does not push a second study reminder the same day', async () => {
    const { cron, notifications } = setup({
      candidates: [learner(1, 5)],
      // A vocabulary reminder was already sent today.
      earlierToday: 1,
    });
    await cron.runStudyReminder(vn(11, 20));
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendPushToUser).not.toHaveBeenCalled();
  });
});
