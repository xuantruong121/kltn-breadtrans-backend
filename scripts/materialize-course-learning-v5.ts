import {
  CourseLessonExerciseType,
  CourseLessonSectionType,
  CourseLessonStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Idempotent V5.1 content materializer.
 * It updates stable lesson/exercise/question keys and never deletes historical
 * attempts or rows. Content is intentionally course-specific; counts are a
 * consequence of the lesson design, not a target.
 */
const prisma = new PrismaClient();
const artifactDir = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'course-learning-experience-5-1',
);

type Focus =
  | 'LISTENING'
  | 'SPEAKING'
  | 'READING'
  | 'WRITING'
  | 'GRAMMAR'
  | 'VOCABULARY'
  | 'PRONUNCIATION';

type CoursePlan = {
  focus: Focus[];
  topics: string[];
  theme: string;
  level: string;
  reference: { title: string; publisher: string; url: string };
};

const coursePlans: Record<number, CoursePlan> = {
  1: {
    focus: [
      'LISTENING',
      'SPEAKING',
      'READING',
      'WRITING',
      'GRAMMAR',
      'VOCABULARY',
      'PRONUNCIATION',
      'LISTENING',
    ],
    topics: [
      'meeting a new neighbour',
      'introducing yourself at a class',
      'reading a library notice',
      'writing a weekend message',
      'questions with be and do',
      'family and daily routines',
      'word stress in common names',
      'asking for directions in town',
    ],
    theme: 'English Foundations A1–A2',
    level: 'A1-A2',
    reference: {
      title: 'Starting Out: everyday English',
      publisher: 'British Council LearnEnglish',
      url: 'https://learnenglish.britishcouncil.org/skills/listening/a1-listening',
    },
  },
  2: {
    focus: [
      'LISTENING',
      'SPEAKING',
      'READING',
      'WRITING',
      'LISTENING',
      'SPEAKING',
      'READING',
      'WRITING',
    ],
    topics: [
      'a team stand-up',
      'clarifying a work request',
      'a staff-room notice',
      'a follow-up email',
      'a delayed delivery call',
      'a project update',
      'a workplace policy',
      'a meeting summary',
    ],
    theme: 'B1 Four Skills at Work',
    level: 'B1',
    reference: {
      title: 'English for work: meetings and calls',
      publisher: 'British Council LearnEnglish',
      url: 'https://learnenglish.britishcouncil.org/business-english',
    },
  },
  3: {
    focus: [
      'LISTENING',
      'READING',
      'GRAMMAR',
      'VOCABULARY',
      'LISTENING',
      'READING',
      'GRAMMAR',
      'VOCABULARY',
    ],
    topics: [
      'TOEIC Part 2 time questions',
      'scanning an office email',
      'Part 5 verb forms',
      'workplace collocations',
      'Part 3 announcement cues',
      'Part 7 notice purpose',
      'connectors in Part 6',
      'paraphrases in advertisements',
    ],
    theme: 'TOEIC 450–650 foundations',
    level: 'B1',
    reference: {
      title: 'TOEIC test format and sample tasks',
      publisher: 'ETS Global',
      url: 'https://www.ets.org/toeic/test-takers/prepare.html',
    },
  },
  4: {
    focus: [
      'READING',
      'LISTENING',
      'GRAMMAR',
      'VOCABULARY',
      'READING',
      'LISTENING',
      'GRAMMAR',
      'VOCABULARY',
    ],
    topics: [
      'multi-document inference',
      'multi-speaker disagreement',
      'reduced relative clauses',
      'formal workplace nuance',
      'author purpose and tone',
      'implied action in meetings',
      'advanced conditional forms',
      'near-synonyms in context',
    ],
    theme: 'TOEIC 650–850+ advanced strategies',
    level: 'B2-C1',
    reference: {
      title: 'Advanced grammar in context',
      publisher: 'Cambridge Dictionary',
      url: 'https://dictionary.cambridge.org/grammar/british-grammar/',
    },
  },
  5: {
    focus: [
      'SPEAKING',
      'WRITING',
      'SPEAKING',
      'WRITING',
      'SPEAKING',
      'WRITING',
      'SPEAKING',
      'WRITING',
    ],
    topics: [
      'answering a workplace question',
      'a clear business email opening',
      'describing a process aloud',
      'requesting a schedule change',
      'handling a customer concern',
      'writing a concise recommendation',
      'giving a short presentation',
      'closing an action-focused email',
    ],
    theme: 'TOEIC Speaking & Writing performance',
    level: 'B1-B2',
    reference: {
      title: 'Business writing and presentation language',
      publisher: 'British Council LearnEnglish',
      url: 'https://learnenglish.britishcouncil.org/business-english/english-emails',
    },
  },
  6: {
    focus: [
      'LISTENING',
      'READING',
      'SPEAKING',
      'WRITING',
      'LISTENING',
      'READING',
      'SPEAKING',
      'WRITING',
    ],
    topics: [
      'read a brief and listen for a change',
      'compare a notice with an email',
      'respond to a project update',
      'write a follow-up after a call',
      'listen to a customer request',
      'infer a deadline from two sources',
      'negotiate a small change',
      'summarise a meeting decision',
    ],
    theme: 'TOEIC Four Skills integrated tasks',
    level: 'B1-B2',
    reference: {
      title: 'Integrated workplace communication',
      publisher: 'British Council LearnEnglish',
      url: 'https://learnenglish.britishcouncil.org/skills',
    },
  },
  7: {
    focus: [
      'SPEAKING',
      'WRITING',
      'LISTENING',
      'VOCABULARY',
      'SPEAKING',
      'WRITING',
      'LISTENING',
      'VOCABULARY',
    ],
    topics: [
      'opening a weekly meeting',
      'a customer service email',
      'a phone message for a colleague',
      'negotiating delivery terms',
      'presenting a sales update',
      'a polite complaint response',
      'a video-call handoff',
      'problem-solving language',
    ],
    theme: 'Business English for meetings and customers',
    level: 'B1-B2',
    reference: {
      title: 'English for meetings and customer service',
      publisher: 'British Council LearnEnglish',
      url: 'https://learnenglish.britishcouncil.org/business-english/meetings',
    },
  },
  8: {
    focus: [
      'GRAMMAR',
      'VOCABULARY',
      'GRAMMAR',
      'VOCABULARY',
      'GRAMMAR',
      'VOCABULARY',
      'GRAMMAR',
      'VOCABULARY',
    ],
    topics: [
      'present simple and present continuous',
      'word families for work and study',
      'articles and countability',
      'collocations with make and do',
      'past forms and time markers',
      'synonyms and register',
      'conditionals for real plans',
      'prepositions in fixed phrases',
    ],
    theme: 'Grammar & Vocabulary Builder',
    level: 'A2-C1',
    reference: {
      title: 'Grammar and vocabulary reference',
      publisher: 'Cambridge Dictionary',
      url: 'https://dictionary.cambridge.org/grammar/british-grammar/',
    },
  },
};

