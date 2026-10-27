/**
 * Reviewed Speaking practice grouping (Checkpoint 51), shared by
 * prisma/seed.ts and scripts/practice-level-normalization.ts so a fresh seed
 * reproduces the same sets, retitles and tasks as the normalized database.
 */
export const IMG = 'catalog/toeic/shared/images';

/** Reviewed grouping of the 30 authored items, with the reason for each level. */
export const SETS = [
  {
    id: 'practice-read-aloud-a1-a2',
    title: 'Đọc thành tiếng — Cơ bản',
    description:
      'Đọc to câu thông báo và tin nhắn đời thường với nhịp điệu rõ ràng.',
    category: 'GENERAL',
    level: 'A1-A2',
    taskType: 'READ_ALOUD',
    members: [1, 2, 3, 4, 5],
  },
  {
    id: 'practice-read-aloud-b1-b2',
    title: 'Đọc thành tiếng — Ngữ cảnh công việc',
    description:
      'Đọc thông báo công sở và dịch vụ có câu ghép, số liệu và từ chuyên ngành.',
    category: 'BUSINESS',
    level: 'B1-B2',
    taskType: 'READ_ALOUD',
    members: [6, 7, 8, 9, 10, 25, 26],
  },
  {
    id: 'practice-pronunciation-b1',
    title: 'Nền tảng phát âm — Trung cấp',
    description:
      'Âm cuối, đuôi -ed, trọng âm, số liệu và nối âm trong câu công việc.',
    category: 'GENERAL',
    level: 'B1',
    taskType: 'PRONUNCIATION_DRILL',
    members: [11, 12, 13, 14, 15],
  },
  {
    id: 'practice-describe-picture-b1',
    title: 'Mô tả tranh — Trung cấp',
    description:
      'Mô tả người, hành động và bối cảnh trong ảnh bằng câu hoàn chỉnh.',
    category: 'TOEIC',
    level: 'B1',
    taskType: 'DESCRIBE_PICTURE',
    members: [27, 28],
  },
  {
    id: 'practice-information-response-b1-b2',
    title: 'Trả lời dựa trên thông tin — Trung cấp',
    description:
      'Đọc lịch, bảng giờ hoặc thông báo rồi trả lời câu hỏi bằng thông tin chính xác.',
    category: 'TOEIC',
    level: 'B1-B2',
    taskType: 'RESPOND_USING_INFORMATION',
    members: [29],
  },
  {
    id: 'practice-question-response-a2',
    title: 'Phản hồi câu hỏi — Đời sống (Cơ bản)',
    description:
      'Trả lời câu hỏi quen thuộc về sinh hoạt hằng ngày bằng câu ngắn, rõ ý.',
    category: 'DAILY_LIFE',
    level: 'A2',
    taskType: 'RESPOND_TO_QUESTION',
    members: [16, 17],
  },
  {
    id: 'practice-question-response-b1-b2',
    title: 'Phản hồi câu hỏi — Học tập & Công việc',
    description:
      'Trả lời câu hỏi về học tập và công việc, có giải thích và ví dụ.',
    category: 'GENERAL',
    level: 'B1-B2',
    taskType: 'RESPOND_TO_QUESTION',
    members: [18, 19, 20],
  },
  {
    id: 'practice-opinion-b1-b2',
    title: 'Trình bày quan điểm — Trung cấp',
    description:
      'Nêu ý kiến có lý do và ví dụ về chủ đề đời sống và công việc.',
    category: 'GENERAL',
    level: 'B1-B2',
    taskType: 'EXPRESS_OPINION',
    members: [21, 22, 23, 24, 30],
  },
  {
    id: 'practice-opinion-c1',
    title: 'Trình bày quan điểm — Nâng cao',
    description:
      'Lập luận nhiều chiều, cân nhắc lợi hại và bảo vệ quan điểm về vấn đề xã hội, nghề nghiệp.',
    category: 'ACADEMIC',
    level: 'C1',
    taskType: 'EXPRESS_OPINION',
    members: [] as number[],
  },
] as const;

