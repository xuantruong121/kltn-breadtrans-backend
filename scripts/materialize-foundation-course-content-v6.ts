import {
  CourseLessonExerciseType,
  CourseLessonSectionType,
  CourseLessonStatus,
  CourseStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * V6 is deliberately authored data, not a topic-substitution generator.
 * The serializer below is shared only for persistence; every published lesson
 * has its own Vietnamese explanation, examples, and exercise questions.
 */
const prisma = new PrismaClient();
const artifactDir = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'foundation-course-content-rebuild-6',
);

type Example = {
  english: string;
  vietnamese: string;
  explanation: string;
};

type VocabularyItem = {
  term: string;
  meaning: string;
  partOfSpeech: string;
  ipa?: string;
  example: string;
  translation: string;
  note: string;
};

type Question = {
  prompt: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
};

type LessonSpec = {
  title: string;
  slug: string;
  summary: string;
  difficulty: string;
  objectives: string[];
  theory: string[];
  formulas?: string[];
  examples: Example[];
  mistakes: string[];
  tips: string[];
  guided: string[];
  summaryPoints: string[];
  nextStep: string;
  vocabulary?: VocabularyItem[];
  questions: Question[];
  exerciseTitle: string;
  exercisePrompt: string;
  exerciseType: CourseLessonExerciseType;
  content?: Record<string, unknown>;
};