const courseMedia: Record<number, string> = {
  1: '/images/courses/course-1-foundations.svg',
  2: '/images/courses/course-2-four-skills.svg',
  3: '/images/courses/course-3-toeic-foundation.svg',
  4: '/images/courses/course-4-toeic-advanced.svg',
  5: '/images/courses/course-5-speaking-writing.svg',
  6: '/images/courses/course-6-four-skills-mastery.svg',
  7: '/images/courses/course-7-business-english.svg',
  8: '/images/courses/course-8-grammar-vocabulary.svg',
};

const focusLabel = (focus: Focus) => focus.toLowerCase().replace('_', ' ');

function sectionRows(
  plan: CoursePlan,
  topic: string,
  focus: Focus,
  order: number,
) {
  const label = focusLabel(focus);
  const courseContext = `${plan.theme}, lesson ${order}`;
  return [
    [
      CourseLessonSectionType.INTRO,
      'Mục tiêu và ngữ cảnh',
      {
        paragraphs: [
          `Trong ${courseContext}, bạn sẽ xử lý chủ đề “${topic}” bằng ${label}.`,
          'Hãy đọc mục tiêu trước, sau đó thử nhiệm vụ mà không tra đáp án.',
        ],
        bullets: [
          'Xác định người nói/người đọc và mục đích giao tiếp.',
          'Ghi lại một cụm từ bạn muốn dùng lại.',
        ],
      },
    ],
    [
      CourseLessonSectionType.THEORY,
      'Kiến thức cốt lõi',
      {
        paragraphs: [
          `${topic[0].toUpperCase() + topic.slice(1)} thường xuất hiện trong tình huống học tập và công việc. Với ${label}, hãy chú ý dấu hiệu ngữ nghĩa thay vì dịch từng từ.`,
          `Trong ${plan.theme}, thông tin quan trọng thường được diễn đạt bằng một câu trực tiếp và một cách nói tương đương.`,
        ],
        bullets: [
          'Nhận diện từ khóa trước khi chọn câu trả lời.',
          'Đối chiếu hình thức, ý nghĩa và ngữ cảnh trước khi kết luận.',
          'Tự nói lại quy tắc bằng một câu ngắn.',
        ],
      },
    ],
    [
      CourseLessonSectionType.EXAMPLE,
      'Ví dụ có hướng dẫn',
      {
        examples: [
          {
            label: 'Mẫu câu',
            text: `Could we discuss ${topic} after the meeting?`,
          },
          {
            label: 'Phân tích',
            text: `Câu mẫu dùng ngôn ngữ lịch sự để đưa ${topic} vào một tình huống cụ thể.`,
          },
          { label: 'Biến thể', text: `I need a quick update about ${topic}.` },
        ],
        paragraphs: [
          'Đọc cả ba ví dụ và thay một danh từ bằng thông tin thật của bạn.',
        ],
      },
    ],
    [
      CourseLessonSectionType.STRATEGY,
      'Chiến lược thực hiện',
      {
        bullets:
          focus === 'LISTENING'
            ? [
                'Đọc câu hỏi trước khi nghe.',
                'Nghe lần đầu để nắm ý, lần hai để bắt chi tiết.',
                'Ghi lại từ đồng nghĩa nghe được.',
              ]
            : focus === 'READING'
              ? [
                  'Đọc tiêu đề và câu hỏi trước.',
                  'Tìm bằng chứng trong đúng đoạn văn.',
                  'Loại đáp án trái với dữ kiện.',
                ]
              : focus === 'WRITING'
                ? [
                    'Lập dàn ý ba phần.',
                    'Dùng một câu chủ đề rõ ràng.',
                    'Kiểm tra người nhận, mục đích và lời kết.',
                  ]
                : focus === 'SPEAKING' || focus === 'PRONUNCIATION'
                  ? [
                      'Chuẩn bị từ khóa, không học thuộc cả đoạn.',
                      'Nói chậm hơn ở từ khóa.',
                      'Tự nghe lại và ghi một điểm cần sửa.',
                    ]
                  : [
                      'Đọc ví dụ trước khi áp dụng quy tắc.',
                      'So sánh hai câu gần nghĩa.',
                      'Sửa lỗi bằng lý do, không chỉ bằng đáp án.',
                    ],
        paragraphs: [
          'Nếu làm sai, hãy ghi nguyên nhân vào một câu; đó là phần phản hồi quan trọng hơn điểm số.',
        ],
      },
    ],
    [
      CourseLessonSectionType.CHECKPOINT,
      'Tự kiểm tra trước khi nộp',
      {
        bullets: [
          'Tôi đã hiểu mục tiêu của bài chưa?',
          'Tôi có bằng chứng cho lựa chọn của mình chưa?',
          'Tôi có thể dùng lại mẫu câu trong tình huống mới chưa?',
        ],
        paragraphs: [
          'Hoàn thành bài tập bên dưới, sau đó đọc giải thích cho từng câu.',
        ],
      },
    ],
    [
      CourseLessonSectionType.SUMMARY,
      'Tổng kết và chuyển giao',
      {
        paragraphs: [
          `Bạn đã luyện ${label} qua “${topic}”. Hãy tạo một ví dụ mới gắn với công việc hoặc đời sống của bạn để chuyển kiến thức sang trí nhớ dài hạn.`,
        ],
        bullets: [
          `Từ khóa: ${topic}.`,
          `Bước tiếp theo: áp dụng vào một nhiệm vụ tương tự trong bài kế tiếp.`,
        ],
      },
    ],
  ] as const;
}