/** Authored items whose title had no CEFR tag; the tag is added (old → new). */
export const RETITLE: Record<number, [string, string]> = {
  11: [
    'Pronunciation — Final Consonants',
    'Pronunciation B1 — Final Consonants',
  ],
  12: ['Pronunciation — -ed Endings', 'Pronunciation B1 — -ed Endings'],
  13: ['Pronunciation — Word Stress', 'Pronunciation B1 — Word Stress'],
  14: ['Pronunciation — Numbers & Dates', 'Pronunciation B1 — Numbers & Dates'],
  15: ['Pronunciation — Linking', 'Pronunciation B1 — Linking'],
  25: ['TOEIC Speaking — Read Aloud 1', 'Read Aloud B1 — Conference Center'],
  26: ['TOEIC Speaking — Read Aloud 2', 'Read Aloud B1 — Parking Notice'],
  27: [
    'TOEIC Speaking — Describe Office Scene',
    'Describe a Picture B1 — Office Meeting',
  ],
  28: [
    'TOEIC Speaking — Describe Station Scene',
    'Describe a Picture B1 — Train Station',
  ],
  29: [
    'TOEIC Speaking — Information Response',
    'Information Response B2 — Seminar Schedule',
  ],
  30: ['TOEIC Speaking — Express Opinion', 'Opinion B2 — Free Staff Lunches'],
};

/**
 * Original tasks that bring each short set to five. Ids are fixed (as created
 * on the development database in Checkpoint 52) so the seed reproduces them
 * and the reference audio keys premium/speaking/reference/<id>.v1.mp3 match.
 */