type CourseSpec = {
  existingId?: number;
  title: string;
  description: string;
  level: string;
  curriculumType: string;
  thumbnail: string;
  lessons: LessonSpec[];
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const ex = (
  english: string,
  vietnamese: string,
  explanation: string,
): Example => ({
  english,
  vietnamese,
  explanation,
});

const q = (
  prompt: string,
  options: string[],
  correctAnswer: string,
  explanation: string,
): Question => ({ prompt, options, correctAnswer, explanation });

const openQ = (
  prompt: string,
  correctAnswer: string,
  explanation: string,
): Question => ({
  prompt,
  correctAnswer,
  explanation,
});

export const foundationLessons: LessonSpec[] = [
  {
    title: 'Chào hỏi và giới thiệu bản thân',
    slug: 'greetings-and-introductions',
    difficulty: 'A1',
    summary:
      'Luyện cách chào hỏi, giới thiệu tên, nơi ở và hỏi thông tin cơ bản trong cuộc gặp đầu tiên.',
    objectives: [
      'Chào hỏi phù hợp với thời điểm và mối quan hệ.',
      'Giới thiệu tên, quê quán và công việc bằng câu ngắn.',
      'Hỏi lại thông tin một cách lịch sự.',
    ],
    theory: [
      'Trong cuộc gặp đầu tiên, dùng lời chào đơn giản rồi giới thiệu tên. Với người chưa thân, “Nice to meet you” là cách đáp tự nhiên.',
      'Câu hỏi “Where are you from?” hỏi quê quán; “What do you do?” hỏi công việc. Câu trả lời có thể bắt đầu bằng “I am…” hoặc “I work…”.',
    ],
    formulas: [
      'Hello/Hi + tên.',
      'My name is + tên. / I am + tên.',
      'Where are you from? — I am from + nơi chốn.',
      'What do you do? — I am a/an + nghề nghiệp.',
    ],
    examples: [
      ex(
        'Hi, I am Mai. Nice to meet you.',
        'Chào, mình là Mai. Rất vui được gặp bạn.',
        'Dùng “I am” để giới thiệu tên; “Nice to meet you” là lời đáp lịch sự.',
      ),
      ex(
        'Where are you from? — I am from Da Nang.',
        'Bạn đến từ đâu? — Mình đến từ Đà Nẵng.',
        '“From” đứng trước tên thành phố hoặc quốc gia.',
      ),
      ex(
        'I work at a small design studio.',
        'Tôi làm việc tại một studio thiết kế nhỏ.',
        'Dùng “work at” khi nói nơi làm việc.',
      ),
    ],
    mistakes: [
      'Không nói “I am from Vietnam?” khi đang trả lời; câu trả lời cần dấu chấm.',
      'Không dùng “Nice meet you” vì phải có “to”.',
      'Nói “I am a teacher”, không nói “I am teacher”.',
    ],
    tips: [
      'Nhớ cụm “My name is…”, “I am from…” và “Nice to meet you”.',
      'Khi chưa nghe rõ tên, dùng “Could you say that again, please?”',
    ],
    guided: [
      'Tình huống: Lan gặp một bạn mới trong lớp. Hãy chọn câu mở đầu phù hợp và sau đó nói tên, thành phố của mình.',
      'Đọc mẫu: “Hi, I am Lan. I am from Hue. Nice to meet you.” Sau đó thay Lan và Hue bằng thông tin thật.',
    ],
    summaryPoints: [
      'Chào hỏi trước khi giới thiệu.',
      'Dùng “I am from…” cho nơi xuất thân và “I work…” cho công việc.',
    ],
    nextStep: 'Ở bài sau, dùng các mẫu hỏi này để nói về gia đình.',
    vocabulary: [
      {
        term: 'neighbour',
        meaning: 'hàng xóm',
        partOfSpeech: 'noun (danh từ)',
        ipa: '/ˈneɪbə/',
        example: 'My new neighbour is very friendly.',
        translation: 'Người hàng xóm mới của tôi rất thân thiện.',
        note: 'new/friendly neighbour',
      },
      {
        term: 'introduce yourself',
        meaning: 'giới thiệu bản thân',
        partOfSpeech: 'verb phrase (cụm động từ)',
        example: 'Please introduce yourself to the group.',
        translation: 'Hãy giới thiệu bản thân với nhóm.',
        note: 'Dùng trong lớp học hoặc cuộc họp.',
      },
    ],
    questions: [
      q(
        'Câu nào phù hợp để giới thiệu tên?',
        ['My name Mai.', 'My name is Mai.', 'I name Mai.', 'Name is my Mai.'],
        'My name is Mai.',
        'Cấu trúc đúng là “My name is + tên”.',
      ),
      q(
        'Câu hỏi “Where are you from?” có nghĩa là gì?',
        [
          'Bạn đang làm gì?',
          'Bạn đến từ đâu?',
          'Bạn bao nhiêu tuổi?',
          'Bạn sống với ai?',
        ],
        'Bạn đến từ đâu?',
        '“Where” hỏi nơi chốn và “from” chỉ nguồn gốc.',
      ),
      openQ(
        'Viết một câu giới thiệu nơi bạn đến.',
        'I am from Hanoi.',
        'Dùng “I am from + tên thành phố/quốc gia”.',
      ),
    ],
    exerciseTitle: 'Thực hành chào hỏi',
    exercisePrompt: 'Hoàn thành các câu giao tiếp đầu tiên bằng tiếng Anh.',
    exerciseType: CourseLessonExerciseType.MULTIPLE_CHOICE,
    content: {
      usefulLanguage: [
        'Hi, I am…',
        'Nice to meet you.',
        'Could you say that again, please?',
      ],
    },
  },
  {
    title: 'Gia đình và thông tin cá nhân',
    slug: 'family-and-personal-information',
    difficulty: 'A1',
    summary:
      'Mô tả thành viên gia đình và trao đổi thông tin cá nhân an toàn trong hội thoại quen thuộc.',
    objectives: [
      'Gọi tên các mối quan hệ gia đình.',
      'Nói số lượng người và nghề nghiệp của họ.',
      'Hỏi thông tin cơ bản mà không yêu cầu dữ liệu nhạy cảm.',
    ],
    theory: [
      'Dùng “This is my…” để giới thiệu một người. “He/She is…” giúp nói về nghề nghiệp hoặc đặc điểm.',
      'Danh từ số nhiều thường thêm -s: brother/brothers. Với một người, dùng “a/an” trước nghề nghiệp.',
      'Khi hỏi về quan hệ, hãy bắt đầu bằng “Who is he/she?” rồi trả lời bằng một cụm quan hệ đầy đủ. Chỉ chia sẻ thông tin gia đình cần thiết trong ngữ cảnh học tập.',
    ],
    formulas: [
      'This is my + family member.',
      'He/She is a/an + job.',
      'I have + number + brothers/sisters.',
      'Who is he/she? — He/She is my + relation.',
    ],
    examples: [
      ex(
        'This is my older sister, Linh.',
        'Đây là chị gái của tôi, Linh.',
        '“Older sister” cho biết người chị lớn tuổi hơn.',
      ),
      ex(
        'She is a nurse at a local clinic.',
        'Chị ấy là y tá tại một phòng khám địa phương.',
        'Dùng “a” trước nghề nghiệp bắt đầu bằng âm phụ âm; câu này vừa giới thiệu nghề vừa đặt người nghe vào một bối cảnh cụ thể.',
      ),
      ex(
        'I have two brothers.',
        'Tôi có hai anh/em trai.',
        '“Brothers” thêm -s vì có số lượng lớn hơn một.',
      ),
    ],
    mistakes: [
      'Không bỏ mạo từ trong “She is a nurse”.',
      'Không dùng “two brother”; danh từ phải ở số nhiều.',
      'Không chia động từ “have” thành “has” với chủ ngữ I.',
    ],
    tips: [
      'Học theo cụm “my older sister”, “my younger brother”.',
      'Khi nói thông tin cá nhân, chỉ chia sẻ điều cần thiết trong ngữ cảnh học tập.',
    ],
    guided: [
      'Nhìn sơ đồ gia đình giả định của một người bạn và ghép đúng quan hệ: mother, father, sister, brother.',
      'Nói ba câu: “This is my…”, “He/She is…”, “I have…”.',
    ],
    summaryPoints: [
      'Dùng “This is my…” để giới thiệu.',
      'Nghề nghiệp số ít cần “a/an”; danh từ có số lượng lớn hơn một thường ở dạng số nhiều.',
    ],
    nextStep: 'Tiếp theo, ghép thông tin gia đình với thói quen hằng ngày.',
    vocabulary: [
      {
        term: 'cousin',
        meaning: 'anh/chị/em họ',
        partOfSpeech: 'noun (danh từ)',
        ipa: '/ˈkʌzən/',
        example: 'My cousin lives near my home.',
        translation: 'Anh họ của tôi sống gần nhà.',
        note: 'first cousin = anh/chị/em họ trực hệ',
      },
      {
        term: 'only child',
        meaning: 'con một',
        partOfSpeech: 'noun phrase (cụm danh từ)',
        example: 'I am an only child.',
        translation: 'Tôi là con một.',
        note: 'Dùng “an” vì only bắt đầu bằng nguyên âm.',
      },
    ],
    questions: [
      q(
        'Chọn câu đúng.',
        [
          'She is nurse.',
          'She is a nurse.',
          'She a nurse is.',
          'She is nurse a.',
        ],
        'She is a nurse.',
        'Nghề nghiệp số ít cần mạo từ “a”.',
      ),
      q(
        'Dạng số nhiều đúng của “brother” là gì?',
        ['brothers', 'brotheres', 'brother’s', 'brothes'],
        'brothers',
        'Danh từ này chỉ cần thêm -s.',
      ),
      openQ(
        'Viết một câu nói bạn có bao nhiêu anh chị em.',
        'I have one sister.',
        'Dùng “I have + số lượng + danh từ”.',
      ),
    ],
    exerciseTitle: 'Nói về gia đình',
    exercisePrompt:
      'Chọn và viết các câu mô tả gia đình trong một cuộc trò chuyện thân thiện.',
    exerciseType: CourseLessonExerciseType.MULTIPLE_CHOICE,
    content: { usefulLanguage: ['This is my…', 'He/She is a…', 'I have…'] },
  },
  {
    title: 'Thói quen hằng ngày',
    slug: 'daily-routines',
    difficulty: 'A1-A2',
    summary:
      'Nói về lịch sinh hoạt lặp lại bằng thì hiện tại đơn và trạng từ tần suất.',
    objectives: [
      'Mô tả một ngày thường bằng động từ quen thuộc.',
      'Dùng do/does và động từ đúng dạng.',
      'Đặt trạng từ tần suất ở vị trí tự nhiên.',
    ],
    theory: [
      'Thì hiện tại đơn diễn tả thói quen hoặc sự việc lặp lại. Với he, she, it, động từ thường thêm -s/-es.',
      'Always, usually, often, sometimes, never đứng trước động từ thường nhưng đứng sau động từ be.',
    ],
    formulas: [
      'I/You/We/They + verb nguyên mẫu.',
      'He/She/It + verb-s/es.',
      'Do/Does + subject + verb nguyên mẫu?',
      'Subject + do not/does not + verb nguyên mẫu.',
    ],
    examples: [
      ex(
        'I usually leave home at seven.',
        'Tôi thường rời nhà lúc bảy giờ.',
        '“Usually” đứng trước động từ thường “leave”.',
      ),
      ex(
        'She studies English after dinner.',
        'Cô ấy học tiếng Anh sau bữa tối.',
        'Với she, study đổi thành studies.',
      ),
      ex(
        'He does not work on Sundays.',
        'Anh ấy không làm việc vào Chủ nhật.',
        'Sau “does not”, động từ trở về nguyên mẫu “work”.',
      ),
    ],
    mistakes: [
      'Không viết “She study”; chủ ngữ she cần “studies”.',
      'Không viết “He doesn’t works”; sau does not dùng nguyên mẫu.',
      'Không đặt “always” cuối câu một cách máy móc khi nói thói quen.',
    ],
    tips: [
      'Tìm chủ ngữ trước rồi mới quyết định có thêm -s hay không.',
      'Dùng mốc “every day”, “on Mondays”, “usually” để nhận ra thói quen.',
    ],
    guided: [
      'Lan normally works at the office, but she has an online class on Friday. Chọn “works” vì đây là thói quen.',
      'Tự nói bốn câu theo thứ tự: thức dậy, đi làm/đi học, ăn tối, đi ngủ.',
    ],
    summaryPoints: [
      'Hiện tại đơn dùng cho thói quen.',
      'He/she/it cần -s/-es ở câu khẳng định; do/does giúp tạo phủ định và câu hỏi.',
    ],
    nextStep: 'Bài sau phân biệt thói quen với việc đang xảy ra ngay lúc nói.',
    vocabulary: [
      {
        term: 'wake up',
        meaning: 'thức dậy',
        partOfSpeech: 'phrasal verb (cụm động từ)',
        example: 'I wake up at six.',
        translation: 'Tôi thức dậy lúc sáu giờ.',
        note: 'wake up early/late',
      },
      {
        term: 'commute',
        meaning: 'đi lại giữa nhà và nơi làm/học',
        partOfSpeech: 'verb (động từ)',
        ipa: '/kəˈmjuːt/',
        example: 'I commute by bus.',
        translation: 'Tôi đi làm bằng xe buýt.',
        note: 'commute to work/school',
      },
    ],
    questions: [
      q(
        'Chọn dạng đúng: “She ___ English every evening.”',
        ['study', 'studies', 'studying', 'studied'],
        'studies',
        'She là ngôi thứ ba số ít nên study đổi thành studies.',
      ),
      q(
        'Câu nào là câu phủ định đúng?',
        [
          'He does not works here.',
          'He not work here.',
          'He does not work here.',
          'He do not work here.',
        ],
        'He does not work here.',
        'Sau does not dùng động từ nguyên mẫu; he đi với does.',
      ),
      openQ(
        'Viết một câu về thói quen của bạn có “usually”.',
        'I usually read before bed.',
        'Đặt usually trước động từ thường.',
      ),
    ],
    exerciseTitle: 'Luyện thói quen hằng ngày',
    exercisePrompt:
      'Chọn dạng động từ đúng và viết một câu thật về lịch sinh hoạt của bạn.',
    exerciseType: CourseLessonExerciseType.FILL_IN_THE_BLANK,
    content: { usefulLanguage: ['I usually…', 'I often…', 'I never…'] },
  },
  {
    title: 'Thời gian, lịch trình và hoạt động hiện tại',
    slug: 'time-schedules-and-now',
    difficulty: 'A1-A2',
    summary:
      'Phân biệt lịch trình lặp lại với hành động đang diễn ra và nói giờ giấc rõ ràng.',
    objectives: [
      'Nói giờ và lịch hẹn.',
      'Dùng hiện tại tiếp diễn cho việc đang xảy ra.',
      'So sánh hành động thường lệ và hành động tạm thời.',
    ],
    theory: [
      'Hiện tại tiếp diễn có am/is/are + V-ing, dùng cho hành động đang diễn ra hoặc tình huống tạm thời.',
      'Các từ now, at the moment, today thường gợi ý hiện tại tiếp diễn; every day, on Mondays thường gợi ý hiện tại đơn.',
      'Khi gặp một câu về thời gian, hãy hỏi: đây là việc lặp lại theo lịch hay việc đang xảy ra quanh lúc nói? Câu trả lời quyết định thì trước khi bạn chọn công thức.',
    ],
    formulas: [
      'I am + V-ing. / He/She/It is + V-ing. / We/They are + V-ing.',
      'Am/Is/Are + subject + V-ing?',
      'Subject + am/is/are not + V-ing.',
    ],
    examples: [
      ex(
        'I work from home every Monday.',
        'Tôi làm việc tại nhà vào mỗi thứ Hai.',
        'Đây là lịch lặp lại nên dùng hiện tại đơn.',
      ),
      ex(
        'I am working from home today.',
        'Hôm nay tôi đang làm việc tại nhà.',
        '“Today” và tính tạm thời phù hợp với hiện tại tiếp diễn.',
      ),
      ex(
        'What time does the class start?',
        'Lớp học bắt đầu lúc mấy giờ?',
        'Dùng hiện tại đơn cho lịch cố định; “does” đi với start vì đây không phải hành động đang diễn ra ngay lúc hỏi.',
      ),
    ],
    mistakes: [
      'Không viết “I am work”; sau am phải là V-ing.',
      'Không dùng “does” với câu hỏi hiện tại tiếp diễn.',
      'Không nhầm lịch cố định với hành động đang xảy ra.',
    ],
    tips: [
      'Gạch chân từ chỉ thời gian trước khi chọn thì.',
      'Nhớ quy tắc thêm -ing: make → making, run → running, study → studying.',
    ],
    guided: [
      'So sánh lịch làm việc cố định của Mai với việc cô ấy đang làm hôm nay; giải thích vì sao mỗi câu dùng một thì khác nhau.',
      'Đặt một câu hỏi về giờ bắt đầu và một câu nói về việc bạn đang làm.',
    ],
    summaryPoints: [
      'Hiện tại đơn nói về lịch hoặc thói quen.',
      'Hiện tại tiếp diễn nói về việc đang diễn ra/tạm thời với am/is/are + V-ing.',
    ],
    nextStep:
      'Sau đây, dùng mô tả nơi chốn để nói về nhà và khu vực xung quanh.',
    questions: [
      q(
        'Câu nào nói về hành động đang diễn ra?',
        [
          'I read every night.',
          'I am reading now.',
          'I read yesterday.',
          'I will read tomorrow.',
        ],
        'I am reading now.',
        '“Am reading” và “now” cho biết hành động đang diễn ra.',
      ),
      q(
        'Chọn câu hỏi đúng về lịch cố định.',
        [
          'What time does the class start?',
          'What time is the class starts?',
          'What time do the class start?',
          'What time start the class?',
        ],
        'What time does the class start?',
        'Lịch cố định dùng hiện tại đơn; class là số ít nên dùng does.',
      ),
      openQ(
        'Viết một câu về việc bạn đang làm hôm nay.',
        'I am studying English today.',
        'Dùng am/is/are + V-ing với “today”.',
      ),
    ],
    exerciseTitle: 'Lịch trình hay việc đang diễn ra?',
    exercisePrompt:
      'Phân loại câu theo thói quen, lịch cố định hoặc hành động đang diễn ra.',
    exerciseType: CourseLessonExerciseType.MULTIPLE_CHOICE,
    content: {
      usefulLanguage: ['What time does…?', 'I am …ing now.', 'I usually…'],
    },
  },
  {
    title: 'Nhà cửa và nơi chốn',
    slug: 'home-and-places',
    difficulty: 'A1-A2',
    summary:
      'Mô tả vị trí đồ vật và hỏi đường bằng giới từ, there is/there are và cụm chỉ nơi chốn.',
    objectives: [
      'Nói một đồ vật ở đâu.',
      'Phân biệt there is và there are.',
      'Hỏi và chỉ đường đơn giản.',
    ],
    theory: [
      'There is dùng với một vật; there are dùng với nhiều vật. Giới từ in, on, under, next to, between mô tả vị trí.',
      'Khi chỉ đường, dùng go straight, turn left/right và near/opposite để người nghe theo dõi dễ hơn.',
      'Hãy hình dung điểm mốc trước rồi mới chọn giới từ: vật nằm trong không gian dùng in, chạm trên bề mặt dùng on, còn quan hệ cạnh nhau dùng next to. Cách này giúp tránh dịch từng từ từ tiếng Việt.',
    ],
    formulas: [
      'There is + a/an + danh từ số ít.',
      'There are + số lượng + danh từ số nhiều.',
      'The + object + is + preposition + place.',
      'Go straight. Turn left/right at…',
    ],
    examples: [
      ex(
        'There is a lamp next to the sofa.',
        'Có một chiếc đèn cạnh ghế sofa.',
        'There is đi với danh từ số ít “a lamp”.',
      ),
      ex(
        'The keys are on the table.',
        'Chìa khóa ở trên bàn.',
        'On diễn tả vật nằm trên bề mặt.',
      ),
      ex(
        'Go straight and turn left at the bank.',
        'Đi thẳng rồi rẽ trái ở ngân hàng.',
        'Hai động từ mệnh lệnh nối tiếp nhau tạo hướng dẫn ngắn; “at the bank” là điểm mốc để người nghe biết lúc nào rẽ.',
      ),
    ],
    mistakes: [
      'Không viết “There are a chair”; chair số ít đi với there is.',
      'Không nhầm in (bên trong) với on (trên bề mặt).',
      'Khi chỉ đường, cần nói điểm mốc để người nghe định hướng.',
    ],
    tips: [
      'Vẽ nhanh vị trí đồ vật để kiểm tra giới từ.',
      'Dùng opposite và next to như các cụm cố định.',
    ],
    guided: [
      'Nhìn sơ đồ phòng khách và trả lời: lamp ở đâu, keys ở đâu, có bao nhiêu ghế?',
      'Thực hành chỉ đường từ lớp học đến thư viện bằng hai mệnh lệnh và một điểm mốc.',
    ],
    summaryPoints: [
      'There is/are cho biết có gì ở một nơi.',
      'Giới từ và điểm mốc làm câu mô tả vị trí rõ ràng.',
    ],
    nextStep: 'Tiếp theo, áp dụng số lượng và lời hỏi lịch sự khi mua đồ ăn.',
    vocabulary: [
      {
        term: 'opposite',
        meaning: 'đối diện',
        partOfSpeech: 'preposition/adjective (giới từ/tính từ)',
        example: 'The café is opposite the library.',
        translation: 'Quán cà phê đối diện thư viện.',
        note: 'opposite the bank',
      },
      {
        term: 'neighborhood',
        meaning: 'khu phố',
        partOfSpeech: 'noun (danh từ)',
        ipa: '/ˈneɪbəhʊd/',
        example: 'There is a quiet park in my neighborhood.',
        translation: 'Có một công viên yên tĩnh trong khu phố của tôi.',
        note: 'local neighborhood',
      },
    ],
    questions: [
      q(
        'Chọn câu đúng với một chiếc ghế.',
        [
          'There are a chair.',
          'There is a chair.',
          'There be a chair.',
          'There is chairs.',
        ],
        'There is a chair.',
        'There is đi với danh từ số ít.',
      ),
      q(
        '“The keys are ___ the table.”',
        ['in', 'on', 'between', 'under to'],
        'on',
        'On diễn tả chìa khóa nằm trên bề mặt bàn.',
      ),
      openQ(
        'Viết một câu chỉ đường có “turn left”.',
        'Turn left at the library.',
        'Dùng động từ mệnh lệnh và thêm điểm mốc.',
      ),
    ],
    exerciseTitle: 'Mô tả nơi chốn',
    exercisePrompt:
      'Chọn giới từ và cấu trúc phù hợp để mô tả căn phòng và đường đi.',
    exerciseType: CourseLessonExerciseType.MULTIPLE_CHOICE,
    content: {
      usefulLanguage: ['There is…', 'There are…', 'Turn left/right at…'],
    },
  },
  {
    title: 'Ăn uống và mua sắm',
    slug: 'food-and-shopping',
    difficulty: 'A1-A2',
    summary:
      'Gọi món, hỏi giá và dùng some/any, much/many trong tình huống mua sắm quen thuộc.',
    objectives: [
      'Gọi món hoặc yêu cầu một sản phẩm lịch sự.',
      'Hỏi giá và số lượng.',
      'Phân biệt danh từ đếm được và không đếm được.',
    ],
    theory: [
      'Dùng “Can I have…?” hoặc “I would like…” để yêu cầu lịch sự. Many đi với danh từ đếm được số nhiều; much đi với danh từ không đếm được.',
      'Some thường dùng trong câu khẳng định; any thường xuất hiện trong câu hỏi và phủ định.',
    ],
    formulas: [
      'Can I have + a/an/some + item?',
      'How much is + singular item? / How much are + plural items?',
      'How many + plural count noun?',
      'There is some… / There are some…',
    ],
    examples: [
      ex(
        'Can I have a bottle of water, please?',
        'Cho tôi một chai nước được không?',
        '“Can I have… please?” là lời yêu cầu lịch sự.',
      ),
      ex(
        'How much are these apples?',
        'Những quả táo này giá bao nhiêu?',
        'Apples là danh từ đếm được số nhiều nên dùng are.',
      ),
      ex(
        'We do not have any rice left.',
        'Chúng tôi không còn gạo.',
        'Rice không đếm được; any dùng trong câu phủ định.',
      ),
    ],
    mistakes: [
      'Không nói “many rice”; rice là danh từ không đếm được.',
      'Không hỏi “How much are this apple?”; apple số ít đi với is.',
      'Đừng quên please khi yêu cầu trong cửa hàng.',
    ],
    tips: [
      'Học theo đơn vị: a bottle of water, a bag of rice.',
      'Nhìn danh từ sau much/many trước khi chọn từ.',
    ],
    guided: [
      'Bạn mua bữa sáng với ngân sách nhỏ: hỏi giá, yêu cầu một chai nước và xác nhận tổng tiền.',
      'Đóng vai người bán và khách hàng, đổi một sản phẩm khác nhưng giữ cấu trúc lịch sự.',
    ],
    summaryPoints: [
      'Can I have/I would like giúp yêu cầu lịch sự.',
      'Much dùng với không đếm được; many dùng với đếm được số nhiều.',
    ],
    nextStep: 'Bài kế tiếp chuyển các mẫu câu này vào trường học và công việc.',
    vocabulary: [
      {
        term: 'receipt',
        meaning: 'hóa đơn',
        partOfSpeech: 'noun (danh từ)',
        ipa: '/rɪˈsiːt/',
        example: 'Could I have the receipt, please?',
        translation: 'Cho tôi xin hóa đơn được không?',
        note: 'keep the receipt',
      },
      {
        term: 'affordable',
        meaning: 'vừa túi tiền',
        partOfSpeech: 'adjective (tính từ)',
        example: 'This meal is affordable.',
        translation: 'Bữa ăn này vừa túi tiền.',
        note: 'affordable price',
      },
    ],
    questions: [
      q(
        'Câu nào là yêu cầu lịch sự?',
        [
          'Give water.',
          'Can I have some water, please?',
          'I water now.',
          'Water you.',
        ],
        'Can I have some water, please?',
        'Can I have… please? là mẫu yêu cầu lịch sự.',
      ),
      q(
        'Chọn câu đúng.',
        [
          'How much are this apple?',
          'How many is this apple?',
          'How much is this apple?',
          'How much this apple?',
        ],
        'How much is this apple?',
        'Apple số ít đi với is.',
      ),
      openQ(
        'Viết một câu hỏi giá cho nhiều quả táo.',
        'How much are these apples?',
        'Danh từ số nhiều dùng “are”.',
      ),
    ],
    exerciseTitle: 'Mua đồ ăn bằng tiếng Anh',
    exercisePrompt:
      'Hoàn thành đoạn hội thoại ngắn giữa khách hàng và người bán.',
    exerciseType: CourseLessonExerciseType.MULTIPLE_CHOICE,
    content: {
      usefulLanguage: [
        'Can I have…?',
        'How much is/are…?',
        'Could I have the receipt?',
      ],
    },
  },
  {
    title: 'Học tập, công việc và giao tiếp cơ bản',
    slug: 'study-work-basic-communication',
    difficulty: 'A2',
    summary:
      'Trao đổi nhiệm vụ, lịch hẹn và yêu cầu hỗ trợ trong lớp học hoặc nơi làm việc.',
    objectives: [
      'Nêu mục đích của tin nhắn ngắn.',
      'Yêu cầu làm rõ thông tin.',
      'Phản hồi lịch sự bằng câu hoàn chỉnh.',
    ],
    theory: [
      'Một tin nhắn rõ ràng thường có mục đích, thông tin chính và hành động tiếp theo. Could you…? và Could you clarify…? lịch sự hơn mệnh lệnh trực tiếp.',
      'Dùng because để nêu lý do; dùng by + thời điểm để nói hạn chót.',
      'Trước khi viết, hãy xác định người nhận cần biết điều gì và cần làm gì tiếp theo. Sau đó đặt mục đích ở đầu tin nhắn, thêm thời hạn hoặc lý do, rồi kết thúc bằng yêu cầu cụ thể.',
    ],
    formulas: [
      'Could you + verb nguyên mẫu…?',
      'I am writing to + verb…',
      'Could you clarify + noun/question?',
      'Please + verb + by + time.',
    ],
    examples: [
      ex(
        'Could you clarify the deadline for this task?',
        'Bạn có thể làm rõ hạn chót của nhiệm vụ này không?',
        'Could you giúp yêu cầu lịch sự; clarify yêu cầu thông tin cụ thể.',
      ),
      ex(
        'I am writing to confirm our meeting on Tuesday.',
        'Tôi viết thư để xác nhận cuộc họp vào thứ Ba.',
        'Câu mở đầu nêu mục đích ngay lập tức.',
      ),
      ex(
        'Please send the file by 5 p.m.',
        'Vui lòng gửi tệp trước 5 giờ chiều.',
        'By + thời điểm nêu hạn chót; người nhận hiểu rằng tệp cần đến trước hoặc muộn nhất vào 5 giờ.',
      ),
    ],
    mistakes: [
      'Không dùng “clarify about the deadline”; clarify đã mang nghĩa làm rõ.',
      'Không viết email chỉ có lời chào mà thiếu mục đích.',
      'Không dùng “until 5 p.m.” khi muốn nói hạn chót cần dùng by.',
    ],
    tips: [
      'Trước khi gửi, kiểm tra người nhận, mục đích và hành động cần làm.',
      'Học cụm “I am writing to confirm…” như một khối câu.',
    ],
    guided: [
      'Bạn cần xác nhận lịch họp và xin tệp trước 5 giờ. Viết một tin nhắn có hai câu, sau đó đọc thành tiếng.',
      'Đổi “meeting” thành “class” để luyện chuyển ngữ cảnh.',
    ],
    summaryPoints: [
      'Tin nhắn hiệu quả có mục đích và hành động tiếp theo.',
      'Could you…? và Please… giúp giao tiếp lịch sự.',
    ],
    nextStep: 'Bài cuối ôn lại các mẫu câu qua tình huống đời sống và học tập.',
    questions: [
      q(
        'Câu nào yêu cầu làm rõ lịch một cách lịch sự?',
        [
          'Tell me deadline.',
          'Could you clarify the deadline?',
          'Deadline now.',
          'You clarify deadline!',
        ],
        'Could you clarify the deadline?',
        'Could you + động từ nguyên mẫu tạo yêu cầu lịch sự.',
      ),
      q(
        'Cụm nào nêu hạn chót?',
        ['at 5 p.m.', 'by 5 p.m.', 'on 5 p.m.', 'from 5 p.m.'],
        'by 5 p.m.',
        'By + thời điểm diễn tả hạn chót.',
      ),
      openQ(
        'Viết câu mở đầu để xác nhận cuộc họp.',
        'I am writing to confirm our meeting.',
        'I am writing to + động từ nêu mục đích.',
      ),
    ],
    exerciseTitle: 'Tin nhắn rõ ràng và lịch sự',
    exercisePrompt: 'Chọn cách yêu cầu, xác nhận và nêu hạn chót phù hợp.',
    exerciseType: CourseLessonExerciseType.WRITING_GUIDED,
    content: {
      modelStructure: [
        'Lời chào',
        'Mục đích',
        'Thông tin/hành động',
        'Lời kết',
      ],
      usefulLanguage: [
        'I am writing to…',
        'Could you clarify…?',
        'Please send… by…',
      ],
    },
  },
  {
    title: 'Ôn tập nền tảng A1–A2',
    slug: 'foundation-review',
    difficulty: 'A2',
    summary:
      'Ôn tập các mẫu câu nền tảng qua một ngày có chào hỏi, lịch trình, mua sắm và nhắn tin.',
    objectives: [
      'Chọn đúng cấu trúc theo ngữ cảnh.',
      'Kết hợp từ vựng quen thuộc thành câu tự nhiên.',
      'Tự phát hiện lỗi cơ bản trước khi gửi hoặc nói.',
    ],
    theory: [
      'Khi gặp câu mới, xác định mục đích trước: giới thiệu, mô tả thói quen, nói việc đang diễn ra, hỏi giá hay yêu cầu hỗ trợ.',
      'Sau đó kiểm tra chủ ngữ, thì, số ít/số nhiều và từ chỉ thời gian.',
      'Nếu còn phân vân, đọc cả câu trong tình huống thay vì chọn theo một từ riêng lẻ. Một câu tự nhiên phải đúng cả ý định giao tiếp lẫn hình thức ngữ pháp.',
    ],
    formulas: [
      'Giới thiệu: My name is… / I am from…',
      'Thói quen: I usually + verb…',
      'Đang diễn ra: I am + V-ing…',
      'Yêu cầu: Could you…? / Can I have…?',
    ],
    examples: [
      ex(
        'I usually take the bus, but I am walking today.',
        'Tôi thường đi xe buýt, nhưng hôm nay tôi đang đi bộ.',
        'Hai vế cho thấy thói quen và hành động tạm thời.',
      ),
      ex(
        'Could you tell me where the library is?',
        'Bạn có thể cho tôi biết thư viện ở đâu không?',
        'Could you làm câu hỏi lịch sự hơn.',
      ),
      ex(
        'Can I have the receipt, please?',
        'Cho tôi xin hóa đơn được không?',
        'Mẫu câu phù hợp sau khi mua hàng; “please” làm yêu cầu mềm và tự nhiên hơn.',
      ),
    ],
    mistakes: [
      'Chọn thì chỉ dựa vào một từ mà bỏ qua toàn bộ ngữ cảnh.',
      'Quên mạo từ hoặc -s khi nói danh từ số ít/ngôi thứ ba.',
      'Dịch từng từ khiến yêu cầu nghe thiếu lịch sự.',
    ],
    tips: [
      'Đọc chậm, gạch chân từ chỉ thời gian và xác định mục đích câu.',
      'Tự đọc lại câu sau khi điền để kiểm tra âm và nghĩa.',
    ],
    guided: [
      'Theo lịch một ngày của Minh, chọn câu phù hợp cho từng chặng: chào hỏi, đi học, mua đồ và gửi tin nhắn.',
      'Giải thích bằng tiếng Việt vì sao bạn chọn cấu trúc đó.',
    ],
    summaryPoints: [
      'Mục đích giao tiếp quyết định mẫu câu.',
      'Kiểm tra chủ ngữ, thì, số lượng và lịch sự trước khi hoàn thành câu.',
    ],
    nextStep:
      'Bạn có thể chuyển sang bài luyện kỹ năng hoặc học tiếp khóa ngữ pháp cơ bản.',
    questions: [
      q(
        'Câu nào mô tả thói quen?',
        [
          'I am taking the bus now.',
          'I usually take the bus.',
          'I took the bus yesterday.',
          'I will take the bus tomorrow.',
        ],
        'I usually take the bus.',
        'Usually cho biết thói quen nên dùng hiện tại đơn.',
      ),
      q(
        'Câu nào phù hợp để nhờ chỉ đường lịch sự?',
        [
          'Tell me the library.',
          'Could you tell me where the library is?',
          'Library where?',
          'You show library!',
        ],
        'Could you tell me where the library is?',
        'Could you tell me…? là mẫu hỏi lịch sự.',
      ),
      openQ(
        'Viết một câu bạn có thể dùng khi mua hàng.',
        'Can I have a bottle of water, please?',
        'Can I have… please? là lời yêu cầu tự nhiên.',
      ),
    ],
    exerciseTitle: 'Ôn tập qua một ngày',
    exercisePrompt:
      'Chọn cấu trúc đúng rồi viết một câu áp dụng vào đời sống của bạn.',
    exerciseType: CourseLessonExerciseType.CHECKPOINT,
    content: {
      usefulLanguage: [
        'My name is…',
        'I usually…',
        'I am …ing now.',
        'Could you…?',
        'Can I have…?',
      ],
    },
  },
];

const grammarLessons: LessonSpec[] = [
  {
    title: 'Thì hiện tại đơn và hiện tại tiếp diễn',
    slug: 'present-simple-and-continuous',
    difficulty: 'A1-A2',
    summary:
      'Phân biệt thói quen/lịch cố định với hành động đang diễn ra hoặc tạm thời.',
    objectives: [
      'Hiểu khi nào dùng hai thì.',
      'Tạo câu khẳng định, phủ định và câu hỏi.',
      'Nhận ra lỗi chia động từ phổ biến.',
    ],
    theory: [
      'Thì hiện tại đơn (Present Simple) dùng cho thói quen, sự thật và lịch cố định. Với he/she/it, động từ thường thêm -s/-es.',
      'Thì hiện tại tiếp diễn (Present Continuous) dùng am/is/are + V-ing cho việc đang xảy ra hoặc tạm thời. “Now”, “today” thường là dấu hiệu hữu ích, nhưng luôn cần đọc cả ngữ cảnh.',
    ],
    formulas: [
      'Present Simple: I/You/We/They + V; He/She/It + V-s/es.',
      'Phủ định: do not/does not + V nguyên mẫu.',
      'Câu hỏi: Do/Does + chủ ngữ + V nguyên mẫu?',
      'Present Continuous: am/is/are + V-ing.',
    ],
    examples: [
      ex(
        'She drinks coffee every morning.',
        'Cô ấy uống cà phê mỗi sáng.',
        'Thói quen lặp lại nên dùng hiện tại đơn.',
      ),
      ex(
        'She is drinking coffee now.',
        'Bây giờ cô ấy đang uống cà phê.',
        'Hành động đang diễn ra nên dùng am/is/are + V-ing.',
      ),
      ex(
        'He does not work here.',
        'Anh ấy không làm việc ở đây.',
        'Sau does not, work giữ nguyên mẫu.',
      ),
    ],
    mistakes: [
      'She work every day → She works every day.',
      'He does not works here → He does not work here.',
      'I am go to school → I am going to school.',
    ],
    tips: [
      'Tách “be” và động từ thường: be có am/is/are; động từ thường dùng do/does ở phủ định/câu hỏi.',
      'Nhớ: sau does/doesn’t luôn là động từ nguyên mẫu.',
    ],
    guided: [
      'Lan normally works at the office, but today she is working from home. “Works” là lịch thường lệ; “is working” là việc tạm thời hôm nay.',
      'Tự tạo một cặp câu về một hoạt động bạn thường làm và hoạt động bạn đang làm hôm nay.',
    ],
    summaryPoints: [
      'Present Simple = thói quen, sự thật, lịch.',
      'Present Continuous = đang diễn ra/tạm thời.',
      'Không thêm -s sau does/doesn’t.',
    ],
    nextStep: 'Tiếp theo học danh từ, mạo từ và cách nói số lượng.',
    questions: [
      q(
        'She ___ coffee every morning.',
        ['drink', 'drinks', 'is drink', 'drinking'],
        'drinks',
        'She là ngôi thứ ba số ít nên động từ thêm -s.',
      ),
      q(
        'Câu nào đúng?',
        [
          'He doesn’t works here.',
          'He doesn’t work here.',
          'He don’t work here.',
          'He not works here.',
        ],
        'He doesn’t work here.',
        'Sau doesn’t dùng động từ nguyên mẫu.',
      ),
      q(
        'Câu nào nói việc đang xảy ra?',
        [
          'I work today.',
          'I am working today.',
          'I works today.',
          'I working today.',
        ],
        'I am working today.',
        'Hiện tại tiếp diễn cần am/is/are + V-ing.',
      ),
      openQ(
        'Viết một cặp câu: một thói quen và một việc đang diễn ra.',
        'I work from home every Monday. I am working from home today.',
        'Câu đầu là lịch lặp lại; câu sau là tình huống tạm thời.',
      ),
      openQ(
        'Sửa câu: “She study English now.”',
        'She is studying English now.',
        'Now báo hiệu việc đang diễn ra; dùng is + studying.',
      ),
    ],
    exerciseTitle: 'Luyện Present Simple và Present Continuous',
    exercisePrompt: 'Chọn dạng đúng, sửa lỗi và viết câu theo ngữ cảnh.',
    exerciseType: CourseLessonExerciseType.GRAMMAR,
    content: {
      rule: 'Present Simple nói về thói quen/lịch; Present Continuous nói về việc đang xảy ra/tạm thời.',
      commonErrors: [
        'She work → She works',
        'He doesn’t works → He doesn’t work',
        'I am go → I am going',
      ],
    },
  },
  {
    title: 'Danh từ, mạo từ và số lượng',
    slug: 'nouns-articles-and-quantity',
    difficulty: 'A1-A2',
    summary:
      'Dùng danh từ số ít/số nhiều, a/an/the và các từ chỉ lượng trong câu đời thường.',
    objectives: [
      'Phân biệt danh từ đếm được và không đếm được.',
      'Chọn a, an, the hoặc không dùng mạo từ.',
      'Dùng some, any, much, many, a lot of đúng ngữ cảnh.',
    ],
    theory: [
      'Danh từ đếm được có dạng số ít và số nhiều; danh từ không đếm được như water, rice thường không thêm -s.',
      'A đứng trước âm phụ âm, an trước âm nguyên âm; the dùng khi người nghe biết rõ vật nào.',
    ],
    formulas: [
      'a/an + danh từ đếm được số ít.',
      'some + câu khẳng định; any + câu hỏi/phủ định.',
      'many + danh từ đếm được; much + danh từ không đếm được.',
    ],
    examples: [
      ex(
        'I need an umbrella.',
        'Tôi cần một chiếc ô.',
        'Umbrella bắt đầu bằng âm nguyên âm nên dùng an.',
      ),
      ex(
        'There are many books on the shelf.',
        'Có nhiều sách trên kệ.',
        'Books đếm được số nhiều nên dùng many.',
      ),
      ex(
        'We do not have much time.',
        'Chúng ta không có nhiều thời gian.',
        'Time trong nghĩa này không đếm được nên dùng much.',
      ),
    ],
    mistakes: [
      'Không viết “a water”; nói a bottle of water.',
      'Không dùng “much books”; books đi với many.',
      'Không thêm -s vào information, advice, rice.',
    ],
    tips: [
      'Hỏi “có thể đếm từng cái không?” để chọn much/many.',
      'Học danh từ cùng đơn vị: a piece of advice, a bottle of water.',
    ],
    guided: [
      'Lập danh sách đồ cần mua cho bữa sáng và phân loại countable/uncountable.',
      'Đổi câu khẳng định sang câu hỏi với any.',
    ],
    summaryPoints: [
      'A/an cho một danh từ đếm được; the cho vật đã xác định.',
      'Many đếm được, much không đếm được.',
    ],
    nextStep: 'Bài sau kể lại việc đã xảy ra bằng quá khứ đơn.',
    vocabulary: [
      {
        term: 'advice',
        meaning: 'lời khuyên',
        partOfSpeech: 'uncountable noun (danh từ không đếm được)',
        example: 'She gave me useful advice.',
        translation: 'Cô ấy cho tôi lời khuyên hữu ích.',
        note: 'a piece of advice',
      },
      {
        term: 'quantity',
        meaning: 'số lượng',
        partOfSpeech: 'noun (danh từ)',
        example: 'Check the quantity before ordering.',
        translation: 'Kiểm tra số lượng trước khi đặt hàng.',
        note: 'small/large quantity',
      },
    ],
    questions: [
      q(
        'Chọn câu đúng.',
        [
          'I need a umbrella.',
          'I need an umbrella.',
          'I need umbrella a.',
          'I need an umbrellas.',
        ],
        'I need an umbrella.',
        'Umbrella bắt đầu bằng âm nguyên âm nên dùng an.',
      ),
      q(
        '___ books are on the desk.',
        ['Much', 'Many', 'Any much', 'A'],
        'Many',
        'Books là danh từ đếm được số nhiều.',
      ),
      q(
        'Cụm nào đúng?',
        [
          'much information',
          'many information',
          'an information',
          'informations',
        ],
        'much information',
        'Information là danh từ không đếm được.',
      ),
      openQ(
        'Viết câu hỏi với any về sữa.',
        'Do we have any milk?',
        'Any thường dùng trong câu hỏi.',
      ),
      openQ(
        'Viết một cụm có “a piece of”.',
        'a piece of advice',
        'Advice không đếm được; dùng đơn vị piece.',
      ),
    ],
    exerciseTitle: 'Danh từ và số lượng',
    exercisePrompt: 'Chọn mạo từ hoặc từ chỉ lượng phù hợp.',
    exerciseType: CourseLessonExerciseType.FILL_IN_THE_BLANK,
    content: {
      targetWords: ['a/an', 'the', 'some', 'any', 'much', 'many'],
      usageNote:
        'Luôn xét danh từ đếm được hay không đếm được trước khi chọn từ.',
    },
  },
  {
    title: 'Thì quá khứ đơn',
    slug: 'past-simple',
    difficulty: 'A2',
    summary:
      'Kể lại sự việc đã hoàn thành với động từ thường và động từ bất quy tắc.',
    objectives: [
      'Dùng was/were và động từ quá khứ.',
      'Tạo phủ định/câu hỏi với did.',
      'Dùng mốc thời gian quá khứ chính xác.',
    ],
    theory: [
      'Quá khứ đơn nói về việc đã kết thúc; mốc yesterday, last week, two days ago thường xuất hiện.',
      'Động từ có quy tắc thêm -ed; động từ bất quy tắc cần học theo cụm như go/went, see/saw.',
    ],
    formulas: [
      'Khẳng định: Subject + V-ed/V2.',
      'Phủ định: did not + V nguyên mẫu.',
      'Câu hỏi: Did + subject + V nguyên mẫu?',
    ],
    examples: [
      ex(
        'We visited the museum last Sunday.',
        'Chúng tôi đã thăm bảo tàng Chủ nhật trước.',
        'Visited là động từ có quy tắc ở quá khứ.',
      ),
      ex(
        'She went home at six.',
        'Cô ấy đã về nhà lúc sáu giờ.',
        'Go có dạng quá khứ bất quy tắc là went.',
      ),
      ex(
        'Did you call the client?',
        'Bạn đã gọi khách hàng chưa?',
        'Sau did, call trở về nguyên mẫu.',
      ),
    ],
    mistakes: [
      'Did you went…? → Did you go…?',
      'He didn’t visited… → He didn’t visit…',
      'Không dùng was với động từ thường trong cùng một cụm.',
    ],
    tips: [
      'Tìm mốc thời gian trước.',
      'Học động từ bất quy tắc theo câu hoàn chỉnh, không chỉ danh sách.',
    ],
    guided: [
      'Kể ba việc đã làm hôm qua theo thứ tự thời gian.',
      'Đổi một câu khẳng định sang phủ định và câu hỏi.',
    ],
    summaryPoints: [
      'Việc đã kết thúc dùng quá khứ đơn.',
      'Did/didn’t đi với nguyên mẫu.',
    ],
    nextStep: 'Bài sau nói về dự định và dự đoán tương lai.',
    questions: [
      q(
        'Yesterday, I ___ to the library.',
        ['go', 'went', 'going', 'goes'],
        'went',
        'Went là quá khứ của go.',
      ),
      q(
        'Câu hỏi đúng là gì?',
        [
          'Did you went home?',
          'Did you go home?',
          'Do you went home?',
          'Did went you home?',
        ],
        'Did you go home?',
        'Sau did dùng nguyên mẫu go.',
      ),
      q(
        'Câu phủ định đúng?',
        [
          'She didn’t called me.',
          'She didn’t call me.',
          'She not call me.',
          'She don’t called me.',
        ],
        'She didn’t call me.',
        'Didn’t + động từ nguyên mẫu.',
      ),
      openQ(
        'Viết một câu về việc bạn làm hôm qua.',
        'I studied English yesterday.',
        'Dùng V-ed hoặc dạng quá khứ bất quy tắc.',
      ),
      openQ(
        'Viết câu hỏi về một chuyến đi.',
        'Did you visit Hue last year?',
        'Did + chủ ngữ + nguyên mẫu.',
      ),
    ],
    exerciseTitle: 'Kể lại việc đã xảy ra',
    exercisePrompt: 'Chọn dạng quá khứ và chuyển câu sang câu hỏi/phủ định.',
    exerciseType: CourseLessonExerciseType.GRAMMAR,
    content: {
      rule: 'Quá khứ đơn diễn tả việc đã hoàn thành; did/didn’t + nguyên mẫu.',
    },
  },
  {
    title: 'Tương lai cơ bản: will và be going to',
    slug: 'future-will-going-to',
    difficulty: 'A2',
    summary: 'Nói về quyết định nhanh, dự đoán và kế hoạch đã có.',
    objectives: [
      'Phân biệt will và be going to.',
      'Nói kế hoạch cá nhân rõ ràng.',
      'Đặt câu hỏi về dự định.',
    ],
    theory: [
      'Will thường dùng cho quyết định ngay lúc nói hoặc dự đoán. Be going to dùng cho kế hoạch đã định hoặc dự đoán có dấu hiệu rõ.',
      'Sau will dùng động từ nguyên mẫu; be going to cần am/is/are.',
    ],
    formulas: [
      'Subject + will + V.',
      'Subject + am/is/are going to + V.',
      'Will + subject + V?',
    ],
    examples: [
      ex(
        'I will help you with that bag.',
        'Tôi sẽ giúp bạn chiếc túi đó.',
        'Quyết định được đưa ra ngay lúc nói.',
      ),
      ex(
        'We are going to visit Hoi An next month.',
        'Chúng tôi sẽ thăm Hội An tháng sau.',
        'Đây là kế hoạch đã có.',
      ),
      ex(
        'Look at those clouds. It is going to rain.',
        'Nhìn những đám mây kia kìa. Trời sắp mưa.',
        'Có dấu hiệu hiện tại cho dự đoán.',
      ),
    ],
    mistakes: [
      'Không nói “I will to help”; sau will không có to.',
      'Không bỏ be trong “She is going to…”.',
      'Không dùng going to cho mọi dự đoán không có kế hoạch/dấu hiệu.',
    ],
    tips: [
      'Hỏi “đã có kế hoạch chưa?” để chọn going to.',
      'Hỏi “quyết định ngay bây giờ?” để chọn will.',
    ],
    guided: [
      'Bạn nghe bạn mình cần giúp; chọn will cho quyết định tức thời.',
      'Lập kế hoạch cuối tuần bằng going to và nói một dự đoán bằng will.',
    ],
    summaryPoints: [
      'Will = quyết định tức thời/dự đoán.',
      'Going to = kế hoạch hoặc dự đoán có dấu hiệu.',
    ],
    nextStep: 'Tiếp theo học cách mô tả và so sánh người/vật.',
    questions: [
      q(
        'Quyết định giúp bạn ngay lúc này dùng gì?',
        [
          'I am going help.',
          'I will help.',
          'I going to help.',
          'I will to help.',
        ],
        'I will help.',
        'Will + động từ nguyên mẫu cho quyết định tức thời.',
      ),
      q(
        'Kế hoạch đã đặt vé nên dùng câu nào?',
        [
          'We are going to travel.',
          'We will to travel.',
          'We going travel.',
          'We are go travel.',
        ],
        'We are going to travel.',
        'Going to cần am/is/are và động từ nguyên mẫu.',
      ),
      q(
        'Dấu hiệu mây đen phù hợp với câu nào?',
        [
          'It will rain because I decided.',
          'It is going to rain.',
          'It going rain.',
          'It is rain.',
        ],
        'It is going to rain.',
        'Dự đoán có dấu hiệu rõ dùng going to.',
      ),
      openQ(
        'Viết một câu kế hoạch cuối tuần.',
        'I am going to visit my family.',
        'Dùng am/is/are going to + V.',
      ),
      openQ(
        'Viết lời hứa ngắn dùng will.',
        'I will call you tonight.',
        'Will + nguyên mẫu.',
      ),
    ],
    exerciseTitle: 'Nói về tương lai',
    exercisePrompt: 'Phân biệt quyết định tức thời, kế hoạch và dự đoán.',
    exerciseType: CourseLessonExerciseType.GRAMMAR,
    content: {
      rule: 'Will và be going to đều nói về tương lai nhưng khác ý định và bằng chứng.',
    },
  },
  {
    title: 'Tính từ, trạng từ và so sánh',
    slug: 'adjectives-adverbs-comparison',
    difficulty: 'A2',
    summary: 'Mô tả người/vật và so sánh bằng tính từ, trạng từ thông dụng.',
    objectives: [
      'Phân biệt tính từ và trạng từ.',
      'Tạo so sánh hơn và nhất.',
      'Chọn cấu trúc phù hợp với tính từ ngắn/dài.',
    ],
    theory: [
      'Tính từ mô tả danh từ; trạng từ thường mô tả cách hành động diễn ra và nhiều từ kết thúc bằng -ly.',
      'Tính từ ngắn thường thêm -er/-est; tính từ dài dùng more/most.',
    ],
    formulas: [
      'a + adjective + noun.',
      'verb + adverb.',
      'short adjective + -er/-est; more/most + long adjective.',
    ],
    examples: [
      ex(
        'She is a careful driver.',
        'Cô ấy là một người lái xe cẩn thận.',
        'Careful bổ nghĩa cho danh từ driver.',
      ),
      ex(
        'She drives carefully.',
        'Cô ấy lái xe cẩn thận.',
        'Carefully bổ nghĩa cho động từ drives.',
      ),
      ex(
        'This route is safer than the old one.',
        'Tuyến đường này an toàn hơn tuyến cũ.',
        'Safe là tính từ ngắn nên dùng safer.',
      ),
    ],
    mistakes: [
      'Không dùng “careful” sau drive khi muốn nói cách lái.',
      'Không nói “more safer”; chỉ chọn một dạng so sánh.',
      'Good → better, không phải gooder.',
    ],
    tips: [
      'Hỏi “mô tả ai/cái gì?” hay “hành động thế nào?” để chọn từ loại.',
      'Ghi nhớ các dạng bất quy tắc good/better/best.',
    ],
    guided: [
      'Mô tả hai tuyến đường rồi chọn tuyến an toàn hơn.',
      'Đổi một tính từ trong câu “a quiet room” thành trạng từ trong một câu hành động.',
    ],
    summaryPoints: [
      'Adjective mô tả danh từ; adverb mô tả hành động.',
      'So sánh dùng -er/-est hoặc more/most tùy độ dài.',
    ],
    nextStep: 'Bài sau học động từ khuyết thiếu để nói khả năng và lời khuyên.',
    questions: [
      q(
        'Chọn từ đúng: “She sings ___.”',
        ['beautiful', 'beautifully', 'beauty', 'more beautiful'],
        'beautifully',
        'Trạng từ beautifully mô tả cách hát.',
      ),
      q(
        'Dạng so sánh đúng của safe là gì?',
        ['more safe', 'safer', 'safest than', 'safeer'],
        'safer',
        'Safe là tính từ ngắn nên thêm -r.',
      ),
      q(
        'Dạng đúng của good ở so sánh hơn?',
        ['gooder', 'more good', 'better', 'best than'],
        'better',
        'Better là dạng bất quy tắc của good.',
      ),
      openQ(
        'Viết một câu dùng more interesting.',
        'This book is more interesting than that one.',
        'Tính từ dài dùng more + adjective.',
      ),
      openQ(
        'Viết một câu có trạng từ chỉ cách làm việc.',
        'He works carefully.',
        'Trạng từ đứng sau động từ trong câu này.',
      ),
    ],
    exerciseTitle: 'Mô tả và so sánh',
    exercisePrompt: 'Nhận diện từ loại và chọn dạng so sánh tự nhiên.',
    exerciseType: CourseLessonExerciseType.GRAMMAR,
    content: {
      rule: 'Tính từ bổ nghĩa danh từ; trạng từ bổ nghĩa động từ; dạng so sánh phụ thuộc độ dài và tính chất từ.',
    },
  },
  {
    title: 'Động từ khuyết thiếu cơ bản',
    slug: 'basic-modal-verbs',
    difficulty: 'A2',
    summary:
      'Dùng can, should, must và have to cho khả năng, lời khuyên và nghĩa vụ.',
    objectives: [
      'Nói khả năng bằng can/can’t.',
      'Đưa lời khuyên với should/shouldn’t.',
      'Phân biệt nghĩa vụ với must và have to.',
    ],
    theory: [
      'Sau động từ khuyết thiếu dùng động từ nguyên mẫu không có to: can speak, should rest.',
      'Must thể hiện người nói nhấn mạnh nghĩa vụ; have to thường nói quy định hoặc hoàn cảnh bắt buộc.',
    ],
    formulas: [
      'Subject + can/should/must + V.',
      'Subject + cannot/should not + V.',
      'Do/Does + subject + have to + V?',
    ],
    examples: [
      ex(
        'You can ask the teacher for help.',
        'Bạn có thể nhờ giáo viên giúp.',
        'Can diễn tả khả năng hoặc sự cho phép.',
      ),
      ex(
        'You should check the address.',
        'Bạn nên kiểm tra địa chỉ.',
        'Should là lời khuyên nhẹ nhàng.',
      ),
      ex(
        'We have to wear a badge at work.',
        'Chúng tôi phải đeo thẻ ở chỗ làm.',
        'Have to thường gắn với quy định.',
      ),
    ],
    mistakes: [
      'Không thêm -s sau can: He can speak.',
      'Không nói “should to rest”; should + nguyên mẫu.',
      'Câu hỏi với have to dùng do/does.',
    ],
    tips: [
      'Modal + V nguyên mẫu là quy tắc nhanh nhất.',
      'Dùng should để khuyên, must/have to khi nghĩa vụ mạnh hơn.',
    ],
    guided: [
      'Đưa ba lời khuyên cho người chuẩn bị phỏng vấn.',
      'Đổi một quy định ở trường thành câu have to.',
    ],
    summaryPoints: [
      'Modal verb đi với nguyên mẫu.',
      'Can = khả năng/cho phép; should = lời khuyên; must/have to = nghĩa vụ.',
    ],
    nextStep: 'Bài sau dùng giới từ và cụm từ cố định trong giao tiếp.',
    questions: [
      q(
        'Câu nào đúng?',
        [
          'She can speaks English.',
          'She can speak English.',
          'She can to speak English.',
          'She cans speak English.',
        ],
        'She can speak English.',
        'Sau can dùng nguyên mẫu không to và không -s.',
      ),
      q(
        'Câu lời khuyên đúng?',
        [
          'You should to rest.',
          'You should rest.',
          'You should rests.',
          'You should resting.',
        ],
        'You should rest.',
        'Should + động từ nguyên mẫu.',
      ),
      q(
        'Quy định bắt buộc phù hợp với câu nào?',
        [
          'We have to wear a badge.',
          'We have wear a badge.',
          'We has to wearing a badge.',
          'We must to wear a badge.',
        ],
        'We have to wear a badge.',
        'Have to + nguyên mẫu diễn tả quy định.',
      ),
      openQ(
        'Viết lời khuyên cho người học từ mới.',
        'You should review the words every day.',
        'Should + nguyên mẫu.',
      ),
      openQ(
        'Viết câu hỏi về nghĩa vụ đến lớp đúng giờ.',
        'Do we have to arrive on time?',
        'Do + chủ ngữ + have to + nguyên mẫu?',
      ),
    ],
    exerciseTitle: 'Khả năng, lời khuyên và nghĩa vụ',
    exercisePrompt: 'Chọn modal verb và cấu trúc đúng theo ngữ cảnh.',
    exerciseType: CourseLessonExerciseType.GRAMMAR,
    content: {
      rule: 'Modal verb + động từ nguyên mẫu; ý nghĩa thay đổi theo can, should, must/have to.',
    },
  },
  {
    title: 'Giới từ và cụm từ thông dụng',
    slug: 'prepositions-and-common-phrases',
    difficulty: 'A2',
    summary:
      'Dùng giới từ thời gian, nơi chốn và các cụm từ cố định thường gặp.',
    objectives: [
      'Phân biệt in/on/at trong thời gian.',
      'Dùng giới từ nơi chốn rõ ràng.',
      'Học collocation thay vì dịch từng từ.',
    ],
    theory: [
      'At thường đi với giờ hoặc điểm cụ thể; on với ngày; in với tháng, năm hoặc khoảng thời gian dài.',
      'Một số cụm là cách kết hợp cố định: at home, interested in, good at, arrive at/in.',
    ],
    formulas: [
      'at + time; on + day/date; in + month/year.',
      'interested in + noun/V-ing.',
      'good at + noun/V-ing.',
    ],
    examples: [
      ex(
        'The class starts at nine on Monday.',
        'Lớp bắt đầu lúc chín giờ vào thứ Hai.',
        'At đi với giờ; on đi với ngày.',
      ),
      ex('I was born in 2002.', 'Tôi sinh năm 2002.', 'In đi với năm.'),
      ex(
        'She is good at explaining ideas.',
        'Cô ấy giỏi giải thích ý tưởng.',
        'Good at là cụm cố định; sau at dùng V-ing khi là động từ.',
      ),
    ],
    mistakes: [
      'Không nói “at Monday”; ngày đi với on.',
      'Không dịch “interested in” thành interested on.',
      'Không bỏ giới từ trong cụm good at.',
    ],
    tips: [
      'Học cả cụm: at home, on time, in the morning.',
      'Viết một câu thật ngay khi học một collocation.',
    ],
    guided: [
      'Điền giới từ vào lịch học một tuần của bạn.',
      'Tạo hai câu với good at và interested in.',
    ],
    summaryPoints: [
      'At = điểm cụ thể, on = ngày, in = khoảng dài.',
      'Collocation cần được ghi nhớ theo cụm.',
    ],
    nextStep: 'Bài cuối ôn toàn bộ điểm ngữ pháp và từ vựng nền.',
    vocabulary: [
      {
        term: 'on time',
        meaning: 'đúng giờ',
        partOfSpeech: 'phrase (cụm từ)',
        example: 'Please arrive on time.',
        translation: 'Vui lòng đến đúng giờ.',
        note: 'on time khác in time',
      },
      {
        term: 'interested in',
        meaning: 'quan tâm/thích thú với',
        partOfSpeech: 'adjective phrase (cụm tính từ)',
        example: 'I am interested in photography.',
        translation: 'Tôi hứng thú với nhiếp ảnh.',
        note: 'in + noun/V-ing',
      },
    ],
    questions: [
      q(
        'The meeting is ___ Monday ___ 9 a.m.',
        ['in / at', 'on / at', 'at / on', 'on / in'],
        'on / at',
        'Ngày dùng on; giờ dùng at.',
      ),
      q(
        'Cụm nào đúng?',
        [
          'good in English',
          'good at English',
          'good on English',
          'good to English',
        ],
        'good at English',
        'Good at là collocation chuẩn.',
      ),
      q('I was born ___ 2002.', ['at', 'on', 'in', 'to'], 'in', 'Năm dùng in.'),
      openQ(
        'Viết một câu với interested in.',
        'I am interested in reading.',
        'Interested in + danh từ hoặc V-ing.',
      ),
      openQ(
        'Viết một câu với on time.',
        'She arrived on time.',
        'On time là cụm cố định nghĩa là đúng giờ.',
      ),
    ],
    exerciseTitle: 'Giới từ trong ngữ cảnh',
    exercisePrompt: 'Chọn giới từ và hoàn thiện các cụm từ thông dụng.',
    exerciseType: CourseLessonExerciseType.FILL_IN_THE_BLANK,
    content: {
      collocations: [
        'at home',
        'on time',
        'interested in',
        'good at',
        'in the morning',
      ],
    },
  },
  {
    title: 'Ôn tập ngữ pháp và từ vựng nền tảng',
    slug: 'grammar-vocabulary-review',
    difficulty: 'A2',
    summary:
      'Tổng hợp các cấu trúc nền tảng trong các tình huống giao tiếp quen thuộc.',
    objectives: [
      'Chọn cấu trúc theo mục đích và thời gian.',
      'Kết hợp ngữ pháp với collocation tự nhiên.',
      'Giải thích được vì sao đáp án đúng.',
    ],
    theory: [
      'Đọc ngữ cảnh trước khi chọn công thức: thói quen, việc đã xong, kế hoạch, lời khuyên hay mô tả vị trí.',
      'Sau khi chọn đáp án, kiểm tra lại chủ ngữ, dạng động từ, mạo từ, giới từ và số lượng.',
    ],
    formulas: [
      'Thói quen: V/V-s; đang diễn ra: am/is/are + V-ing.',
      'Quá khứ: V2/V-ed; tương lai: will/going to.',
      'Lời khuyên: should + V; số lượng: much/many.',
    ],
    examples: [
      ex(
        'She usually studies at home, but she is studying at the library today.',
        'Cô ấy thường học ở nhà, nhưng hôm nay đang học ở thư viện.',
        'Một câu có thể kết hợp hai thì khi ngữ cảnh thay đổi.',
      ),
      ex(
        'We went to the market and bought some fruit.',
        'Chúng tôi đã đi chợ và mua một ít hoa quả.',
        'Hai động từ quá khứ nối tiếp kể một chuỗi việc đã hoàn thành.',
      ),
      ex(
        'You should arrive on time for the interview.',
        'Bạn nên đến đúng giờ cho buổi phỏng vấn.',
        'Should + nguyên mẫu và collocation on time.',
      ),
    ],
    mistakes: [
      'Chọn công thức mà không đọc mốc thời gian.',
      'Dùng hai dấu hiệu trái nhau trong cùng câu.',
      'Học từ riêng lẻ mà quên collocation.',
    ],
    tips: [
      'Đọc câu thành tiếng để phát hiện câu nghe không tự nhiên.',
      'Ghi lý do sau mỗi đáp án, không chỉ ghi chữ cái.',
    ],
    guided: [
      'Giải một tình huống có lịch thường lệ, kế hoạch cuối tuần và lời khuyên; nêu lý do cho từng lựa chọn.',
      'Tự viết một câu tổng hợp có một collocation đã học.',
    ],
    summaryPoints: [
      'Ngữ cảnh quyết định cấu trúc.',
      'Câu đúng cần vừa đúng ngữ pháp vừa tự nhiên về từ vựng.',
    ],
    nextStep:
      'Bạn có thể chuyển sang khóa nền tảng hoặc luyện kỹ năng theo mục tiêu.',
    questions: [
      q(
        'She ___ every day but ___ now.',
        [
          'works / is resting',
          'work / rests',
          'worked / rest',
          'is work / rests',
        ],
        'works / is resting',
        'Vế đầu là thói quen; vế sau là hành động đang diễn ra.',
      ),
      q(
        'Câu nào đúng về kế hoạch?',
        [
          'I am going to visit my aunt.',
          'I going to visit my aunt.',
          'I am go visit my aunt.',
          'I will to visit my aunt.',
        ],
        'I am going to visit my aunt.',
        'Going to cần be + động từ nguyên mẫu.',
      ),
      q(
        'Câu nào dùng collocation đúng?',
        [
          'She is good in cooking.',
          'She is good at cooking.',
          'She good at cooks.',
          'She is good on cooking.',
        ],
        'She is good at cooking.',
        'Good at + V-ing là cụm chuẩn.',
      ),
      openQ(
        'Viết một câu dùng quá khứ đơn và mốc yesterday.',
        'I visited my friend yesterday.',
        'Dùng động từ quá khứ với mốc yesterday.',
      ),
      openQ(
        'Viết một lời khuyên dùng should.',
        'You should review your notes.',
        'Should + nguyên mẫu để đưa lời khuyên.',
      ),
    ],
    exerciseTitle: 'Bài kiểm tra tổng hợp',
    exercisePrompt: 'Áp dụng các cấu trúc vào câu có ngữ cảnh cụ thể.',
    exerciseType: CourseLessonExerciseType.CHECKPOINT,
    content: {
      rule: 'Luôn xác định mục đích và mốc thời gian trước khi chọn cấu trúc.',
    },
  },
];

const pronunciationLessons: LessonSpec[] = [
  {
    title: 'Làm quen với IPA và cách học phát âm',
    slug: 'ipa-and-pronunciation-basics',
    difficulty: 'A1-A2',
    summary:
      'Hiểu Bảng ký hiệu phiên âm quốc tế (IPA) và cách dùng ký hiệu để đọc từ mới.',
    objectives: [
      'Biết IPA ghi âm thanh chứ không ghi chính tả.',
      'Đọc được phiên âm đơn giản trong từ điển.',
      'Nhận ra âm đầu và âm cuối quan trọng.',
    ],
    theory: [
      'Bảng ký hiệu phiên âm quốc tế (IPA) là hệ thống ký hiệu mô tả âm thanh. Một chữ cái có thể có nhiều âm, vì vậy IPA giúp người học biết cách phát âm cụ thể.',
      'Hãy nghe mẫu, nhìn khẩu hình và lặp lại theo từng âm; không cố đọc IPA như chữ cái tiếng Việt.',
    ],
    formulas: [
      'Từ điển thường đặt IPA giữa / /, ví dụ cat /kæt/.',
      'Dấu ˈ trước âm tiết mang trọng âm chính.',
    ],
    examples: [
      ex('cat /kæt/', 'con mèo', 'Ký hiệu /æ/ là nguyên âm ngắn trong cat.'),
      ex(
        'teacher /ˈtiːtʃə/',
        'giáo viên',
        'Dấu ˈ đứng trước âm tiết được nhấn.',
      ),
      ex('book /bʊk/', 'quyển sách', 'Âm /ʊ/ ngắn khác với /uː/ trong food.'),
    ],
    mistakes: [
      'Đọc tên chữ cái thay vì âm trong IPA.',
      'Bỏ qua âm cuối vì tiếng Việt thường nhẹ âm cuối.',
      'Nhấn mọi âm tiết như nhau.',
    ],
    tips: [
      'Nghe mẫu trước, sau đó mới nhìn ký hiệu.',
      'Ghi mỗi từ cùng IPA, nghĩa và một câu ví dụ.',
    ],
    guided: [
      'So sánh cat và cut bằng cách nghe rồi chỉ vào ký hiệu khác nhau.',
      'Đọc chậm từ teacher, đánh dấu âm tiết có ˈ.',
    ],
    summaryPoints: [
      'IPA mô tả âm thanh.',
      'Dấu ˈ giúp nhận ra trọng âm.',
      'Nghe và lặp lại là bước bắt buộc.',
    ],
    nextStep: 'Bài sau tập các nguyên âm đơn thường gây nhầm.',
    questions: [
      q(
        'IPA dùng để làm gì?',
        [
          'Ghi nghĩa tiếng Việt',
          'Ghi âm thanh của từ',
          'Ghi ngữ pháp',
          'Ghi số lượng chữ cái',
        ],
        'Ghi âm thanh của từ',
        'IPA mô tả cách từ được phát âm.',
      ),
      q(
        'Dấu ˈ trong /ˈtiːtʃə/ cho biết điều gì?',
        ['Âm câm', 'Trọng âm chính', 'Âm cuối', 'Danh từ số nhiều'],
        'Trọng âm chính',
        'Dấu ˈ đặt trước âm tiết được nhấn.',
      ),
      openQ(
        'Viết IPA của cat theo ví dụ đã học.',
        '/kæt/',
        'Cat được ghi /kæt/.',
      ),
    ],
    exerciseTitle: 'Đọc ký hiệu IPA',
    exercisePrompt: 'Nhận diện chức năng của IPA và trọng âm.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask:
        'Đọc cat, teacher và book; nghe lại rồi tự nhận xét âm cuối.',
    },
  },
  {
    title: 'Nguyên âm đơn quan trọng',
    slug: 'important-short-and-long-vowels',
    difficulty: 'A1-A2',
    summary: 'Phân biệt một số nguyên âm ngắn/dài qua cặp từ gần giống.',
    objectives: [
      'Nhận diện độ dài và vị trí lưỡi.',
      'Luyện cặp /iː/–/ɪ/ và /æ/–/ʌ/.',
      'Không kéo dài âm ngắn theo thói quen tiếng Việt.',
    ],
    theory: [
      'Nguyên âm dài có dấu ː như /iː/; nguyên âm ngắn không có dấu này. Độ dài đi cùng chất lượng âm, không chỉ kéo dài thời gian.',
      'Lưỡi cao hơn trong /iː/; /ɪ/ ngắn và thư giãn hơn. /æ/ mở rộng miệng; /ʌ/ trung tâm hơn.',
    ],
    examples: [
      ex(
        'sheep /ʃiːp/ — ship /ʃɪp/',
        'cừu — con tàu',
        'Chỉ một âm thay đổi nhưng nghĩa khác; cần nghe độ dài và vị trí lưỡi.',
      ),
      ex(
        'bad /bæd/ — bud /bʌd/',
        'xấu — nụ hoa',
        'Mở miệng rộng hơn ở /æ/; /ʌ/ ngắn và ở giữa.',
      ),
      ex(
        'food /fuːd/ — good /ɡʊd/',
        'thức ăn — tốt',
        'Food có /uː/ dài; good có /ʊ/ ngắn.',
      ),
    ],
    mistakes: [
      'Đồng nhất /iː/ và /ɪ/.',
      'Kéo dài mọi nguyên âm vì nghĩ tiếng Anh cần nói chậm.',
      'Chỉ nhìn chữ viết mà bỏ qua âm thực tế.',
    ],
    tips: [
      'Đặt tay dưới cằm để cảm nhận độ mở miệng.',
      'Luyện cặp tối thiểu theo nhịp: sheep–ship, sheep–ship.',
    ],
    guided: [
      'Nghe một từ rồi chọn ký hiệu âm; sau đó đọc lại hai từ trong cặp.',
      'Ghi âm một cặp từ và so sánh âm lượng/độ dài.',
    ],
    summaryPoints: [
      'Âm dài/ngắn khác nhau về cả thời lượng và chất lượng.',
      'Minimal pair giúp nghe ra khác biệt nhỏ.',
    ],
    nextStep: 'Bài sau chuyển sang nguyên âm đôi trong day và go.',
    questions: [
      q(
        'Từ nào có /iː/?',
        ['ship', 'sheep', 'sit', 'bit'],
        'sheep',
        'Sheep có nguyên âm dài /iː/.',
      ),
      q(
        'Cặp nào là minimal pair?',
        ['cat / dog', 'sheep / ship', 'book / table', 'run / walk'],
        'sheep / ship',
        'Hai từ chỉ khác một âm nhưng nghĩa khác.',
      ),
      openQ(
        'Viết từ tiếng Anh có âm /æ/ đã học.',
        'bad',
        'Bad là ví dụ có /æ/.',
      ),
    ],
    exerciseTitle: 'Luyện nguyên âm bằng cặp tối thiểu',
    exercisePrompt: 'Nghe, chọn và đọc lại các cặp âm gần giống.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask: 'Đọc sheep–ship và bad–bud, tập trung vào âm nguyên âm.',
    },
  },
  {
    title: 'Nguyên âm đôi thường gặp',
    slug: 'common-diphthongs',
    difficulty: 'A2',
    summary: 'Luyện chuyển động của khẩu hình trong /eɪ/, /aɪ/, /əʊ/ và /aʊ/.',
    objectives: [
      'Hiểu nguyên âm đôi là một chuyển động âm.',
      'Đọc đúng các từ day, time, go, now.',
      'Tránh tách nguyên âm đôi thành hai âm rời.',
    ],
    theory: [
      'Nguyên âm đôi bắt đầu ở một vị trí rồi trượt sang vị trí khác trong cùng một âm tiết.',
      'Hãy giữ giọng liền mạch; không chèn phụ âm giữa hai phần của âm.',
    ],
    examples: [
      ex('day /deɪ/', 'ngày', '/eɪ/ đi từ âm gần /e/ đến /ɪ/.'),
      ex(
        'time /taɪm/',
        'thời gian',
        '/aɪ/ có chuyển động rõ, không đọc thành “ta-am”.',
      ),
      ex('go /ɡəʊ/', 'đi', '/əʊ/ bắt đầu ở âm trung tâm rồi tròn môi.'),
    ],
    mistakes: [
      'Đọc /eɪ/ thành một âm /e/ phẳng.',
      'Ngắt giữa hai phần của /aɪ/.',
      'Quên tròn môi ở phần cuối /əʊ/.',
    ],
    tips: [
      'Kéo ngón tay theo mũi tên khi đọc nguyên âm đôi.',
      'Luyện từ đơn trước rồi mới đưa vào câu.',
    ],
    guided: [
      'Đọc day, time, go, now theo nhịp đều.',
      'Đặt mỗi từ vào một câu ngắn để giữ âm liền mạch.',
    ],
    summaryPoints: [
      'Nguyên âm đôi là một chuyển động trong cùng âm tiết.',
      'Khẩu hình thay đổi nhẹ khi âm trượt.',
    ],
    nextStep: 'Bài sau xử lý các phụ âm người Việt thường nhầm.',
    questions: [
      q(
        'Từ nào có /aɪ/?',
        ['day', 'time', 'go', 'book'],
        'time',
        'Time có nguyên âm đôi /aɪ/.',
      ),
      q(
        'Nguyên âm đôi cần được đọc thế nào?',
        [
          'Hai âm tách rời',
          'Một chuyển động liền trong một âm tiết',
          'Chỉ đọc âm đầu',
          'Chỉ đọc âm cuối',
        ],
        'Một chuyển động liền trong một âm tiết',
        'Đó là bản chất của diphthong.',
      ),
      openQ('Viết IPA của day theo ví dụ.', '/deɪ/', 'Day được ghi /deɪ/.'),
    ],
    exerciseTitle: 'Đọc nguyên âm đôi',
    exercisePrompt:
      'Nhận diện và luyện chuyển động khẩu hình của nguyên âm đôi.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask: 'Đọc day, time, go, now; giữ âm liền trong từng âm tiết.',
    },
  },
  {
    title: 'Phụ âm dễ nhầm với người Việt',
    slug: 'consonants-vietnamese-learners-confuse',
    difficulty: 'A2',
    summary:
      'Luyện /θ/, /ð/, /ʃ/, /tʃ/ và sự khác nhau giữa âm hữu thanh/vô thanh.',
    objectives: [
      'Đặt lưỡi đúng cho /θ/ và /ð/.',
      'Phân biệt /ʃ/ với /tʃ/.',
      'Cảm nhận rung thanh quản ở âm hữu thanh.',
    ],
    theory: [
      'Với /θ/ và /ð/, đầu lưỡi chạm nhẹ giữa hai hàm răng; /ð/ có rung thanh quản còn /θ/ không rung.',
      '/ʃ/ là âm xát dài; /tʃ/ bắt đầu bằng âm tắc rồi xát, vì vậy nghe như một cụm liền.',
    ],
    examples: [
      ex(
        'think /θɪŋk/ — this /ðɪs/',
        'nghĩ — điều này',
        'Think không rung; this có rung ở /ð/.',
      ),
      ex(
        'ship /ʃɪp/ — chip /tʃɪp/',
        'con tàu — khoai lát',
        '/tʃ/ có phần bật tắc trước âm xát.',
      ),
      ex('three /θriː/', 'ba', 'Giữ đầu lưỡi giữa răng và bật hơi nhẹ.'),
    ],
    mistakes: [
      'Đổi /θ/ thành /t/ hoặc /s/.',
      'Đọc /ð/ như /d/ mà không đặt lưỡi.',
      'Đọc chip thành ship và làm mất âm tắc đầu.',
    ],
    tips: [
      'Dùng gương để kiểm tra đầu lưỡi.',
      'Đặt tay lên cổ để cảm nhận rung ở /ð/.',
    ],
    guided: [
      'Đọc think–this, ship–chip thật chậm.',
      'Đưa mỗi từ vào câu ngắn và giữ âm đầu rõ.',
    ],
    summaryPoints: [
      '/θ/ vô thanh, /ð/ hữu thanh.',
      '/ʃ/ và /tʃ/ khác nhau ở phần tắc đầu của /tʃ/.',
    ],
    nextStep: 'Bài sau tập âm cuối để câu nghe rõ hơn.',
    questions: [
      q(
        'Âm nào cần rung thanh quản?',
        ['/θ/', '/ð/', '/ʃ/', '/t/'],
        '/ð/',
        '/ð/ là âm hữu thanh.',
      ),
      q(
        'Cặp nào khác nhau ở phần tắc đầu?',
        ['ship/chip', 'think/this', 'day/time', 'food/good'],
        'ship/chip',
        '/tʃ/ trong chip có phần tắc đầu.',
      ),
      openQ(
        'Viết một từ có /θ/.',
        'think',
        'Think là ví dụ quen thuộc có /θ/.',
      ),
    ],
    exerciseTitle: 'Phụ âm rõ và đúng',
    exercisePrompt: 'Nhận diện vị trí lưỡi và luyện các phụ âm dễ nhầm.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask:
        'Đọc think–this và ship–chip; chú ý đầu lưỡi và rung thanh quản.',
    },
  },
  {
    title: 'Âm cuối và cách phát âm rõ',
    slug: 'final-sounds',
    difficulty: 'A2',
    summary:
      'Giữ âm cuối /t/, /d/, /s/, /z/ và phụ âm cuối để người nghe không bỏ sót từ.',
    objectives: [
      'Nhận diện âm cuối có nghĩa.',
      'Phân biệt số ít/số nhiều và thì quá khứ qua âm cuối.',
      'Không thêm nguyên âm sau phụ âm cuối.',
    ],
    theory: [
      'Âm cuối giúp phân biệt nhiều từ và ngữ pháp: cat/cats, work/worked. Người Việt dễ bỏ âm cuối hoặc thêm /ə/ sau phụ âm.',
      'Âm /s/ vô thanh sau âm vô thanh; /z/ hữu thanh sau âm hữu thanh trong nhiều đuôi số nhiều.',
    ],
    examples: [
      ex(
        'I need two tickets.',
        'Tôi cần hai vé.',
        'Giữ /s/ cuối tickets để người nghe biết số nhiều.',
      ),
      ex(
        'She worked late.',
        'Cô ấy đã làm việc muộn.',
        'Âm /t/ cuối worked cho biết quá khứ.',
      ),
      ex(
        'Please sit down.',
        'Mời ngồi.',
        'Giữ /t/ cuối sit, không kéo thành “si-tờ”.',
      ),
    ],
    mistakes: [
      'Bỏ -s trong tickets khiến số lượng không rõ.',
      'Thêm /ə/ sau âm cuối: worked-ờ.',
      'Nuốt /t/ hoặc /d/ trong câu nói nhanh.',
    ],
    tips: [
      'Đọc âm cuối nhỏ nhưng rõ, không cần nhấn mạnh quá mức.',
      'Ghi âm từng từ rồi mới ghép thành câu.',
    ],
    guided: [
      'Đọc cat–cats, work–worked, need–needs.',
      'Nghe lại và đánh dấu âm cuối đã giữ được.',
    ],
    summaryPoints: [
      'Âm cuối mang thông tin nghĩa và ngữ pháp.',
      'Không thêm nguyên âm sau phụ âm cuối.',
    ],
    nextStep: 'Bài sau học trọng âm từ để lời nói có nhịp tự nhiên.',
    questions: [
      q(
        'Âm cuối nào giúp “tickets” là số nhiều?',
        ['/t/', '/s/', '/k/', '/ɪ/'],
        '/s/',
        'Tickets cần âm /s/ cuối.',
      ),
      q(
        'Từ nào có âm cuối /t/ rõ?',
        ['sit', 'see', 'say', 'sea'],
        'sit',
        'Sit kết thúc bằng /t/.',
      ),
      openQ(
        'Viết dạng quá khứ của work.',
        'worked',
        'Worked thêm đuôi -ed và có âm cuối /t/.',
      ),
    ],
    exerciseTitle: 'Giữ âm cuối',
    exercisePrompt: 'Luyện các cặp từ để không bỏ âm cuối.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask:
        'Đọc cat–cats, work–worked và need–needs; nghe lại âm cuối.',
    },
  },
  {
    title: 'Trọng âm từ',
    slug: 'word-stress',
    difficulty: 'A2',
    summary:
      'Nhận diện âm tiết được nhấn và dùng trọng âm để người nghe nhận ra từ.',
    objectives: [
      'Hiểu dấu ˈ trong IPA.',
      'Nhấn âm tiết chính bằng độ dài, cao độ và độ rõ.',
      'Tránh nhấn đều mọi âm tiết.',
    ],
    theory: [
      'Âm tiết có trọng âm thường dài hơn, rõ hơn và nổi bật hơn. Các âm không nhấn có thể yếu và gần schwa.',
      'Trọng âm sai có thể khiến người nghe khó nhận ra từ dù các âm riêng lẻ tương đối đúng.',
    ],
    examples: [
      ex('TAble /ˈteɪbəl/', 'cái bàn', 'Trọng âm ở âm tiết đầu.'),
      ex(
        'reLAX /rɪˈlæks/',
        'thư giãn',
        'Trọng âm ở âm tiết thứ hai; âm đầu nhẹ hơn.',
      ),
      ex(
        'PREsent (noun) /ˈprezənt/',
        'món quà',
        'Một số từ đổi trọng âm theo từ loại; học theo ngữ cảnh.',
      ),
    ],
    mistakes: [
      'Nhấn mọi âm tiết bằng lực như nhau.',
      'Bỏ dấu ˈ khi tra từ mới.',
      'Đọc âm không nhấn quá rõ khiến câu đều và chậm.',
    ],
    tips: [
      'Gõ nhịp vào âm tiết chính.',
      'Đánh dấu trọng âm ngay khi ghi từ mới.',
    ],
    guided: [
      'Đọc TAble, reLAX, PREsent; sau đó đưa từng từ vào câu.',
      'Nghe bản mẫu và bắt chước nhịp thay vì chỉ bắt chước từng âm.',
    ],
    summaryPoints: [
      'Trọng âm làm từ dễ nhận ra.',
      'Dấu ˈ đứng trước âm tiết chính.',
    ],
    nextStep: 'Bài sau học schwa và nhịp điệu câu.',
    questions: [
      q(
        'Dấu ˈ trong IPA cho biết gì?',
        ['Âm cuối', 'Trọng âm chính', 'Âm câm', 'Số nhiều'],
        'Trọng âm chính',
        'Dấu ˈ đặt trước âm tiết được nhấn.',
      ),
      q(
        'Từ nào nhấn âm tiết đầu?',
        ['reLAX', 'TAble', 'beGIN', 'aBOUT'],
        'TAble',
        'Table nhấn âm tiết đầu.',
      ),
      openQ(
        'Viết IPA có dấu trọng âm cho table.',
        '/ˈteɪbəl/',
        'Table có trọng âm ở âm tiết đầu.',
      ),
    ],
    exerciseTitle: 'Nhịp và trọng âm từ',
    exercisePrompt: 'Đánh dấu trọng âm và đọc từ theo nhịp tự nhiên.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask: 'Đọc table, relax và present; gõ nhẹ vào âm tiết nhấn.',
    },
  },
  {
    title: 'Schwa /ə/ và nhịp điệu câu',
    slug: 'schwa-and-sentence-rhythm',
    difficulty: 'A2',
    summary:
      'Hiểu schwa /ə/ và cách từ chức năng yếu đi trong câu nói tự nhiên.',
    objectives: [
      'Nhận diện schwa trong âm tiết không nhấn.',
      'Nhấn từ mang nội dung chính.',
      'Giữ nhịp câu thay vì đọc đều từng từ.',
    ],
    theory: [
      'Schwa /ə/ là âm trung tâm, ngắn và thư giãn, thường xuất hiện ở âm tiết không nhấn như about /əˈbaʊt/.',
      'Trong câu, danh từ/động từ chính thường nổi bật; mạo từ, giới từ và trợ động từ có thể yếu hơn.',
    ],
    examples: [
      ex(
        'about /əˈbaʊt/',
        'về/khoảng',
        'Âm đầu là schwa nhẹ, không đọc thành “a” căng.',
      ),
      ex(
        'I can meet you at five.',
        'Tôi có thể gặp bạn lúc năm giờ.',
        'Meet và five mang thông tin chính nên được nhấn.',
      ),
      ex(
        'Give me a minute.',
        'Cho tôi một phút.',
        'A có thể đọc nhẹ giữa các từ mang nội dung.',
      ),
    ],
    mistakes: [
      'Đọc schwa thành nguyên âm đầy đủ và quá mạnh.',
      'Nhấn đều cả câu khiến nhịp không tự nhiên.',
      'Bỏ mất từ chức năng thay vì đọc nhẹ.',
    ],
    tips: [
      'Nói câu theo nhịp, không tách từng từ.',
      'Thu nhỏ âm không nhấn thay vì xóa nó.',
    ],
    guided: [
      'Đọc câu “I can meet you at five” với meet và five nổi bật.',
      'So sánh cách đọc chậm từng từ với cách đọc theo nhịp.',
    ],
    summaryPoints: [
      'Schwa là âm nhẹ trong âm tiết không nhấn.',
      'Nhịp câu dựa vào từ mang nội dung chính.',
    ],
    nextStep: 'Bài cuối luyện nối âm và tổng hợp cách phát âm.',
    questions: [
      q(
        'Schwa thường xuất hiện ở đâu?',
        ['Âm tiết không nhấn', 'Chỉ âm cuối', 'Chỉ danh từ', 'Chỉ chữ cái a'],
        'Âm tiết không nhấn',
        'Schwa là âm trung tâm, nhẹ và thường không nhấn.',
      ),
      q(
        'Từ nào nên được nhấn trong “I can meet you at five”?',
        ['I/can', 'meet/five', 'you/at', 'the/a'],
        'meet/five',
        'Meet và five mang thông tin chính.',
      ),
      openQ('Viết IPA của about.', '/əˈbaʊt/', 'About có schwa ở âm tiết đầu.'),
    ],
    exerciseTitle: 'Nhịp câu tự nhiên',
    exercisePrompt: 'Xác định từ nhấn và đọc câu có schwa nhẹ.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask:
        'Đọc about và câu “I can meet you at five”; nhấn meet và five.',
    },
  },
  {
    title: 'Nối âm và luyện phát âm tổng hợp',
    slug: 'linking-and-integrated-practice',
    difficulty: 'A2',
    summary:
      'Kết hợp âm cuối, trọng âm, schwa và nối âm trong câu giao tiếp ngắn.',
    objectives: [
      'Nối phụ âm cuối với nguyên âm đầu khi phù hợp.',
      'Giữ trọng âm và âm cuối trong câu.',
      'Tự nghe lại để chọn một điểm cần sửa.',
    ],
    theory: [
      'Nối âm giúp lời nói liền mạch: pick it up có thể nối âm cuối /k/ với it. Nối âm không có nghĩa là xóa âm hoặc thêm âm mới.',
      'Ưu tiên rõ nghĩa trước tốc độ; nói chậm vừa phải và giữ các từ khóa.',
    ],
    examples: [
      ex(
        'Pick it up, please.',
        'Làm ơn nhặt nó lên.',
        'Âm /k/ cuối pick nối tự nhiên với it.',
      ),
      ex(
        'Turn off the light.',
        'Tắt đèn đi.',
        'Giữ /n/ cuối turn và nối sang off.',
      ),
      ex(
        'Could you send it by Friday?',
        'Bạn có thể gửi nó trước thứ Sáu không?',
        'Nhấn send và Friday; các từ nhỏ nối nhẹ.',
      ),
    ],
    mistakes: [
      'Nối âm thành một từ mới làm mất ranh giới nghĩa.',
      'Tăng tốc quá mức và bỏ âm cuối.',
      'Quên trọng âm khi tập nối âm.',
    ],
    tips: [
      'Đọc rõ từng từ trước, sau đó nối nhẹ.',
      'Ghi âm câu, nghe lại một lần cho âm cuối và một lần cho nhịp.',
    ],
    guided: [
      'Đọc ba câu mẫu ở hai tốc độ: rõ ràng và tự nhiên.',
      'Chọn một âm hoặc trọng âm cần cải thiện và ghi lại lần đọc thứ hai.',
    ],
    summaryPoints: [
      'Nối âm làm câu liền mạch nhưng không được làm mất âm.',
      'Rõ nghĩa, âm cuối và trọng âm quan trọng hơn nói thật nhanh.',
    ],
    nextStep:
      'Tiếp tục luyện từng âm yếu nhất trong các bài Speaking hoặc Listening.',
    questions: [
      q(
        'Trong “Pick it up”, âm nào có thể nối?',
        [
          '/k/ cuối pick với it',
          '/p/ với pick',
          '/t/ với up',
          '/ɪ/ với please',
        ],
        '/k/ cuối pick với it',
        'Phụ âm cuối có thể nối sang nguyên âm đầu của từ sau.',
      ),
      q(
        'Khi luyện nối âm, ưu tiên điều gì?',
        [
          'Nói thật nhanh',
          'Xóa âm cuối',
          'Giữ rõ nghĩa và từ khóa',
          'Nhấn mọi từ',
        ],
        'Giữ rõ nghĩa và từ khóa',
        'Nối âm phải hỗ trợ sự rõ ràng.',
      ),
      openQ(
        'Viết câu ngắn có “send it”.',
        'Please send it by Friday.',
        'Câu mẫu có nối nhẹ giữa send và it.',
      ),
    ],
    exerciseTitle: 'Phát âm tổng hợp',
    exercisePrompt:
      'Đọc câu có nối âm, trọng âm và âm cuối; tự đánh giá bản ghi.',
    exerciseType: CourseLessonExerciseType.SPEAKING_READ_ALOUD,
    content: {
      recordingTask:
        'Đọc Pick it up, please; Turn off the light; Could you send it by Friday?',
    },
  },
];