type QuestionSeed = {
  prompt: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
};

function contextualizeQuestions(
  questions: QuestionSeed[],
  topic: string,
): QuestionSeed[] {
  return questions.map((question) => ({
    ...question,
    prompt: `In this lesson on ${topic}, ${question.prompt.charAt(0).toLowerCase()}${question.prompt.slice(1)}`,
  }));
}

function questionsFor(
  focus: Focus,
  topic: string,
  courseId: number,
  order: number,
): QuestionSeed[] {
  const context = `${topic} in lesson ${order}`;
  if (focus === 'LISTENING') {
    return [
      {
        prompt: `What is the main purpose of the message about ${topic}?`,
        options: [
          'To confirm an action',
          'To cancel a service',
          'To sell a product',
          'To complain about a delay',
        ],
        correctAnswer: 'To confirm an action',
        explanation: 'The message confirms the next action in the situation.',
      },
      {
        prompt: `Which detail should the listener note in ${context}?`,
        options: [
          'The time or deadline',
          'The speaker’s home address',
          'A private password',
          'A historical date',
        ],
        correctAnswer: 'The time or deadline',
        explanation:
          'A time or deadline is the actionable detail in this listening task.',
      },
      {
        prompt: 'Choose the paraphrase closest to “Could we discuss it later?”',
        options: [
          'Can we talk about it at another time?',
          'We must finish it now.',
          'We discussed it yesterday.',
          'Nobody can discuss it.',
        ],
        correctAnswer: 'Can we talk about it at another time?',
        explanation: 'The paraphrase keeps the request and its future timing.',
      },
      {
        prompt: 'What should you listen for on a second play?',
        options: [
          'A keyword that supports the answer',
          'Every unrelated background sound',
          'The speaker’s accent only',
          'A new topic not in the question',
        ],
        correctAnswer: 'A keyword that supports the answer',
        explanation:
          'A second play should confirm evidence for the selected answer.',
      },
      {
        prompt: 'Write one keyword you expect to hear.',
        correctAnswer: topic.split(' ')[0],
        explanation: 'A keyword links the listening purpose to the topic.',
      },
    ];
  }
  if (focus === 'READING') {
    return [
      {
        prompt: `Read the notice: “The ${topic} session starts at 9:00. Please bring your ID.” What should readers bring?`,
        options: [
          'Their ID',
          'A dictionary',
          'A laptop charger',
          'A lunch box',
        ],
        correctAnswer: 'Their ID',
        explanation: 'The second sentence gives the required item.',
      },
      {
        prompt: 'What is the purpose of the notice?',
        options: [
          'To give practical instructions',
          'To tell a personal story',
          'To advertise a holiday',
          'To report a weather event',
        ],
        correctAnswer: 'To give practical instructions',
        explanation: 'The notice gives a start time and a required item.',
      },
      {
        prompt: 'Which word in the notice signals obligation?',
        options: ['please', 'session', 'starts', 'bring'],
        correctAnswer: 'please',
        explanation: '“Please” introduces the instruction politely.',
      },
      {
        prompt: 'Which evidence supports the answer?',
        options: [
          'The sentence about bringing an ID',
          'The title of another article',
          'A date from last year',
          'A personal guess',
        ],
        correctAnswer: 'The sentence about bringing an ID',
        explanation: 'Good reading answers cite the relevant sentence.',
      },
      {
        prompt: 'Write a two-word summary of the notice.',
        correctAnswer: 'practical instructions',
        explanation:
          'The summary captures the notice purpose without adding information.',
      },
    ];
  }
  if (focus === 'WRITING') {
    return [
      {
        prompt: 'Which opening is clearest for a short workplace message?',
        options: [
          'I am writing to confirm the new schedule.',
          'Hey thing!',
          'Maybe you know.',
          'This is about stuff.',
        ],
        correctAnswer: 'I am writing to confirm the new schedule.',
        explanation: 'The opening states purpose and topic immediately.',
      },
      {
        prompt: 'Which detail makes the message actionable?',
        options: [
          'a date and requested action',
          'an unrelated opinion',
          'a long greeting only',
          'a copied slogan',
        ],
        correctAnswer: 'a date and requested action',
        explanation: 'The reader needs to know when and what to do.',
      },
      {
        prompt: 'Choose the most appropriate closing.',
        options: ['Best regards,', 'See ya maybe', 'No ending', 'Whatever'],
        correctAnswer: 'Best regards,',
        explanation:
          'This closing is concise and suitable for a workplace message.',
      },
      {
        prompt: 'Write one sentence that asks politely about the topic.',
        correctAnswer: `Could you please confirm ${topic}?`,
        explanation: 'A polite request uses could/can plus a clear action.',
      },
    ];
  }
  if (focus === 'SPEAKING' || focus === 'PRONUNCIATION') {
    return [
      {
        prompt: 'Choose the best phrase to begin a clear response.',
        options: [
          'In my view,',
          'What thing?',
          'No idea maybe.',
          'You know stuff.',
        ],
        correctAnswer: 'In my view,',
        explanation: 'The phrase signals the start of an organised response.',
      },
      {
        prompt: 'Which delivery choice improves intelligibility?',
        options: [
          'Stress the key words and pause briefly',
          'Speak faster than normal',
          'Drop the final sounds',
          'Read without pauses',
        ],
        correctAnswer: 'Stress the key words and pause briefly',
        explanation:
          'Key-word stress and short pauses help the listener follow the message.',
      },
      {
        prompt: `Record or practise a 20-second response about ${topic}.`,
        correctAnswer: `In my view, ${topic} is useful because it helps the team.`,
        explanation: 'A strong response has a clear position and one reason.',
      },
      {
        prompt: 'Write one word you will stress in your response.',
        correctAnswer: topic.split(' ')[0],
        explanation:
          'Choosing a content word gives the response a clear focus.',
      },
    ];
  }
  if (focus === 'VOCABULARY') {
    return [
      {
        prompt: `Which collocation is natural with “${topic}”?`,
        options: [
          'make a decision',
          'do a decision',
          'take a decisioning',
          'create a decide',
        ],
        correctAnswer: 'make a decision',
        explanation: '“Make a decision” is the standard collocation.',
      },
      {
        prompt: 'Which word is closest in meaning to “useful”?',
        options: ['helpful', 'broken', 'empty', 'late'],
        correctAnswer: 'helpful',
        explanation: 'Helpful means useful in context.',
      },
      {
        prompt: 'Which sentence uses a professional register?',
        options: [
          `We need an update on ${topic}.`,
          'Give me that thing.',
          'Stuff is weird.',
          'Whatever about it.',
        ],
        correctAnswer: `We need an update on ${topic}.`,
        explanation: 'The sentence is direct, specific and suitable for work.',
      },
      {
        prompt: 'Write one new phrase you can use with this topic.',
        correctAnswer: `an update on ${topic}`,
        explanation:
          'A reusable phrase is more useful than an isolated translation.',
      },
      {
        prompt: 'Which word family member is a noun?',
        options: ['decision', 'decide', 'decisive', 'decisively'],
        correctAnswer: 'decision',
        explanation: 'Decision names the thing or result.',
      },
    ];
  }
  if (courseId === 8 || focus === 'GRAMMAR') {
    return [
      {
        prompt: 'Choose the correct form: “She ___ the report every Friday.”',
        options: ['checks', 'check', 'checking', 'checked'],
        correctAnswer: 'checks',
        explanation: 'Present simple takes -s with third-person singular she.',
      },
      {
        prompt: 'Which sentence is negative?',
        options: [
          'They do not attend on Mondays.',
          'They attend on Mondays.',
          'Do they attend on Mondays?',
          'Attending on Mondays.',
        ],
        correctAnswer: 'They do not attend on Mondays.',
        explanation: 'Do not makes the present-simple statement negative.',
      },
      {
        prompt: 'Which question form is correct?',
        options: [
          'Where does the meeting start?',
          'Where the meeting does start?',
          'Where start the meeting?',
          'Does where the meeting start?',
        ],
        correctAnswer: 'Where does the meeting start?',
        explanation:
          'Wh-word + auxiliary + subject + base verb forms the question.',
      },
      {
        prompt: 'Correct the sentence: “He work in sales.”',
        correctAnswer: 'He works in sales.',
        explanation: 'The verb agrees with third-person singular he.',
      },
      {
        prompt: 'Write a new sentence using the target form.',
        correctAnswer: 'The team checks the schedule every morning.',
        explanation: 'A new contextual sentence demonstrates transfer.',
      },
    ];
  }
  return [
    {
      prompt: `What is the most appropriate action for ${topic}?`,
      options: [
        'Confirm the next step',
        'Ignore the request',
        'Change the subject',
        'Delete the message',
      ],
      correctAnswer: 'Confirm the next step',
      explanation: 'Confirming the next step keeps the interaction purposeful.',
    },
    {
      prompt: 'Which phrase is the most precise?',
      options: [
        'Could you clarify the deadline?',
        'Tell me stuff.',
        'It is whatever.',
        'Do it somehow.',
      ],
      correctAnswer: 'Could you clarify the deadline?',
      explanation: 'The phrase asks for one specific piece of information.',
    },
    {
      prompt: 'Which response shows acknowledgement?',
      options: [
        'Thanks, I understand.',
        'No topic.',
        'Maybe never.',
        'What is this?',
      ],
      correctAnswer: 'Thanks, I understand.',
      explanation: 'This response explicitly acknowledges the information.',
    },
    {
      prompt: 'Write one sentence that transfers the skill to a new situation.',
      correctAnswer: `I can apply this strategy to ${topic}.`,
      explanation: 'Transfer connects practice to a new, realistic situation.',
    },
  ];
}