export const EXTRA = [
  {
    id: 117,
    slug: 'qr-a2-free-time',
    set: 'practice-question-response-a2',
    title: 'Question Response A2 — Free Time',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'What do you like to do in your free time, and who do you usually do it with?',
  },
  {
    id: 118,
    slug: 'qr-a2-favourite-meal',
    set: 'practice-question-response-a2',
    title: 'Question Response A2 — Favourite Meal',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'What is your favourite meal, and when do you usually eat it?',
  },
  {
    id: 119,
    slug: 'qr-a2-home-area',
    set: 'practice-question-response-a2',
    title: 'Question Response A2 — Where You Live',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'Describe the area where you live. What do you like about it?',
  },
  {
    id: 120,
    slug: 'qr-b1-new-skill',
    set: 'practice-question-response-b1-b2',
    title: 'Question Response B1 — Learning a Skill',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'Tell me about a skill you learned recently. How did you learn it, and how long did it take?',
  },
  {
    id: 121,
    slug: 'qr-b2-adapting-to-change',
    set: 'practice-question-response-b1-b2',
    title: 'Question Response B2 — Adapting to Change',
    taskType: 'RESPOND_TO_QUESTION',
    text: 'Describe a change at your school or workplace that affected you. How did you adapt to it, and what did you learn?',
  },
  {
    id: 110,
    slug: 'dp-b1-checkout',
    set: 'practice-describe-picture-b1',
    title: 'Describe a Picture B1 — Supermarket Checkout',
    taskType: 'DESCRIBE_PICTURE',
    image: `${IMG}/grocery-checkout.png`,
    text: 'Describe a supermarket checkout where a customer is paying by card while a cashier scans a jar. Talk about the people, what they are doing and the items on the counter.',
  },
  {
    id: 111,
    slug: 'dp-b1-bicycle-rack',
    set: 'practice-describe-picture-b1',
    title: 'Describe a Picture B1 — Office Entrance',
    taskType: 'DESCRIBE_PICTURE',
    image: `${IMG}/bicycle-rack.png`,
    text: 'Describe the entrance of an office building where several bicycles are parked in a metal rack near a large glass door.',
  },
  {
    id: 112,
    slug: 'dp-b1-delivery',
    set: 'practice-describe-picture-b1',
    title: 'Describe a Picture B1 — Shop Delivery',
    taskType: 'DESCRIBE_PICTURE',
    image: `${IMG}/delivery-boxes.png`,
    text: 'Describe a delivery worker carrying three cardboard boxes into a small shop while a van with its back door open is parked outside.',
  },
  {
    id: 113,
    slug: 'ir-b2-office-move',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B2 — Office Move',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'Office move — Friday',
      content:
        '8:00 Pack your desk and label the boxes. 11:00 Movers arrive. 1:00 Lunch is provided in the break room. 3:00 IT sets up computers in the new office on the fourth floor.',
    },
    text: 'A colleague asks what will happen after lunch on moving day. Using the schedule, explain the afternoon plan and what they need to do.',
  },
  {
    id: 114,
    slug: 'ir-b2-evening-course',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B2 — Evening Course',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'Course: Customer Service Skills',
      content:
        'Mondays and Wednesdays, 6:00 to 8:00 p.m. Room 210. Fee: 45 dollars, materials included. Register by May 3.',
    },
    text: 'A caller wants to join the course but finishes work at 5:30 p.m. Using the information, tell them when and where it meets, what it costs and when they must register.',
  },
  {
    id: 115,
    slug: 'ir-b1-library-hours',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B1 — Library Hours',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'City Library — Opening hours',
      content:
        'Monday to Thursday 9:00 to 20:00. Friday 9:00 to 17:00. Saturday 10:00 to 16:00. Sunday closed. Study rooms can be booked online up to seven days ahead.',
    },
    text: 'Someone wants to study at the library on Friday evening with two friends. Using the information, explain whether this is possible and suggest another time.',
  },
  {
    id: 116,
    slug: 'ir-b2-airport-shuttle',
    set: 'practice-information-response-b1-b2',
    title: 'Information Response B2 — Airport Shuttle',
    taskType: 'RESPOND_USING_INFORMATION',
    stimulus: {
      title: 'Hotel shuttle to the airport',
      content:
        'Departures: 6:00, 8:30, 11:00 and 15:30. The trip takes 40 minutes. Free for hotel guests, 12 dollars for visitors. Book at the front desk.',
    },
    text: 'A guest has a 2:00 p.m. flight and must be at the airport two hours early. Using the timetable, recommend a shuttle and explain why.',
  },
  {
    id: 122,
    slug: 'op-c1-ai-hiring',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — AI in Hiring',
    taskType: 'EXPRESS_OPINION',
    text: 'To what extent should companies rely on artificial intelligence when deciding whom to hire? Weigh the benefits against the risks and explain your position.',
  },
  {
    id: 123,
    slug: 'op-c1-urban-development',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Urban Development',
    taskType: 'EXPRESS_OPINION',
    text: 'Rapid urban development often improves infrastructure but can push long-standing communities out of their neighbourhoods. How should city planners balance these competing priorities?',
  },
  {
    id: 124,
    slug: 'op-c1-university-purpose',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Purpose of University',
    taskType: 'EXPRESS_OPINION',
    text: 'Some argue that universities should prepare students for specific careers rather than provide a broad education. Evaluate both views and justify your conclusion.',
  },
  {
    id: 125,
    slug: 'op-c1-environmental-responsibility',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Environmental Responsibility',
    taskType: 'EXPRESS_OPINION',
    text: 'Should individuals or governments bear greater responsibility for reducing environmental damage? Build a reasoned argument and support it with examples.',
  },
  {
    id: 126,
    slug: 'op-c1-remote-collaboration',
    set: 'practice-opinion-c1',
    title: 'Opinion C1 — Remote Collaboration',
    taskType: 'EXPRESS_OPINION',
    text: 'Remote collaboration has become routine in many industries. Assess its long-term impact on team culture and on how junior employees develop professionally.',
  },
] as const;

/** Quiz whose title range overstated its demand (three A2 keyword sentences). */
export const QUIZ_RETITLE: Record<number, [string, string]> = {
  3: ['Writing A2–B1 — Sentence Builder', 'Writing A2 — Sentence Builder'],
};
export const CATEGORY_IDS: Record<string, number> = {
  GENERAL: 1,
  TOEIC: 2,
  BUSINESS: 3,
  ACADEMIC: 4,
  DAILY_LIFE: 5,
};
export const DIFFICULTY: Record<string, string> = {
  BASIC: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
};