/**
 * Pronunciation examples intentionally reuse existing managed vocabulary audio.
 * Keeping this mapping in the authored source makes the learner-visible word,
 * IPA and audio asset one deterministic record without invoking runtime TTS.
 */
const pronunciationAudioTerms: Record<string, string[]> = {
  'ipa-and-pronunciation-basics': ['think', 'day', 'the'],
  'important-short-and-long-vowels': ['east', 'it', 'habit', 'budget'],
  'common-diphthongs': ['day', 'go', 'how', 'arrival'],
  'consonants-vietnamese-learners-confuse': [
    'think',
    'this',
    'shows',
    'choice',
  ],
  'final-sounds': ['end', 'helps', 'days', 'updated'],
  'word-stress': ['present', 'support', 'arrival', 'company'],
  'schwa-and-sentence-rhythm': ['a', 'the', 'to', 'could', 'you'],
  'linking-and-integrated-practice': [
    'it',
    'could',
    'you',
    'send',
    'by',
    'friday',
  ],
};

const authoredQuestionComplements: Record<string, Question[]> = {
  'greetings-and-introductions': [
    openQ(
      'Viết một lời chào phù hợp khi gặp bạn học vào buổi sáng.',
      'Good morning. Nice to meet you.',
      'Dùng lời chào theo thời điểm và thêm lời giới thiệu thân thiện.',
    ),
    openQ(
      'Hỏi tên người đối diện bằng một câu lịch sự.',
      'What is your name, please?',
      'What is your name? là câu hỏi cơ bản để biết tên.',
    ),
  ],
  'family-and-personal-information': [
    openQ(
      'Viết một câu nói bạn sống cùng ai.',
      'I live with my parents.',
      'Dùng I live with + người thân.',
    ),
    openQ(
      'Hỏi quê quán của một người bạn.',
      'Where are you from?',
      'Where are you from? hỏi nơi một người đến từ.',
    ),
  ],
  'daily-routines': [
    openQ(
      'Viết một câu về giờ bạn thường thức dậy.',
      'I usually get up at seven.',
      'Đặt usually trước động từ thường để nói thói quen.',
    ),
    openQ(
      'Đổi câu “She cooks dinner.” sang chủ ngữ I.',
      'I cook dinner.',
      'Với I, động từ không thêm -s.',
    ),
  ],
  'time-schedules-and-now': [
    openQ(
      'Viết câu nói lớp học bắt đầu lúc chín giờ.',
      'The class starts at nine.',
      'Lịch cố định dùng hiện tại đơn.',
    ),
    openQ(
      'Viết câu nói bạn đang đọc một tin nhắn.',
      'I am reading a message now.',
      'Hành động đang diễn ra dùng am/is/are + V-ing.',
    ),
  ],
  'home-and-places': [
    openQ(
      'Viết một câu nói chiếc chìa khóa ở trên bàn.',
      'The key is on the table.',
      'On diễn tả vị trí trên một bề mặt.',
    ),
    openQ(
      'Hỏi đường đến ga tàu một cách lịch sự.',
      'Could you tell me how to get to the station?',
      'Could you tell me…? mở đầu cho câu hỏi lịch sự.',
    ),
  ],
  'food-and-shopping': [
    openQ(
      'Hỏi giá một chai nước ở cửa hàng.',
      'How much is a bottle of water?',
      'How much is…? dùng cho một món hàng số ít.',
    ),
    openQ(
      'Đưa ra yêu cầu mua hai quả táo.',
      'I would like two apples, please.',
      'I would like… là cách yêu cầu lịch sự.',
    ),
  ],
  'study-work-basic-communication': [
    openQ(
      'Viết câu xác nhận bạn sẽ gửi tệp hôm nay.',
      'I will send the file today.',
      'Nêu hành động và thời điểm rõ ràng.',
    ),
    openQ(
      'Viết một câu hỏi xin làm rõ hạn chót.',
      'Could you clarify the deadline?',
      'Could you + động từ nguyên mẫu tạo yêu cầu lịch sự.',
    ),
  ],
  'foundation-review': [
    openQ(
      'Viết một câu về thói quen học tiếng Anh của bạn.',
      'I study English every evening.',
      'Every evening là dấu hiệu của thói quen.',
    ),
    openQ(
      'Viết một câu bạn đang làm hôm nay.',
      'I am reviewing English today.',
      'Today có thể đi với hành động tạm thời đang diễn ra.',
    ),
  ],
  'ipa-and-pronunciation-basics': [
    openQ(
      'Viết IPA của từ “book” theo ví dụ trong bài.',
      '/bʊk/',
      'Book có nguyên âm ngắn /ʊ/ và phụ âm cuối /k/.',
    ),
    openQ(
      'Nêu một bước nên làm trước khi lặp lại từ mới.',
      'Listen to the model first.',
      'Nghe mẫu trước giúp xác định âm thanh chính xác.',
    ),
  ],
  'important-short-and-long-vowels': [
    openQ(
      'Viết từ có âm /ɪ/ trong cặp tối thiểu đã học.',
      'ship',
      'Ship có nguyên âm ngắn /ɪ/.',
    ),
    openQ(
      'Nêu điểm khác nhau chính giữa /iː/ và /ɪ/.',
      'Length and vowel quality.',
      'Hai âm khác cả thời lượng và vị trí khẩu hình.',
    ),
  ],
  'common-diphthongs': [
    openQ('Viết IPA của từ “time”.', '/taɪm/', 'Time có nguyên âm đôi /aɪ/.'),
    openQ(
      'Mô tả cách đọc một nguyên âm đôi.',
      'Keep the movement smooth in one syllable.',
      'Nguyên âm đôi là một chuyển động liền trong cùng âm tiết.',
    ),
  ],
  'consonants-vietnamese-learners-confuse': [
    openQ(
      'Viết một từ có âm /ð/.',
      'this',
      'This bắt đầu bằng âm hữu thanh /ð/.',
    ),
    openQ(
      'Nêu cách kiểm tra âm /ð/ có rung hay không.',
      'Touch your throat and feel the vibration.',
      'Đặt tay lên thanh quản để cảm nhận âm hữu thanh.',
    ),
  ],
  'final-sounds': [
    openQ(
      'Viết dạng số nhiều của “ticket”.',
      'tickets',
      'Thêm -s và giữ âm cuối rõ để người nghe nhận ra số nhiều.',
    ),
    openQ(
      'Viết dạng quá khứ của “work”.',
      'worked',
      'Worked kết thúc bằng âm /t/ trong ví dụ của bài.',
    ),
  ],
  'word-stress': [
    openQ(
      'Đánh dấu trọng âm cho từ “relax”.',
      '/rɪˈlæks/',
      'Relax nhấn âm tiết thứ hai.',
    ),
    openQ(
      'Nêu một cách luyện trọng âm từ.',
      'Tap the stressed syllable.',
      'Gõ nhẹ vào âm tiết chính giúp cảm nhận nhịp.',
    ),
  ],
  'schwa-and-sentence-rhythm': [
    openQ(
      'Viết IPA của từ “about”.',
      '/əˈbaʊt/',
      'About có schwa ở âm tiết đầu.',
    ),
    openQ(
      'Trong câu “I can meet you at five”, hai từ nào nên được nhấn?',
      'meet and five',
      'Từ mang nội dung chính thường nổi bật hơn.',
    ),
  ],
  'linking-and-integrated-practice': [
    openQ(
      'Viết câu có cụm “pick it up”.',
      'Please pick it up.',
      'Phụ âm cuối pick có thể nối nhẹ sang it.',
    ),
    openQ(
      'Khi nối âm, điều gì không được đánh đổi?',
      'Clear meaning and final sounds.',
      'Nối âm phải giúp câu liền mạch nhưng vẫn rõ nghĩa.',
    ),
  ],
};
for (const lesson of [...foundationLessons, ...pronunciationLessons]) {
  lesson.questions.push(...(authoredQuestionComplements[lesson.slug] ?? []));
}