function exerciseSeeds(
  plan: CoursePlan,
  topic: string,
  focus: Focus,
  order: number,
  courseId: number,
) {
  const primaryType =
    focus === 'LISTENING'
      ? CourseLessonExerciseType.LISTENING_COMPREHENSION
      : focus === 'READING'
        ? CourseLessonExerciseType.READING_COMPREHENSION
        : focus === 'SPEAKING'
          ? CourseLessonExerciseType.SPEAKING_SHORT_RESPONSE
          : focus === 'PRONUNCIATION'
            ? CourseLessonExerciseType.SPEAKING_READ_ALOUD
            : focus === 'WRITING'
              ? CourseLessonExerciseType.WRITING_GUIDED
              : focus === 'GRAMMAR'
                ? CourseLessonExerciseType.FILL_IN_THE_BLANK
                : CourseLessonExerciseType.VOCABULARY;
  const primaryQuestions = contextualizeQuestions(
    questionsFor(focus, topic, courseId, order),
    topic,
  );
  const checkpointQuestions = contextualizeQuestions(
    questionsFor(
      focus === 'GRAMMAR'
        ? 'VOCABULARY'
        : focus === 'VOCABULARY'
          ? 'GRAMMAR'
          : focus,
      `${topic} checkpoint`,
      courseId,
      order,
    ),
    `${topic} checkpoint`,
  )
    .slice(0, 4)
    .map((question) => ({
      ...question,
      prompt: `In the new context, ${question.prompt.charAt(0).toLowerCase()}${question.prompt.slice(1)}`,
    }));
  const primaryContent: Record<string, unknown> = {
    skill: focus,
    topic,
    courseTheme: plan.theme,
    practiceBlock: 'Guided practice',
    feedbackPolicy: 'Review each explanation after submission.',
  };
  if (focus === 'LISTENING') {
    primaryContent.preListening =
      'Read the purpose and predict one keyword before playing.';
    primaryContent.transcriptPolicy =
      'Transcript is available in the explanation after submission.';
  }
  if (focus === 'READING') {
    primaryContent.passage = `Notice: The ${topic} session starts at 9:00. Please bring your ID and arrive ten minutes early.`;
    primaryContent.passageSource = 'Original BreadTrans course text';
  }
  if (focus === 'SPEAKING' || focus === 'PRONUNCIATION') {
    primaryContent.recordingTask = `Prepare and record a 20-second response about ${topic}.`;
    primaryContent.usefulLanguage = [
      'In my view, ...',
      'For example, ...',
      'Could you clarify ...?',
    ];
  }
  if (focus === 'WRITING') {
    primaryContent.modelStructure = [
      'Greeting',
      'Purpose sentence',
      'Action or detail',
      'Professional closing',
    ];
    primaryContent.rubric = [
      'clear purpose',
      'relevant detail',
      'appropriate register',
    ];
  }
  if (focus === 'GRAMMAR') {
    primaryContent.rule = 'Subject and verb must agree in the selected tense.';
    primaryContent.contrast = ['She checks the file.', 'They check the file.'];
    primaryContent.commonErrors = [
      'forgetting -s after he/she/it',
      'using a past form with every day',
    ];
  }
  if (focus === 'VOCABULARY') {
    primaryContent.targetWords = [topic, 'update', 'deadline', 'confirm'];
    primaryContent.collocations = [
      'make a decision',
      'meet a deadline',
      'confirm an update',
    ];
    primaryContent.usageNote =
      'Choose a phrase that fits the relationship and register.';
  }
  type ExerciseSeed = {
    slug: string;
    type: CourseLessonExerciseType;
    title: string;
    prompt: string;
    instructions: string;
    content: Prisma.InputJsonValue;
    rubric: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    required: boolean;
    questions: QuestionSeed[];
  };
  return [
    {
      // Keep the V5 primary slug stable so existing exercise IDs/attempts stay valid.
      slug: `practice-${focus.toLowerCase()}`,
      type: primaryType,
      title: `Guided practice: ${topic}`,
      prompt: `Apply ${focusLabel(focus)} to the ${topic} scenario.`,
      instructions:
        'Work through the examples first. Submit all responses to receive question-level feedback.',
      content: primaryContent as Prisma.InputJsonObject,
      rubric:
        focus === 'WRITING' || focus === 'SPEAKING'
          ? { criteria: ['purpose', 'clarity', 'language control'] }
          : Prisma.JsonNull,
      required:
        courseId === 5 && (focus === 'WRITING' || focus === 'SPEAKING')
          ? true
          : focus !== 'WRITING' &&
            focus !== 'SPEAKING' &&
            focus !== 'PRONUNCIATION',
      questions: primaryQuestions,
    },
    {
      slug: `checkpoint-${focus.toLowerCase()}-${order}`,
      type: CourseLessonExerciseType.CHECKPOINT,
      title: `Checkpoint: transfer ${topic}`,
      prompt: 'Use the target skill in a new context and explain your choice.',
      instructions:
        'This checkpoint is the required completion task for the lesson.',
      content: {
        skill: focus,
        practiceBlock: 'Main practice / checkpoint',
        newContext: `A new situation related to ${topic}.`,
      },
      rubric: Prisma.JsonNull,
      required: true,
      questions: checkpointQuestions,
    },
  ] satisfies ExerciseSeed[];
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const totals = {
    lessons: 0,
    sections: 0,
    exercises: 0,
    questions: 0,
    references: 0,
    media: 0,
  };
  const coverage: Array<Record<string, unknown>> = [];
  for (let courseId = 1; courseId <= 8; courseId += 1) {
    const plan = coursePlans[courseId];
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });
    if (!course || !plan) continue;
    let courseExercises = 0;
    let courseQuestions = 0;
    for (let order = 1; order <= 8; order += 1) {
      const focus = plan.focus[order - 1];
      const topic = plan.topics[order - 1];
      const lesson = await prisma.courseLesson.upsert({
        where: { courseId_order: { courseId, order } },
        update: {
          title: `Lesson ${order}: ${topic}`,
          summary: `${plan.theme}: ${topic}. Học qua lý thuyết, ví dụ có hướng dẫn và thực hành theo ngữ cảnh.`,
          learningObjectives: [
            `Hiểu mục tiêu và tín hiệu ngôn ngữ của ${topic}.`,
            `Thực hành ${focusLabel(focus)} qua ít nhất hai khối nhiệm vụ.`,
            'Tự giải thích lựa chọn và chuyển giao sang tình huống mới.',
          ],
          estimatedMinutes: 25 + order * 2,
          difficulty: plan.level,
          status: CourseLessonStatus.PUBLISHED,
        },
        create: {
          courseId,
          slug: `course-${courseId}-lesson-${order}`,
          title: `Lesson ${order}: ${topic}`,
          summary: `${plan.theme}: ${topic}. Học qua lý thuyết, ví dụ có hướng dẫn và thực hành theo ngữ cảnh.`,
          learningObjectives: [
            `Hiểu mục tiêu và tín hiệu ngôn ngữ của ${topic}.`,
            `Thực hành ${focusLabel(focus)} qua ít nhất hai khối nhiệm vụ.`,
            'Tự giải thích lựa chọn và chuyển giao sang tình huống mới.',
          ],
          estimatedMinutes: 25 + order * 2,
          difficulty: plan.level,
          order,
          status: CourseLessonStatus.PUBLISHED,
        },
      });
      totals.lessons += 1;
      for (const [index, [type, heading, content]] of sectionRows(
        plan,
        topic,
        focus,
        order,
      ).entries()) {
        await prisma.courseLessonSection.upsert({
          where: { lessonId_order: { lessonId: lesson.id, order: index + 1 } },
          update: { type, heading, content },
          create: {
            lessonId: lesson.id,
            order: index + 1,
            type,
            heading,
            content,
          },
        });
        totals.sections += 1;
      }
      for (const [index, seed] of exerciseSeeds(
        plan,
        topic,
        focus,
        order,
        courseId,
      ).entries()) {
        const slugMatch = await prisma.courseLessonExercise.findUnique({
          where: { lessonId_slug: { lessonId: lesson.id, slug: seed.slug } },
          select: { id: true, order: true },
        });
        const legacyPrimary =
          !slugMatch && index === 0
            ? await prisma.courseLessonExercise.findFirst({
                where: { lessonId: lesson.id, order: 1 },
                select: { id: true, order: true },
              })
            : null;
        const existing = slugMatch ?? legacyPrimary;
        const usedOrders = existing
          ? []
          : await prisma.courseLessonExercise.findMany({
              where: { lessonId: lesson.id },
              select: { order: true },
            });
        const exerciseOrder =
          existing?.order ??
          Math.max(index + 1, ...usedOrders.map((item) => item.order + 1));
        const exercise = existing
          ? await prisma.courseLessonExercise.update({
              where: { id: existing.id },
              data: {
                order: exerciseOrder,
                slug: seed.slug,
                type: seed.type,
                title: seed.title,
                prompt: seed.prompt,
                instructions: seed.instructions,
                content: seed.content,
                rubric: seed.rubric,
                required: seed.required,
              },
            })
          : await prisma.courseLessonExercise.create({
              data: {
                lessonId: lesson.id,
                slug: seed.slug,
                order: exerciseOrder,
                type: seed.type,
                title: seed.title,
                prompt: seed.prompt,
                instructions: seed.instructions,
                content: seed.content,
                rubric: seed.rubric,
                required: seed.required,
              },
            });
        totals.exercises += 1;
        courseExercises += 1;
        for (const [questionIndex, question] of seed.questions.entries()) {
          await prisma.courseLessonQuestion.upsert({
            where: {
              exerciseId_order: {
                exerciseId: exercise.id,
                order: questionIndex + 1,
              },
            },
            update: {
              prompt: question.prompt,
              options: question.options ?? Prisma.JsonNull,
              correctAnswer: question.correctAnswer,
              explanation: question.explanation,
            },
            create: {
              exerciseId: exercise.id,
              order: questionIndex + 1,
              prompt: question.prompt,
              options: question.options ?? Prisma.JsonNull,
              correctAnswer: question.correctAnswer,
              explanation: question.explanation,
            },
          });
          totals.questions += 1;
          courseQuestions += 1;
        }
      }
      // Remove only stale V5 template exercises left by earlier materializer runs.
      // Rows with attempts are never touched; they remain historical content.
      const allowedSlugs = exerciseSeeds(
        plan,
        topic,
        focus,
        order,
        courseId,
      ).map((seed) => seed.slug);
      const stale = await prisma.courseLessonExercise.findMany({
        where: {
          lessonId: lesson.id,
          slug: { notIn: allowedSlugs },
          attempts: { none: {} },
          OR: [
            { title: { startsWith: 'Practice:' } },
            { title: { startsWith: 'Guided practice:' } },
            { title: { startsWith: 'Checkpoint:' } },
          ],
        },
        select: { id: true },
      });
      if (stale.length) {
        const staleIds = stale.map((item) => item.id);
        await prisma.courseLessonQuestion.deleteMany({
          where: { exerciseId: { in: staleIds } },
        });
        await prisma.courseLessonExercise.deleteMany({
          where: { id: { in: staleIds } },
        });
      }
      // Normalise order after cleanup without colliding with the unique order key.
      const currentExercises = await prisma.courseLessonExercise.findMany({
        where: { lessonId: lesson.id, slug: { in: allowedSlugs } },
        select: { id: true, slug: true },
      });
      for (const item of currentExercises)
        await prisma.courseLessonExercise.update({
          where: { id: item.id },
          data: { order: -item.id },
        });
      for (const [index, slug] of allowedSlugs.entries()) {
        const item = currentExercises.find(
          (candidate) => candidate.slug === slug,
        );
        if (item)
          await prisma.courseLessonExercise.update({
            where: { id: item.id },
            data: { order: index + 1 },
          });
      }
      const referenceId = courseId * 1000 + order;
      await prisma.courseLessonReference.upsert({
        where: { id: referenceId },
        update: {
          lessonId: lesson.id,
          title: `${plan.reference.title}: ${topic}`,
          publisher: plan.reference.publisher,
          url: plan.reference.url,
          note: 'Đọc thêm để củng cố đúng chủ đề bài học; nội dung bài là bản gốc của BreadTrans.',
        },
        create: {
          id: referenceId,
          lessonId: lesson.id,
          title: `${plan.reference.title}: ${topic}`,
          publisher: plan.reference.publisher,
          url: plan.reference.url,
          note: 'Đọc thêm để củng cố đúng chủ đề bài học; nội dung bài là bản gốc của BreadTrans.',
        },
      });
      totals.references += 1;
      const needsImage =
        ['READING', 'GRAMMAR', 'VOCABULARY'].includes(focus) || courseId === 7;
      if (needsImage) {
        const mediaId = courseId * 1000 + order;
        await prisma.courseLessonMedia.upsert({
          where: { id: mediaId },
          update: {
            lessonId: lesson.id,
            type: 'IMAGE',
            url: courseMedia[courseId],
            altText: `${topic} — ${plan.theme}`,
            provenance: 'BreadTrans local course asset',
            renderStatus: 'READY',
          },
          create: {
            id: mediaId,
            lessonId: lesson.id,
            type: 'IMAGE',
            url: courseMedia[courseId],
            altText: `${topic} — ${plan.theme}`,
            provenance: 'BreadTrans local course asset',
            renderStatus: 'READY',
          },
        });
        totals.media += 1;
      }
      // Listening audio is owned by the Course-specific authoring pipeline.
      // The base content materializer must never reintroduce a generic asset.
    }
    coverage.push({
      courseId,
      title: course.title,
      lessonCount: 8,
      exerciseCount: courseExercises,
      questionCount: courseQuestions,
      focus: plan.focus,
      theme: plan.theme,
    });
  }
  await writeFile(
    join(artifactDir, 'course-5-1-materialization.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), ...totals, courses: coverage },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ...totals, courses: coverage }, null, 2));
}

void main().finally(() => prisma.$disconnect());