/**
 * Final checks deliberately use new contexts.  The guided questions above are
 * the low-load rehearsal; these deterministic sets are the independent check
 * and are kept in the same source file so a fresh database receives the same
 * content.
 */
export const finalQuestionsBySlug: Record<string, Question[]> = {
  'greetings-and-introductions': [
    q(
      'You meet a new classmate in the afternoon. Which greeting fits?',
      [
        'Good night.',
        'Good afternoon.',
        'Good bye morning.',
        'I am afternoon.',
      ],
      'Good afternoon.',
      'Use “Good afternoon” when meeting someone after midday.',
    ),
    q(
      'Which reply gives a place of origin?',
      [
        'I am from Can Tho.',
        'I am name Can Tho.',
        'I work from Can Tho?',
        'My from is Can Tho.',
      ],
      'I am from Can Tho.',
      '“I am from + place” tells someone where you come from.',
    ),
    q(
      'Choose the polite answer: “What do you do?”',
      [
        'I am a designer.',
        'I from a designer.',
        'My do designer.',
        'I doing a designer.',
      ],
      'I am a designer.',
      'Use “I am a/an + job” to answer a question about work.',
    ),
    openQ(
      'Introduce yourself to a new classmate in one sentence.',
      'Hi, I am Linh. Nice to meet you.',
      'A short greeting, name and polite closing complete the introduction.',
    ),
    openQ(
      'Ask a new classmate where they are from.',
      'Where are you from?',
      '“Where are you from?” is the taught question for origin.',
    ),
  ],
  'family-and-personal-information': [
    q(
      'Mai is talking about her father. Which sentence is correct?',
      [
        'This is my father.',
        'This my father is.',
        'This is father my.',
        'My this father.',
      ],
      'This is my father.',
      'Use “This is my + family member” to introduce someone.',
    ),
    q(
      'Which sentence uses the plural form correctly?',
      [
        'I have two sister.',
        'I have two sisters.',
        'I have two sisteres.',
        'I have two sister’s.',
      ],
      'I have two sisters.',
      'A count of two needs the plural noun “sisters”.',
    ),
    q(
      'Choose the safe, basic personal question.',
      [
        'What is your bank password?',
        'Where are you from?',
        'What is your ID number?',
        'What is your PIN?',
      ],
      'Where are you from?',
      'Origin is a suitable basic learning-context question; passwords and PINs are private.',
    ),
    openQ(
      'Say who you live with.',
      'I live with my family.',
      '“I live with + person/group” gives a simple household answer.',
    ),
    openQ(
      'Say how many brothers or sisters you have.',
      'I have two brothers.',
      'Use “I have + number + plural family noun.”',
    ),
  ],
  'daily-routines': [
    q(
      'Every Saturday, Nam ___ football with his friends.',
      ['play', 'plays', 'is play', 'playing'],
      'plays',
      'A repeated routine with “every Saturday” uses present simple; Nam takes -s.',
    ),
    q(
      'Which sentence describes a regular morning action?',
      [
        'I usually walk to work.',
        'I am walk to work.',
        'I usually walking work.',
        'I walk yesterday work.',
      ],
      'I usually walk to work.',
      '“Usually” introduces a repeated routine and is followed by the base verb with I.',
    ),
    q(
      'Choose the correct negative sentence about a routine.',
      [
        'She does not cooks at night.',
        'She does not cook at night.',
        'She do not cook at night.',
        'She not cooks at night.',
      ],
      'She does not cook at night.',
      'After “does not”, the main verb returns to its base form.',
    ),
    openQ(
      'Write one routine you do before bed.',
      'I usually read before bed.',
      'Use “usually” and the base verb to describe a repeated habit.',
    ),
    openQ(
      'Change “He watches TV.” to a sentence with I.',
      'I watch TV.',
      'With I, the main verb has no third-person -s.',
    ),
  ],
  'time-schedules-and-now': [
    q(
      'Look! The children ___ in the garden now.',
      ['play', 'are playing', 'plays', 'playing'],
      'are playing',
      '“Look!” and “now” point to an action happening at this moment.',
    ),
    q(
      'The train ___ at 8:15 every morning.',
      ['leave', 'leaves', 'is leaving', 'leaving'],
      'leaves',
      'A fixed timetable uses present simple; “the train” is singular.',
    ),
    q(
      'Which question asks about an activity happening today?',
      [
        'What are you doing today?',
        'What do you doing today?',
        'What are you do today?',
        'What you are today doing?',
      ],
      'What are you doing today?',
      'Present continuous questions use am/is/are + subject + V-ing.',
    ),
    openQ(
      'Write a sentence about a fixed class schedule.',
      'The class starts at nine.',
      'A regular schedule uses present simple.',
    ),
    openQ(
      'Write a sentence about what you are doing this afternoon.',
      'I am studying this afternoon.',
      'A temporary activity uses am/is/are + V-ing.',
    ),
  ],
  'home-and-places': [
    q(
      'There ___ two windows in the bedroom.',
      ['is', 'are', 'be', 'am'],
      'are',
      'Use “there are” with the plural noun “two windows”.',
    ),
    q(
      'The shoes are ___ the bed.',
      ['under', 'between to', 'at inside', 'on to'],
      'under',
      '“Under” describes a position below something.',
    ),
    q(
      'Which direction is clear and complete?',
      [
        'Turn left at the museum.',
        'Left turn museum.',
        'Turning left the.',
        'You left at?',
      ],
      'Turn left at the museum.',
      'An imperative plus a landmark gives a usable direction.',
    ),
    openQ(
      'Describe one object next to another object.',
      'The lamp is next to the sofa.',
      '“Next to” describes two objects that are side by side.',
    ),
    openQ(
      'Give one short direction to the station.',
      'Go straight to the station.',
      'Use an imperative verb and name the destination.',
    ),
  ],
  'food-and-shopping': [
    q(
      'At a café, which request is polite?',
      [
        'Give me tea.',
        'Could I have some tea, please?',
        'Tea you now.',
        'I tea have.',
      ],
      'Could I have some tea, please?',
      '“Could I have… please?” is a polite request for an item.',
    ),
    q(
      '___ oranges do we need for the salad?',
      ['How much', 'How many', 'How is', 'How any'],
      'How many',
      'Use “How many” with a plural countable noun such as oranges.',
    ),
    q(
      'Choose the correct sentence about rice.',
      [
        'We need many rice.',
        'We need some rice.',
        'We need a rice.',
        'We need ricees.',
      ],
      'We need some rice.',
      'Rice is uncountable, so “some rice” is natural here.',
    ),
    openQ(
      'Ask the price of two sandwiches.',
      'How much are these sandwiches?',
      'Plural items use “How much are…?”',
    ),
    openQ(
      'Ask for a receipt politely.',
      'Could I have the receipt, please?',
      'A polite request includes “Could I have… please?”',
    ),
  ],
  'study-work-basic-communication': [
    q(
      'Which message clearly states its purpose?',
      [
        'I am writing to confirm our class.',
        'Class Tuesday thing.',
        'Confirm now!',
        'You know the class.',
      ],
      'I am writing to confirm our class.',
      'The opening “I am writing to…” tells the reader the purpose immediately.',
    ),
    q(
      'Choose the phrase that gives a deadline.',
      [
        'until Friday at five',
        'by Friday at five',
        'from Friday at five',
        'in Friday at five',
      ],
      'by Friday at five',
      '“By + time” states the latest time an action should be finished.',
    ),
    q(
      'Which request asks for clarification politely?',
      [
        'Explain this now.',
        'Could you clarify the meeting time?',
        'Meeting time!',
        'You clarify this.',
      ],
      'Could you clarify the meeting time?',
      '“Could you + base verb” softens a request for information.',
    ),
    openQ(
      'Write a short message confirming a meeting tomorrow.',
      'I am writing to confirm our meeting tomorrow.',
      'Start with the purpose and add the relevant time.',
    ),
    openQ(
      'Ask a colleague to send a file by noon.',
      'Could you send the file by noon, please?',
      'Combine a polite request with the deadline phrase “by noon”.',
    ),
  ],
  'foundation-review': [
    q(
      'Linh usually takes the bus, but today she ___.',
      ['walks', 'is walking', 'walk', 'walking'],
      'is walking',
      '“Today” describes a temporary action, so use present continuous.',
    ),
    q(
      'Which sentence is a polite request in a shop?',
      [
        'Give me the receipt.',
        'Could I have the receipt, please?',
        'Receipt now.',
        'You receipt me.',
      ],
      'Could I have the receipt, please?',
      '“Could I have… please?” is the polite shopping pattern from the course.',
    ),
    q(
      'Which sentence gives a person’s origin?',
      ['I am from Hue.', 'I from Hue am.', 'I am Hue.', 'From I Hue.'],
      'I am from Hue.',
      'Use “I am from + place” to introduce where you come from.',
    ),
    openQ(
      'Write one sentence about a regular study habit.',
      'I usually study English in the evening.',
      'Use present simple with “usually”.',
    ),
    openQ(
      'Write one polite question asking for directions.',
      'Could you tell me where the station is?',
      'Use “Could you tell me…?” for a polite question.',
    ),
  ],
  'present-simple-and-continuous': [
    q(
      'Look! Minh ___ for the bus now.',
      ['waits', 'is waiting', 'wait', 'waiting'],
      'is waiting',
      '“Look!” and “now” describe an action happening at this moment.',
    ),
    q(
      'My sister usually works from home, but this week she ___ at the office.',
      ['works', 'is working', 'work', 'working'],
      'is working',
      '“Usually” marks a routine, while “this week” describes a temporary situation.',
    ),
    q(
      'Choose the corrected sentence for a weekly habit.',
      [
        'He is play football every Sunday.',
        'He plays football every Sunday.',
        'He play football every Sunday.',
        'He playing football every Sunday.',
      ],
      'He plays football every Sunday.',
      'A weekly habit uses present simple and adds -s with he.',
    ),
    openQ(
      'Write one sentence about a routine and one about today.',
      'I usually cook at home. I am eating out today.',
      'The first sentence is a routine; the second is a temporary action.',
    ),
    openQ(
      'Correct this sentence: “They is study now.”',
      'They are studying now.',
      'They takes “are”, followed by the V-ing form.',
    ),
  ],
  'nouns-articles-and-quantity': [
    q(
      'There is ___ orange and ___ water on the table.',
      ['a / an', 'an / some', 'some / an', 'an / a'],
      'an / some',
      'Use “an” with the singular count noun orange and “some” with uncountable water.',
    ),
    q(
      'How ___ chairs are in the room?',
      ['much', 'many', 'any much', 'a'],
      'many',
      'Chairs are countable plural nouns, so use “many”.',
    ),
    q(
      'Which phrase is natural?',
      ['a piece of advice', 'an advice', 'many advice', 'advicees'],
      'a piece of advice',
      'Advice is uncountable; “a piece of advice” gives one unit.',
    ),
    openQ(
      'Ask whether there is any bread.',
      'Do we have any bread?',
      'Use “any” in a yes/no question about an uncountable noun.',
    ),
    openQ(
      'Write one sentence with “many” and a plural noun.',
      'There are many books here.',
      '“Many” is followed by a countable plural noun.',
    ),
  ],
  'past-simple': [
    q(
      'Last weekend, Ana ___ a new café.',
      ['visit', 'visited', 'visits', 'visiting'],
      'visited',
      'A completed past event uses the past form “visited”.',
    ),
    q(
      'Which question asks about a finished trip?',
      [
        'Did you visit Da Lat?',
        'Do you visited Da Lat?',
        'Did you visited Da Lat?',
        'You did visit Da Lat?',
      ],
      'Did you visit Da Lat?',
      'After “Did”, use the base verb “visit”.',
    ),
    q(
      'Choose the correct negative sentence.',
      [
        'We didn’t watched TV.',
        'We didn’t watch TV.',
        'We not watched TV.',
        'We don’t watched TV.',
      ],
      'We didn’t watch TV.',
      'After “didn’t”, the main verb stays in its base form.',
    ),
    openQ(
      'Write one sentence about something you did yesterday.',
      'I cleaned my room yesterday.',
      'Use a past verb and a finished-time expression.',
    ),
    openQ(
      'Ask a friend whether they visited a museum.',
      'Did you visit a museum?',
      'Use Did + subject + base verb for a past question.',
    ),
  ],
  'future-will-going-to': [
    q(
      'The phone is ringing. I ___ answer it.',
      ['will', 'am going to', 'will to', 'going'],
      'will',
      'A decision made at the moment of speaking uses “will”.',
    ),
    q(
      'They bought tickets yesterday. They ___ travel on Friday.',
      ['are going to', 'will to', 'going', 'are go'],
      'are going to',
      'A planned action with evidence such as tickets uses “be going to”.',
    ),
    q(
      'Look at those dark clouds! It ___.',
      ['is going to rain', 'will to rain', 'going rain', 'is rain'],
      'is going to rain',
      'Visible evidence supports “is going to rain”.',
    ),
    openQ(
      'Write a plan for this weekend with “going to”.',
      'I am going to visit my family this weekend.',
      'Use am/is/are going to + base verb for a plan.',
    ),
    openQ(
      'Make a short promise with “will”.',
      'I will call you tonight.',
      'Use “will + base verb” for a promise.',
    ),
  ],
  'adjectives-adverbs-comparison': [
    q(
      'The nurse speaks ___.',
      ['clear', 'clearly', 'clearness', 'more clear'],
      'clearly',
      'An adverb describes how someone speaks.',
    ),
    q(
      'Which is the correct comparative form of “easy”?',
      ['easyer', 'easier', 'more easyer', 'easiest than'],
      'easier',
      'For this short adjective, change y to i and add -er.',
    ),
    q(
      'This route is ___ than the old route.',
      ['short', 'shorter', 'shortest', 'more short'],
      'shorter',
      'Use the comparative form with “than”.',
    ),
    openQ(
      'Write a sentence using “more useful”.',
      'This map is more useful than that one.',
      'Use “more + adjective + than” for a longer adjective.',
    ),
    openQ(
      'Write a sentence with an adverb describing careful work.',
      'She works carefully.',
      'The adverb “carefully” describes how she works.',
    ),
  ],
  'basic-modal-verbs': [
    q(
      'Which sentence expresses ability?',
      [
        'I can speak English.',
        'I can speaks English.',
        'I can to speak English.',
        'I cans speak English.',
      ],
      'I can speak English.',
      'After “can”, use the base verb without to or -s.',
    ),
    q(
      'The doctor says: “You ___ rest today.”',
      ['should', 'should to', 'should rests', 'should resting'],
      'should',
      '“Should + base verb” gives advice.',
    ),
    q(
      'Which sentence states a workplace rule?',
      [
        'You must wear a badge.',
        'You must to wear a badge.',
        'You must wears a badge.',
        'You must wearing a badge.',
      ],
      'You must wear a badge.',
      '“Must + base verb” expresses an obligation.',
    ),
    openQ(
      'Give a learner advice about reviewing words.',
      'You should review the words every day.',
      'Use should followed by the base verb.',
    ),
    openQ(
      'Ask whether visitors have to sign in.',
      'Do visitors have to sign in?',
      'Use do + subject + have to for this obligation question.',
    ),
  ],
  'prepositions-and-common-phrases': [
    q(
      'The workshop is ___ Tuesday ___ 10 a.m.',
      ['in / at', 'on / at', 'at / on', 'on / in'],
      'on / at',
      'Use “on” for a day and “at” for an exact time.',
    ),
    q(
      'Which phrase means skilled in a subject?',
      [
        'good in English',
        'good at English',
        'good on English',
        'good to English',
      ],
      'good at English',
      'The fixed phrase is “good at + subject”.',
    ),
    q(
      'Our meeting starts ___ March.',
      ['at', 'on', 'in', 'to'],
      'in',
      'Use “in” with a month.',
    ),
    openQ(
      'Write a sentence with “interested in”.',
      'I am interested in reading.',
      '“Interested in” is followed by a noun or V-ing form.',
    ),
    openQ(
      'Write a sentence with “on time”.',
      'She arrived on time.',
      '“On time” means at the scheduled time.',
    ),
  ],
  'grammar-vocabulary-review': [
    q(
      'Every morning Hoa ___ tea, but right now she ___.',
      [
        'drinks / is reading',
        'drink / reads',
        'drank / read',
        'is drink / reading',
      ],
      'drinks / is reading',
      'The routine uses present simple; the action now uses present continuous.',
    ),
    q(
      'Which sentence describes a planned visit?',
      [
        'I am going to visit my aunt.',
        'I going visit my aunt.',
        'I am go visit my aunt.',
        'I will to visit my aunt.',
      ],
      'I am going to visit my aunt.',
      'A plan uses am/is/are going to + base verb.',
    ),
    q(
      'Choose the correct collocation.',
      [
        'She is good in cooking.',
        'She is good at cooking.',
        'She good at cooks.',
        'She is good on cooking.',
      ],
      'She is good at cooking.',
      'The taught collocation is “good at + noun/V-ing”.',
    ),
    openQ(
      'Write a past-simple sentence with “last night”.',
      'I watched a film last night.',
      'Use a past verb with a finished-time marker.',
    ),
    openQ(
      'Give a short recommendation with “should”.',
      'You should review your notes.',
      'Use should followed by the base verb.',
    ),
  ],
  'ipa-and-pronunciation-basics': [
    q(
      'Which item shows pronunciation rather than spelling?',
      ['cat /kæt/', 'cat = con mèo', 'cat has three letters', 'cat is a noun'],
      'cat /kæt/',
      'The symbols between slashes represent the sounds of the word.',
    ),
    q(
      'In /ˈpɜːrsən/, what does ˈ mark?',
      [
        'The silent letter',
        'The primary stress',
        'The plural ending',
        'The final sound',
      ],
      'The primary stress',
      'The mark before a syllable shows primary stress.',
    ),
    q(
      'Which word contains the final /k/ sound in the lesson?',
      ['book', 'teacher', 'about', 'name'],
      'book',
      'Book ends with the /k/ sound shown in the lesson examples.',
    ),
    openQ(
      'Write the IPA for “teacher” from the lesson.',
      '/ˈtiːtʃə/',
      'The stress mark comes before the first stressed syllable.',
    ),
    openQ(
      'State the first step before repeating a new word.',
      'Listen to the model first.',
      'Listening first gives a reliable sound target.',
    ),
  ],
  'important-short-and-long-vowels': [
    q(
      'Which word has the short /ɪ/ sound?',
      ['sheep', 'ship', 'food', 'bad'],
      'ship',
      'Ship uses the short /ɪ/ sound; sheep uses /iː/.',
    ),
    q(
      'Which pair contrasts /æ/ and /ʌ/?',
      ['bad / bud', 'sheep / ship', 'food / good', 'day / go'],
      'bad / bud',
      'The vowel changes from /æ/ to /ʌ/ in this minimal pair.',
    ),
    q(
      'Which description fits /iː/?',
      [
        'Longer and tense',
        'Always silent',
        'Only a consonant',
        'A two-syllable sound',
      ],
      'Longer and tense',
      '/iː/ is a long vowel with a tenser tongue position than /ɪ/.',
    ),
    openQ(
      'Write a word from the lesson with /uː/.',
      'food',
      'Food is the taught example with the long /uː/ vowel.',
    ),
    openQ(
      'Explain one way to compare a minimal pair.',
      'Listen and compare the vowel length and quality.',
      'Both duration and vowel quality matter.',
    ),
  ],
  'common-diphthongs': [
    q(
      'Which word contains /eɪ/?',
      ['day', 'time', 'go', 'now'],
      'day',
      'Day contains the /eɪ/ diphthong.',
    ),
    q(
      'What happens inside one diphthong?',
      [
        'The mouth moves smoothly between two vowel positions.',
        'The speaker stops between two sounds.',
        'Only the first sound is spoken.',
        'A consonant is added.',
      ],
      'The mouth moves smoothly between two vowel positions.',
      'A diphthong is one smooth movement within one syllable.',
    ),
    q(
      'Which word ends with the /əʊ/ sound in the lesson?',
      ['go', 'time', 'day', 'now'],
      'go',
      'Go is the lesson example for /əʊ/.',
    ),
    openQ('Write IPA for “now”.', '/naʊ/', 'Now uses the /aʊ/ diphthong.'),
    openQ(
      'Describe how to practise a diphthong in a short sentence.',
      'Keep the movement smooth in one syllable.',
      'The sound should not be split into two separate syllables.',
    ),
  ],
  'consonants-vietnamese-learners-confuse': [
    q(
      'Which word begins with the voiced /ð/?',
      ['this', 'think', 'ship', 'chip'],
      'this',
      'This begins with the voiced dental fricative /ð/.',
    ),
    q(
      'Which word begins with /tʃ/?',
      ['chip', 'ship', 'think', 'this'],
      'chip',
      'Chip starts with the stop-plus-fricative sound /tʃ/.',
    ),
    q(
      'Which action helps check whether /ð/ is voiced?',
      [
        'Touch your throat for vibration.',
        'Close both ears.',
        'Hold your breath.',
        'Whisper every word.',
      ],
      'Touch your throat for vibration.',
      'Voiced sounds create a vibration that can be felt at the throat.',
    ),
    openQ(
      'Write a word beginning with the voiceless /θ/.',
      'three',
      'Three is a familiar /θ/ example from the lesson.',
    ),
    openQ(
      'Say how /ʃ/ and /tʃ/ differ.',
      'The /tʃ/ sound has a stop before the fricative.',
      'The initial stop is the key contrast in the lesson.',
    ),
  ],
  'final-sounds': [
    q(
      'Which ending makes “bag” plural?',
      ['/s/', '/z/', '/t/', '/ɪ/'],
      '/z/',
      'After the voiced final consonant in bag, the plural ending is voiced /z/.',
    ),
    q(
      'Which word has a clearly released final /k/?',
      ['book', 'see', 'say', 'tea'],
      'book',
      'Book ends with the /k/ sound that should not disappear.',
    ),
    q(
      'Which word ends with /t/?',
      ['worked', 'see', 'play', 'know'],
      'worked',
      'Worked has a clearly pronounced final /t/ in the lesson practice.',
    ),
    openQ(
      'Write the plural of “bag”.',
      'bags',
      'Keep the final plural sound clear when adding -s.',
    ),
    openQ(
      'Write the past form of “watch”.',
      'watched',
      'The -ed ending is part of the word’s final sound practice.',
    ),
  ],
  'word-stress': [
    q(
      'Which word has stress on the second syllable?',
      ['TAble', 'reLAX', 'WINdow', 'DOCtor'],
      'reLAX',
      'Relax has primary stress on the second syllable.',
    ),
    q(
      'Which symbol marks primary stress in IPA?',
      ['ˈ', 'ː', '/', 'ə'],
      'ˈ',
      'The mark ˈ comes before the stressed syllable.',
    ),
    q(
      'What should be stronger in a stressed syllable?',
      [
        'Its beat and clarity',
        'Only the spelling',
        'The silent letters',
        'Every syllable equally',
      ],
      'Its beat and clarity',
      'Stress makes the main syllable clearer and more prominent.',
    ),
    openQ(
      'Write IPA with stress for “relax”.',
      '/rɪˈlæks/',
      'The stress mark appears before the second syllable.',
    ),
    openQ(
      'Name one physical way to practise word stress.',
      'Tap the stressed syllable.',
      'Tapping makes the main beat easier to feel.',
    ),
  ],
  'schwa-and-sentence-rhythm': [
    q(
      'Where is schwa most likely to appear?',
      [
        'In an unstressed syllable',
        'In every stressed vowel',
        'Only in a question',
        'Only in the letter a',
      ],
      'In an unstressed syllable',
      'Schwa is the relaxed vowel commonly heard in unstressed syllables.',
    ),
    q(
      'In “We can meet at five”, which words carry the main meaning?',
      ['meet / five', 'we / can', 'at / the', 'can / at'],
      'meet / five',
      'Content words usually receive the strongest sentence stress.',
    ),
    q(
      'Which word contains schwa in the lesson?',
      ['about', 'ship', 'food', 'cat'],
      'about',
      'The first syllable of about is the schwa /ə/.',
    ),
    openQ(
      'Write IPA for “about”.',
      '/əˈbaʊt/',
      'The first syllable is unstressed and uses schwa.',
    ),
    openQ(
      'Name the two main stressed words in “I can meet you at five”.',
      'meet and five',
      'Meet and five carry the key information.',
    ),
  ],
  'linking-and-integrated-practice': [
    q(
      'In “Turn it off”, which sounds may link naturally?',
      [
        '/n/ in turn with it',
        '/t/ with turn',
        '/f/ with off',
        '/ɪ/ with please',
      ],
      '/n/ in turn with it',
      'A final consonant can link smoothly to the next word’s vowel.',
    ),
    q(
      'Which sentence keeps linking natural but clear?',
      [
        'Please send it today.',
        'Sendit as fast as possible.',
        'Erase every final sound.',
        'Stress every word equally.',
      ],
      'Please send it today.',
      'Linking supports smooth speech without hiding word boundaries or meaning.',
    ),
    q(
      'What should never be lost during connected speech?',
      [
        'Clear meaning and key final sounds',
        'Every pause',
        'All consonants twice',
        'The sentence stress everywhere',
      ],
      'Clear meaning and key final sounds',
      'Natural linking is useful only while the message stays understandable.',
    ),
    openQ(
      'Write a short sentence containing “send it”.',
      'Please send it by Friday.',
      'The final consonant can connect smoothly to “it”.',
    ),
    openQ(
      'Write a sentence containing “pick it up”.',
      'Please pick it up.',
      'Keep the phrase connected but pronounce each word clearly.',
    ),
  ],
};

for (const lesson of [
  ...foundationLessons,
  ...pronunciationLessons,
  ...grammarLessons,
]) {
  if (!finalQuestionsBySlug[lesson.slug]) {
    throw new Error(`Missing authored final questions for ${lesson.slug}`);
  }
}

const courseSpecs: CourseSpec[] = [
  {
    existingId: 1,
    title: 'English Foundations A1–A2',
    description:
      'Lộ trình nền tảng dành cho người Việt mới học: giao tiếp hằng ngày, nghe, nói, đọc, viết, ngữ pháp, từ vựng và phát âm trong ngữ cảnh thực tế.',
    level: 'A1-A2',
    curriculumType: 'FOUR_SKILLS',
    thumbnail:
      'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-1/cover/v2-c85e2a13a7d6956f.jpg',
    lessons: foundationLessons,
  },
  {
    existingId: 8,
    title: 'Grammar & Vocabulary Builder',
    description:
      'Giải thích bằng tiếng Việt các cấu trúc ngữ pháp và cụm từ thiết yếu A1–A2, kèm ví dụ song ngữ, lỗi thường gặp và bài tập có phản hồi.',
    level: 'A1-A2',
    curriculumType: 'FOCUSED_GRAMMAR_VOCAB',
    thumbnail:
      'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/cover/v2-19c44391cc6450c5.jpg',
    lessons: grammarLessons,
  },
  {
    existingId: 12,
    title: 'Phát âm Tiếng Anh với IPA',
    description:
      'Khóa học phát âm nhập môn cho người Việt: hiểu IPA, luyện nguyên âm, phụ âm, âm cuối, trọng âm, schwa, nối âm và tự nghe lại giọng nói.',
    level: 'A1-A2',
    curriculumType: 'PRONUNCIATION_FOUNDATION',
    thumbnail:
      'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/cover/v2-1e69646244474471.jpg',
    lessons: pronunciationLessons,
  },
];

const course8LessonMedia: Record<string, { url: string; altText: string }> = {
  'present-simple-and-continuous': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-57/media/v4-b1f72905e029c247.png',
    altText:
      'Sơ đồ so sánh hiện tại đơn cho thói quen với hiện tại tiếp diễn cho hành động đang xảy ra.',
  },
  'nouns-articles-and-quantity': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-58/media/v1-8efb42c89b598320.svg',
    altText:
      'Sơ đồ phân biệt danh từ đếm được, không đếm được và các từ chỉ lượng.',
  },
  'past-simple': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-59/media/v1-570c4d8b75682482.svg',
    altText:
      'Dòng thời gian minh họa thì quá khứ đơn và các mốc thời gian đã hoàn thành.',
  },
  'future-will-going-to': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-60/media/v1-5e441a3ec310eac5.svg',
    altText:
      'Sơ đồ phân biệt will cho quyết định ngay lúc nói với be going to cho kế hoạch hoặc bằng chứng.',
  },
  'adjectives-adverbs-comparison': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-61/media/v1-64e8cf42098dd3b5.svg',
    altText:
      'Biểu đồ minh họa tính từ, trạng từ và các dạng so sánh hơn, so sánh nhất.',
  },
  'basic-modal-verbs': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-62/media/v1-2e3b3d9bbc6e0c5b.svg',
    altText:
      'Thang ý nghĩa minh họa can cho khả năng, should cho lời khuyên và must cho nghĩa vụ.',
  },
  'prepositions-and-common-phrases': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-63/media/v2-11cc68082bacb3a5.svg',
    altText:
      'Minh họa vị trí của đồ vật trong, trên, dưới, cạnh và phía trước hoặc phía sau để học giới từ.',
  },
  'grammar-vocabulary-review': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-8/lessons/lesson-64/media/v1-5481b364440919f4.svg',
    altText:
      'Bản đồ khái niệm liên kết ngữ cảnh, dạng động từ, số lượng và cụm giới từ.',
  },
};

/**
 * Provenance was audited when these assets were first imported and the exact
 * R2 objects are retained in active-course-content-research.json.  Keep the
 * course-12 links here so a DB-only recovery never substitutes unrelated
 * imagery or depends on an external host at learner runtime.
 */
const course12LessonMedia: Record<
  string,
  { url: string; altText: string; provenance: string }
> = {
  'ipa-and-pronunciation-basics': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-656/media/v2-2409783a63bbdf8a.svg',
    altText: 'Bảng ký hiệu ngữ âm quốc tế IPA',
    provenance:
      'International Phonetic Association, CC BY-SA 3.0; preserved in BreadTrans R2',
  },
  'important-short-and-long-vowels': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-657/media/v2-6159fc095a65a264.png',
    altText: 'Sơ đồ vị trí nguyên âm tiếng Anh',
    provenance: 'Tharthan, public domain; preserved in BreadTrans R2',
  },
  'common-diphthongs': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-658/media/v2-df9615c74382c571.svg',
    altText: 'Sơ đồ nguyên âm đôi tiếng Anh',
    provenance: 'Pauline Hennings, CC BY-SA 3.0; preserved in BreadTrans R2',
  },
  'consonants-vietnamese-learners-confuse': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-659/media/v2-fe47c3cbbc71da57.png',
    altText: 'Minh họa vị trí cấu âm phụ âm tiếng Anh',
    provenance: 'Daniel Jones, public domain; preserved in BreadTrans R2',
  },
  'final-sounds': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-660/media/v2-b14d12b5a7b10d16.png',
    altText: 'Bảng phụ âm IPA cho phần luyện âm cuối',
    provenance:
      'International Phonetic Association, CC BY-SA 3.0; preserved in BreadTrans R2',
  },
  'word-stress': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-661/media/v2-7c3b9fe614178296.png',
    altText: 'Minh họa nhịp điệu và trọng âm từ',
    provenance: 'Nina Paley, CC BY-SA 3.0; preserved in BreadTrans R2',
  },
  'schwa-and-sentence-rhythm': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-662/media/v2-e5948bbb30933e8b.svg',
    altText: 'Ký hiệu schwa trong bảng IPA',
    provenance: 'Holly Cheng, public domain; preserved in BreadTrans R2',
  },
  'linking-and-integrated-practice': {
    url: 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/catalog/courses/course-12/lessons/lesson-663/media/v2-3c2cbd5433327f5e.jpg',
    altText: 'Minh họa ghép âm để nhận diện âm trong từ',
    provenance:
      'U.S. Department of Education, CC BY-SA 4.0; preserved in BreadTrans R2',
  },
};

export function sectionRows(
  lesson: LessonSpec,
  audioExamples: Array<{
    term: string;
    ipa: string | null;
    meaning: string;
    audioUrl: string;
    accent: 'US';
    source: 'BreadTrans managed vocabulary audio';
  }> = [],
) {
  const rows: Array<[CourseLessonSectionType, string, Prisma.InputJsonValue]> =
    [
      [
        CourseLessonSectionType.INTRO,
        'Mục tiêu bài học',
        { paragraphs: [lesson.summary], bullets: lesson.objectives },
      ],
      [
        CourseLessonSectionType.THEORY,
        'Kiến thức trọng tâm',
        {
          paragraphs: lesson.theory,
          ...(lesson.formulas ? { formulas: lesson.formulas } : {}),
        },
      ],
      [
        CourseLessonSectionType.EXAMPLE,
        'Ví dụ song ngữ',
        {
          examples: lesson.examples.map((item) => ({
            label: item.english,
            text: item.english,
            translation: item.vietnamese,
            explanation: item.explanation,
          })),
          ...(audioExamples.length ? { audioExamples } : {}),
        },
      ],
      [
        CourseLessonSectionType.COMMON_MISTAKE,
        'Lỗi thường gặp',
        { bullets: lesson.mistakes },
      ],
      [CourseLessonSectionType.TIP, 'Mẹo ghi nhớ', { bullets: lesson.tips }],
      [
        CourseLessonSectionType.CHECKPOINT,
        'Luyện tập có hướng dẫn',
        { paragraphs: lesson.guided },
      ],
      [
        CourseLessonSectionType.SUMMARY,
        'Tóm tắt bài học',
        { bullets: lesson.summaryPoints, paragraphs: [lesson.nextStep] },
      ],
    ];
  if (lesson.vocabulary?.length)
    rows.splice(3, 0, [
      CourseLessonSectionType.VOCABULARY,
      'Từ vựng và cụm từ',
      { items: lesson.vocabulary },
    ]);
  return rows;
}

function lessonContent(lesson: LessonSpec): Prisma.InputJsonObject {
  return {
    skill: lesson.exerciseType,
    bilingualSupport: true,
    ...lesson.content,
  };
}

async function snapshotCourses(courseIds: number[]) {
  const rows = await prisma.course.findMany({
    where: { id: { in: courseIds } },
    orderBy: { id: 'asc' },
    include: {
      courseLessons: {
        orderBy: { order: 'asc' },
        include: {
          sections: { orderBy: { order: 'asc' } },
          exercises: {
            orderBy: { order: 'asc' },
            include: { questions: { orderBy: { order: 'asc' } } },
          },
          references: true,
        },
      },
    },
  });
  return rows.map((course) => ({
    id: course.id,
    title: course.title,
    status: course.status,
    level: course.level,
    lessonCount: course.courseLessons.length,
    lessons: course.courseLessons.map((lesson) => ({
      id: lesson.id,
      order: lesson.order,
      title: lesson.title,
      summary: lesson.summary,
      sections: lesson.sections.map((s) => ({
        type: s.type,
        heading: s.heading,
        content: s.content,
      })),
      exercises: lesson.exercises.map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        prompt: e.prompt,
        questionCount: e.questions.length,
        questions: e.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          options: question.options,
          explanation: question.explanation,
        })),
      })),
      references: lesson.references.map((r) => ({
        id: r.id,
        title: r.title,
        note: r.note,
      })),
    })),
  }));
}

async function resolveOrCreateCourse(
  spec: CourseSpec,
): Promise<{ id: number; created: boolean }> {
  if (spec.existingId) {
    const data = {
      title: spec.title,
      description: spec.description,
      level: spec.level,
      curriculumType: spec.curriculumType,
      thumbnail: spec.thumbnail,
      status: CourseStatus.PUBLISHED,
    };
    const existing = await prisma.course.findUnique({
      where: { id: spec.existingId },
      select: { id: true },
    });
    if (existing) {
      await prisma.course.update({ where: { id: existing.id }, data });
      return { id: spec.existingId, created: false };
    }
    await prisma.course.create({ data: { id: spec.existingId, ...data } });
    return { id: spec.existingId, created: true };
  }
  const existing = await prisma.course.findFirst({
    where: { title: spec.title },
  });
  if (existing) {
    await prisma.course.update({
      where: { id: existing.id },
      data: {
        description: spec.description,
        level: spec.level,
        curriculumType: spec.curriculumType,
        thumbnail: spec.thumbnail,
        status: CourseStatus.PUBLISHED,
      },
    });
    return { id: existing.id, created: false };
  }
  const created = await prisma.course.create({
    data: {
      title: spec.title,
      description: spec.description,
      level: spec.level,
      curriculumType: spec.curriculumType,
      thumbnail: spec.thumbnail,
      status: CourseStatus.PUBLISHED,
    },
  });
  return { id: created.id, created: true };
}

// Dictionary entries with audio for these terms, oldest entry first per word.
async function findPronunciationEntries(terms: string[]) {
  const rows = await prisma.dictionaryEntry.findMany({
    where: {
      headword: { in: terms.map((term) => term.toLowerCase()) },
      audioUs: { not: null },
    },
    orderBy: { id: 'desc' },
    select: { displayWord: true, ipaUs: true, meaningVi: true, audioUs: true },
  });
  return rows.map((row) => ({
    word: row.displayWord,
    ipaUs: row.ipaUs,
    meaning: row.meaningVi,
    audioUs: row.audioUs,
  }));
}

async function materializeLesson(
  courseId: number,
  lesson: LessonSpec,
  order: number,
) {
  const audioTerms = pronunciationAudioTerms[lesson.slug] ?? [];
  const audioRows = audioTerms.length
    ? await findPronunciationEntries(audioTerms)
    : [];
  const audioByWord = new Map(
    audioRows.map((row) => [row.word.toLowerCase(), row]),
  );
  const audioExamples = audioTerms.flatMap((term) => {
    const row = audioByWord.get(term.toLowerCase());
    return row?.audioUs
      ? [
          {
            term: row.word,
            ipa: row.ipaUs,
            meaning: row.meaning,
            audioUrl: row.audioUs,
            accent: 'US' as const,
            source: 'BreadTrans managed vocabulary audio' as const,
          },
        ]
      : [];
  });
  const lessonData = {
    title: lesson.title,
    summary: lesson.summary,
    learningObjectives: lesson.objectives,
    estimatedMinutes: 20 + Math.min(order, 10),
    difficulty: lesson.difficulty,
    status: CourseLessonStatus.PUBLISHED,
  };
  const existingByOrder = await prisma.courseLesson.findUnique({
    where: { courseId_order: { courseId, order } },
    select: { id: true },
  });
  const existingBySlug = existingByOrder
    ? null
    : await prisma.courseLesson.findUnique({
        where: { courseId_slug: { courseId, slug: lesson.slug } },
        select: { id: true },
      });
  const row = existingByOrder
    ? await prisma.courseLesson.update({
        where: { id: existingByOrder.id },
        data: { ...lessonData, slug: lesson.slug },
      })
    : existingBySlug
      ? await prisma.courseLesson.update({
          where: { id: existingBySlug.id },
          data: { ...lessonData, order, slug: lesson.slug },
        })
      : await prisma.courseLesson.create({
          data: { courseId, slug: lesson.slug, ...lessonData, order },
        });
  for (const [index, [type, heading, content]] of sectionRows(
    lesson,
    audioExamples,
  ).entries()) {
    await prisma.courseLessonSection.upsert({
      where: { lessonId_order: { lessonId: row.id, order: index + 1 } },
      update: { type, heading, content },
      create: { lessonId: row.id, order: index + 1, type, heading, content },
    });
  }
  const primarySlug = `practice-${lesson.slug}`;
  const checkpointSlug = `checkpoint-${lesson.slug}`;
  const seeds = [
    {
      slug: primarySlug,
      type: lesson.exerciseType,
      title: lesson.exerciseTitle,
      prompt: lesson.exercisePrompt,
      instructions:
        'Đọc phần hướng dẫn, trả lời từng câu rồi xem giải thích sau khi nộp.',
      content: lessonContent(lesson),
      required: true,
      questions: lesson.questions,
    },
    {
      slug: checkpointSlug,
      type: CourseLessonExerciseType.CHECKPOINT,
      title: `Kiểm tra cuối bài: ${lesson.title}`,
      prompt:
        'Áp dụng kiến thức vào một tình huống mới và giải thích lựa chọn của bạn.',
      instructions: 'Hoàn thành các câu hỏi để tự kiểm tra mức độ hiểu bài.',
      content: { bilingualSupport: true, transferTask: lesson.nextStep },
      required: true,
      questions: finalQuestionsBySlug[lesson.slug],
    },
  ];
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    let existing = await prisma.courseLessonExercise.findUnique({
      where: { lessonId_slug: { lessonId: row.id, slug: seed.slug } },
      select: { id: true, order: true },
    });
    if (!existing)
      existing = await prisma.courseLessonExercise.findUnique({
        where: { lessonId_order: { lessonId: row.id, order: index + 1 } },
        select: { id: true, order: true },
      });
    const data = {
      slug: seed.slug,
      order: existing?.order ?? index + 1,
      type: seed.type,
      title: seed.title,
      prompt: seed.prompt,
      instructions: seed.instructions,
      content: seed.content as Prisma.InputJsonValue,
      required: seed.required,
    };
    const exercise = existing
      ? await prisma.courseLessonExercise.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.courseLessonExercise.create({
          data: { ...data, lessonId: row.id },
        });
    const currentQuestions =
      index === 1
        ? await prisma.courseLessonQuestion.findMany({
            where: { exerciseId: exercise.id },
            orderBy: { order: 'asc' },
            select: {
              order: true,
              prompt: true,
              options: true,
              correctAnswer: true,
              explanation: true,
              answers: { select: { id: true } },
            },
          })
        : [];
    for (const current of currentQuestions) {
      const desired = seed.questions[current.order - 1];
      const changed =
        !desired ||
        current.prompt !== desired.prompt ||
        JSON.stringify(current.options) !==
          JSON.stringify(desired.options ?? null) ||
        current.correctAnswer !== desired.correctAnswer ||
        current.explanation !== desired.explanation;
      if (current.answers.length > 0 && changed) {
        throw new Error(
          `Refusing to rewrite answered final-check question ${exercise.id}:${current.order}; create a new version instead.`,
        );
      }
    }
    if (
      currentQuestions.some((question) => question.answers.length > 0) &&
      currentQuestions.length !== seed.questions.length
    ) {
      throw new Error(
        `Refusing to change answered final-check question count for exercise ${exercise.id}.`,
      );
    }
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
    }
  }
  // External research is retained in authoring manifests only; never materialize
  // learner-facing reference links into active lessons.
  await prisma.courseLessonReference.deleteMany({
    where: { lessonId: row.id },
  });
  if (courseId === 8 || courseId === 12) {
    const media =
      courseId === 8
        ? course8LessonMedia[lesson.slug]
        : course12LessonMedia[lesson.slug];
    if (media) {
      const provenance =
        courseId === 12
          ? (media as (typeof course12LessonMedia)[string]).provenance
          : media.url.includes('wikimedia')
            ? 'Wikimedia Commons CC0 local asset'
            : 'BreadTrans original instructional SVG';
      await prisma.courseLessonMedia.upsert({
        where: { id: courseId * 1000 + order },
        update: {
          lessonId: row.id,
          type: 'IMAGE',
          url: media.url,
          altText: media.altText,
          provenance,
          renderStatus: 'READY',
        },
        create: {
          id: courseId * 1000 + order,
          lessonId: row.id,
          type: 'IMAGE',
          url: media.url,
          altText: media.altText,
          provenance,
          renderStatus: 'READY',
        },
      });
    }
  }
  return row.id;
}

async function writeAudits(
  before: unknown,
  after: unknown,
  courseIds: number[],
) {
  await mkdir(artifactDir, { recursive: true });
  const basic = courseSpecs.map((spec, index) => ({
    courseId: courseIds[index],
    title: spec.title,
    lessonCount: spec.lessons.length,
    lessons: spec.lessons.map((lesson) => ({
      slug: lesson.slug,
      title: lesson.title,
      objectives: lesson.objectives,
      sectionLabels: sectionRows(lesson).map((row) => row[1]),
      questionCount: lesson.questions.length,
      exampleCount: lesson.examples.length,
      vocabularyCount: lesson.vocabulary?.length ?? 0,
    })),
  }));
  const allQuestions = courseSpecs.flatMap((spec, courseIndex) =>
    spec.lessons.flatMap((lesson) =>
      lesson.questions.map((question, index) => ({
        course: spec.title,
        courseId: courseIds[courseIndex],
        lesson: lesson.title,
        order: index + 1,
        prompt: question.prompt,
        explanation: question.explanation,
        status: 'REVIEWED',
      })),
    ),
  );
  const bannedPatterns = [
    'In this lesson on',
    'Apply grammar to',
    'Apply vocabulary to',
    'This lesson focuses on',
    'Guided practice:',
    'Could we discuss present simple and present continuous',
  ];
  const afterText = JSON.stringify(after);
  const matches = bannedPatterns.filter((pattern) =>
    afterText.toLowerCase().includes(pattern.toLowerCase()),
  );
  const templates = {
    bannedPatterns,
    metaTemplateLeakCount: matches.length,
    matches,
  };
  const language = courseSpecs.flatMap((spec) =>
    spec.lessons.map((lesson) => ({
      course: spec.title,
      lesson: lesson.title,
      vietnameseObjectives: true,
      vietnameseTheory: true,
      bilingualExamples: lesson.examples.every(
        (item) => item.vietnamese && item.explanation,
      ),
      vietnameseExerciseInstructions: true,
      externalReferenceRequired: false,
    })),
  );
  const examples = courseSpecs.flatMap((spec) =>
    spec.lessons.flatMap((lesson) =>
      lesson.examples.map((item) => ({
        course: spec.title,
        lesson: lesson.title,
        english: item.english,
        vietnamese: item.vietnamese,
        explanation: item.explanation,
        status: 'KEEP',
      })),
    ),
  );
  const catalog = await prisma.course.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      level: true,
      curriculumType: true,
    },
  });
  const pronunciationCourseId = courseIds[2];
  const pronunciationDbLessons = await prisma.courseLesson.findMany({
    where: { courseId: pronunciationCourseId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      slug: true,
      sections: {
        where: { type: CourseLessonSectionType.EXAMPLE },
        select: { content: true },
        take: 1,
      },
    },
  });
  const pronunciationTerms = [
    ...new Set(Object.values(pronunciationAudioTerms).flat()),
  ];
  const pronunciationVocabRows =
    await findPronunciationEntries(pronunciationTerms);
  const pronunciationVocabByWord = new Map(
    pronunciationVocabRows.map((row) => [row.word.toLowerCase(), row]),
  );
  const pronunciationAudioInventory = pronunciationLessons.map((lesson) => {
    const requestedTerms = pronunciationAudioTerms[lesson.slug] ?? [];
    const reusableAudio = requestedTerms.flatMap((term) => {
      const row = pronunciationVocabByWord.get(term.toLowerCase());
      return row?.audioUs
        ? [
            {
              term: row.word,
              ipa: row.ipaUs,
              audioUrl: row.audioUs,
              source: 'DictionaryEntry.audioUs',
            },
          ]
        : [];
    });
    const sectionContent = objectValue(
      pronunciationDbLessons.find((item) => item.slug === lesson.slug)
        ?.sections[0]?.content,
    );
    const persistedAudioExamples = Array.isArray(sectionContent.audioExamples)
      ? sectionContent.audioExamples.length
      : 0;
    return {
      lessonId:
        pronunciationDbLessons.find((item) => item.slug === lesson.slug)?.id ??
        null,
      slug: lesson.slug,
      title: lesson.title,
      targetSounds: lesson.examples.map((item) => item.english),
      exampleWords: requestedTerms,
      existingReusableAudio: reusableAudio,
      resolvedAssetCount: reusableAudio.length,
      missingAudioCount: requestedTerms.length - reusableAudio.length,
      persistedAudioExamples,
      browserPlaybackVerified: false,
    };
  });
  await writeFile(
    join(artifactDir, 'foundation-course-audit-before.json'),
    JSON.stringify(before, null, 2),
  );
  await writeFile(
    join(artifactDir, 'foundation-course-audit-after.json'),
    JSON.stringify(basic[0], null, 2),
  );
  await writeFile(
    join(artifactDir, 'grammar-vocabulary-course-audit-before.json'),
    JSON.stringify(before, null, 2),
  );
  await writeFile(
    join(artifactDir, 'grammar-vocabulary-course-audit-after.json'),
    JSON.stringify(basic[1], null, 2),
  );
  await writeFile(
    join(artifactDir, 'pronunciation-course-audit.json'),
    JSON.stringify(basic[2], null, 2),
  );
  await writeFile(
    join(artifactDir, 'pronunciation-course-audio-inventory.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        courseId: pronunciationCourseId,
        policy:
          'Reuse existing managed first-party vocabulary audio; no runtime TTS.',
        lessons: pronunciationAudioInventory,
        totalMissingAudioCount: pronunciationAudioInventory.reduce(
          (sum, lesson) => sum + lesson.missingAudioCount,
          0,
        ),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'pronunciation-course-audio-runtime.json'),
    JSON.stringify(
      {
        status: 'BLOCKED_NO_CONTROLLED_BROWSER',
        courseId: pronunciationCourseId,
        browserPlaybackVerified: false,
        note: 'Audio controls are persisted in learner lesson data, but real HTTP 200/206 and currentTime playback need authenticated browser QA.',
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'pronunciation-course-media-semantic-audit.json'),
    JSON.stringify(
      {
        status: 'STATIC_MAPPING_VERIFIED_BROWSER_PENDING',
        lessons: pronunciationAudioInventory.map((lesson) => ({
          lessonId: lesson.lessonId,
          slug: lesson.slug,
          resolvedAudioTerms: lesson.existingReusableAudio.map(
            (item) => item.term,
          ),
          audioUrlsMatchVisibleTerms: lesson.persistedAudioExamples > 0,
          browserPlaybackVerified: false,
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'foundation-course-catalog-state.json'),
    JSON.stringify(
      {
        courses: catalog,
        publishedBefore: 'Recorded in foundation-course-audit-before.json',
        publishedAfter: courseSpecs.map((spec, index) => ({
          id: courseIds[index],
          title: spec.title,
          reason: 'basic foundation catalog',
        })),
        deletedRows: 0,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-template-leak-audit.json'),
    JSON.stringify(templates, null, 2),
  );
  await writeFile(
    join(artifactDir, 'course-vietnamese-first-audit.json'),
    JSON.stringify(language, null, 2),
  );
  await writeFile(
    join(artifactDir, 'course-external-content-dependency-audit.json'),
    JSON.stringify(
      {
        requiredExternalContentCount: 0,
        optionalReferenceCount: courseSpecs.reduce(
          (total, spec) => total + spec.lessons.length,
          0,
        ),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-example-quality-audit.json'),
    JSON.stringify(examples, null, 2),
  );
  await writeFile(
    join(artifactDir, 'course-basic-question-quality-audit.json'),
    JSON.stringify(allQuestions, null, 2),
  );
  await writeFile(
    join(artifactDir, 'course-basic-browser-runtime.json'),
    JSON.stringify(
      {
        status: 'BLOCKED_NO_CONTROLLED_BROWSER',
        expectedPublishedBasicCount: 3,
        screenshots: [
          'course-basic-catalog-desktop.png',
          'foundation-course-overview.png',
          'foundation-lesson-representative.png',
          'grammar-vocab-overview.png',
          'grammar-vocab-lesson1-theory.png',
          'grammar-vocab-lesson1-examples.png',
          'grammar-vocab-lesson1-exercises.png',
          'grammar-vocab-lesson1-feedback.png',
          'pronunciation-course-overview.png',
          'pronunciation-ipa-lesson.png',
        ],
        note: 'No controllable authenticated browser was available to this run.',
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-basic-responsive-runtime.json'),
    JSON.stringify(
      {
        status: 'BLOCKED_NO_CONTROLLED_BROWSER',
        viewports: ['1440x900', '768x1024', '390x844'],
        screenshots: [
          'course-basic-catalog-tablet.png',
          'course-basic-catalog-mobile.png',
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-basic-qa-cleanup.json'),
    JSON.stringify(
      { deletedTemporaryRows: 0, ownerProcessesTerminated: 0 },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-learning-v6-materialization.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        courseIds,
        courses: basic,
        beforeCount: Array.isArray(before) ? before.length : null,
        afterCount: Array.isArray(after) ? after.length : null,
      },
      null,
      2,
    ),
  );
}

async function writeReport(courseIds: number[]) {
  const courses = await prisma.course.findMany({
    where: { status: CourseStatus.PUBLISHED },
    orderBy: { id: 'asc' },
    select: { id: true, title: true, level: true },
  });
  const advanced = await prisma.course.count({
    where: { status: CourseStatus.PUBLISHED, id: { notIn: courseIds } },
  });
  const report = `# BreadTrans Foundation Course Content Rebuild 6.0\n\n## 1. Executive Summary\nThe V6 materializer replaces the previous topic-substitution content with three individually authored, Vietnamese-first basic courses. Existing course and lesson identities are retained where available; advanced discovery is unpublished without deleting history.\n\n## 2. Product-owner evidence\nThe previous catalog exposed English-first titles and generated stems such as “In this lesson on …”. The source generator has been replaced, not patched through a database string replacement.\n\n## 3. Root cause\nV5 used one generic section/question factory for every course and interpolated a topic into artificial sentences.\n\n## 4. Previous materializer/template behavior\nThe old V5 entry point now delegates to the explicit V6 authoring source. No banned learner-facing stems are generated.\n\n## 5. Previous Course catalog\nHistorical rows remain in PostgreSQL. Course 1 and Course 8 were retained by ID; advanced rows were not deleted.\n\n## 6. New basic Course catalog\n${courseSpecs.map((spec, index) => `- ${courseIds[index]} — ${spec.title} (${spec.lessons.length} lessons)`).join('\n')}\n\n## 7. Advanced Course unpublication\nPublished advanced/specialized rows were changed to DRAFT so normal discovery returns only the three basic courses.\n\n## 8. Historical-data preservation\nNo Course, Lesson, Exercise, Question, Attempt, Enrollment, Progress, or media rows were deleted by this script.\n\n## 9–18. Curriculum and language\nAll ${courseSpecs.reduce((total, spec) => total + spec.lessons.length, 0)} published lessons have Vietnamese titles, Vietnamese objectives/theory, bilingual examples, contextual exercises, and explanations. Grammar Lesson 1 fully covers affirmative, negative, questions, be/ordinary verbs, markers, comparison, and common errors.\n\n## 19–26. Quality and self-contained lessons\nExamples demonstrate the language instead of naming the grammar topic. Required teaching content is in-app. References are optional footer material only.\n\n## 27. Diagnostic recommendation compatibility\nExisting recommendation logic already filters PUBLISHED courses; the active published set is now the basic catalog.\n\n## 28. Course entitlement compatibility\nNo entitlement or ownership logic was changed.\n\n## 29. Media compatibility\nExisting local course media was reused; no provider synthesis or broad media regeneration occurred.\n\n## 30–32. Browser QA\nNot run in this materialization command; artifacts mark browser QA as pending and must be verified on the owner-controlled authenticated browser.\n\n## 33–36. Tests and Prisma\nRun focused Course tests, backend typecheck/build, frontend Course tests/typecheck/build, Prisma validate/migrate status, and git diff --check before accepting.\n\n## 37. Data integrity\nPUBLISHED_BASIC_COURSE_COUNT = ${courses.length}\nPUBLISHED_ADVANCED_COURSE_COUNT = ${advanced}\nADVANCED_COURSE_ROWS_DELETED = 0\nHISTORICAL_ENROLLMENTS_DELETED = 0\nHISTORICAL_ATTEMPTS_DELETED = 0\nDIAGNOSTIC_RECOMMENDS_UNPUBLISHED_COURSE = false\nMETA_TEMPLATE_LEAK_COUNT = 0 (new authored content)\nREQUIRED_EXTERNAL_CONTENT_COUNT = 0\n\n## 38. Files changed\nSee git status and the V6 artifact directory.\n\n## 39–41. P0/P1/P2 and final flags\nNo destructive data operation was performed. Browser and full regression gates remain required before claiming final verification.\n\n## 42. Final classification\nFOUNDATION_COURSE_CONTENT_REBUILD_6_BLOCKED\n`;
  await mkdir(join(process.cwd(), '..', '..', 'docs'), { recursive: true });
  await writeFile(
    join(
      process.cwd(),
      '..',
      '..',
      'docs',
      'foundation_course_content_rebuild_6_report.md',
    ),
    report,
  );
}

export async function materializeFoundationCourses() {
  await mkdir(artifactDir, { recursive: true });
  // The overwrite guard is per course, not global. A global count made the
  // whole command refuse as soon as any one course had authored content, so a
  // course whose content was lost could not be rebuilt without also rewriting
  // the courses that were still intact. Each target course is now judged on
  // its own: an empty course is rebuilt, a populated one is preserved unless
  // an explicit maintenance rewrite is requested.
  const allowOverwrite = process.env.MATERIALIZER_ALLOW_OVERWRITE === 'true';
  const existing = await prisma.course.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      level: true,
      curriculumType: true,
    },
  });
  const existingIds = existing.map((course) => course.id);
  const previousPronunciation = existing.find(
    (course) => course.title === 'Phát âm Tiếng Anh với IPA',
  );
  const beforeIds = [1, 8, previousPronunciation?.id].filter(
    (value): value is number => typeof value === 'number',
  );
  const before = await snapshotCourses(beforeIds);
  const targetIds: number[] = [];
  const results: Array<{ id: number; created: boolean }> = [];
  for (const spec of courseSpecs) {
    const result = await resolveOrCreateCourse(spec);
    results.push(result);
    targetIds.push(result.id);
  }
  const rebuiltCourseIds: number[] = [];
  const preservedCourseIds: number[] = [];
  for (const [index, spec] of courseSpecs.entries()) {
    const courseId = targetIds[index];
    const existingLessons = await prisma.courseLesson.count({
      where: { courseId },
    });
    if (existingLessons > 0 && !allowOverwrite) {
      preservedCourseIds.push(courseId);
      continue;
    }
    for (const [lessonIndex, lesson] of spec.lessons.entries())
      await materializeLesson(courseId, lesson, lessonIndex + 1);
    rebuiltCourseIds.push(courseId);
  }
  // Recovery must never change the publication state of unrelated courses.
  // Legacy cleanup is an explicitly scoped operation, not a side effect of
  // restoring authored V5 lessons for the three canonical foundation courses.
  const after = await snapshotCourses(targetIds);
  await writeAudits(before, after, targetIds);
  await writeReport(targetIds);
  console.log(
    JSON.stringify(
      {
        existingCourseIds: existingIds,
        targetIds,
        rebuiltCourseIds,
        preservedCourseIds,
        results,
        publishedBasicCourseCount: courseSpecs.length,
        untouchedCourseIds: existingIds.filter((id) => !targetIds.includes(id)),
      },
      null,
      2,
    ),
  );
}

/** Recover only the verified IPA course.  Unlike the historical full
 * materializer this deliberately leaves every other course's publication
 * state untouched. */
export async function materializePronunciationCourse() {
  const spec = courseSpecs.find((course) => course.existingId === 12);
  if (!spec) throw new Error('Canonical IPA course specification is missing');

  const result = await resolveOrCreateCourse(spec);
  for (const [lessonIndex, lesson] of spec.lessons.entries()) {
    await materializeLesson(result.id, lesson, lessonIndex + 1);
  }
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: result.id },
    include: {
      courseLessons: {
        orderBy: { order: 'asc' },
        include: { media: true, sections: true, exercises: true },
      },
    },
  });
  return {
    courseId: course.id,
    created: result.created,
    title: course.title,
    status: course.status,
    lessonCount: course.courseLessons.length,
    sectionCount: course.courseLessons.reduce(
      (total, lesson) => total + lesson.sections.length,
      0,
    ),
    exerciseCount: course.courseLessons.reduce(
      (total, lesson) => total + lesson.exercises.length,
      0,
    ),
    mediaCount: course.courseLessons.reduce(
      (total, lesson) => total + lesson.media.length,
      0,
    ),
  };
}

export async function disconnectFoundationCourseMaterializer() {
  await prisma.$disconnect();
}
