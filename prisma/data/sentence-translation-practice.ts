/**
 * "Dịch câu" — Vietnamese → English sentence translation (owner 2026-11-14).
 *
 * Original BreadTrans material, written by hand. Each exercise has six short
 * everyday sentences; each sentence lists several accepted translations (the
 * answer check compares against them, case, punctuation, contractions and
 * numbers aside), word help and one grammar tip in Vietnamese. The accepted
 * answers never reach the learner before a check.
 *
 * The CEFR tag in each title decides access like every practice item: A1 is
 * "Mất gốc", A2 "Cơ bản", both free. Written to a database by
 * scripts/sentence-translation-load.ts and by prisma/seed.ts.
 */
import type { TranslationHint } from '../../src/modules/writing/sentence-translation.logic';

export const SENTENCE_TRANSLATION_TOPIC = {
  name: 'Sentence Translation',
  vietnameseName: 'Dịch câu',
} as const;

export type TranslationSentenceSeed = {
  vi: string;
  accepted: string[];
  hints: TranslationHint[];
  tip: string;
};

export type TranslationExerciseSeed = {
  title: string;
  description: string;
  level: 'A1' | 'A2';
  sentences: TranslationSentenceSeed[];
};

const h = (vi: string, en: string): TranslationHint => ({ vi, en });

export const SENTENCE_TRANSLATION_EXERCISES: TranslationExerciseSeed[] = [
  {
    title: 'Dịch câu: Gia đình (A1)',
    description:
      'Dịch sáu câu ngắn về gia đình sang tiếng Anh: động từ "be", "have" và tính từ sở hữu.',
    level: 'A1',
    sentences: [
      {
        vi: 'Tôi có một người anh trai.',
        accepted: [
          'I have an older brother.',
          'I have a big brother.',
          'I have an elder brother.',
          "I've got an older brother.",
        ],
        hints: [h('anh trai', 'older brother'), h('có', 'have')],
        tip: 'Với I/you/we/they dùng "have". Trước danh từ đếm được số ít cần "a/an": "an older brother" (older bắt đầu bằng nguyên âm nên dùng "an").',
      },
      {
        vi: 'Mẹ tôi là giáo viên.',
        accepted: [
          'My mother is a teacher.',
          'My mom is a teacher.',
          'My mum is a teacher.',
        ],
        hints: [h('mẹ tôi', 'my mother'), h('giáo viên', 'teacher')],
        tip: 'Nói nghề nghiệp cần "a/an" trước tên nghề: "is a teacher". Không bỏ "is" như trong tiếng Việt.',
      },
      {
        vi: 'Bố tôi làm việc ở bệnh viện.',
        accepted: [
          'My father works at a hospital.',
          'My father works in a hospital.',
          'My dad works at a hospital.',
          'My dad works in a hospital.',
        ],
        hints: [h('làm việc', 'work'), h('bệnh viện', 'hospital')],
        tip: 'Chủ ngữ ngôi thứ ba số ít (my father, he, she) thì động từ thêm -s: "works".',
      },
      {
        vi: 'Em gái tôi mười tuổi.',
        accepted: [
          'My younger sister is ten years old.',
          'My younger sister is ten.',
          'My little sister is ten years old.',
          'My little sister is ten.',
        ],
        hints: [h('em gái', 'younger sister'), h('mười tuổi', 'ten years old')],
        tip: 'Nói tuổi dùng "be": "is ten years old", không dùng "has".',
      },
      {
        vi: 'Chúng tôi sống trong một ngôi nhà nhỏ.',
        accepted: ['We live in a small house.', 'We live in a little house.'],
        hints: [h('sống ở/trong', 'live in'), h('ngôi nhà nhỏ', 'small house')],
        tip: 'Tính từ đứng trước danh từ: "a small house" (không phải "a house small").',
      },
      {
        vi: 'Ông bà tôi rất tốt bụng.',
        accepted: [
          'My grandparents are very kind.',
          'My grandparents are very nice.',
          'My grandparents are really kind.',
        ],
        hints: [h('ông bà', 'grandparents'), h('tốt bụng', 'kind')],
        tip: 'Chủ ngữ số nhiều dùng "are". Tiếng Anh cần "be" trước tính từ: "are very kind".',
      },
    ],
  },
  {
    title: 'Dịch câu: Thói quen hằng ngày (A1)',
    description:
      'Dịch sáu câu về một ngày bình thường: thì hiện tại đơn, giờ giấc và trạng từ tần suất.',
    level: 'A1',
    sentences: [
      {
        vi: 'Tôi thức dậy lúc sáu giờ.',
        accepted: [
          "I get up at six o'clock.",
          "I wake up at six o'clock.",
          'I get up at six.',
          'I wake up at six.',
        ],
        hints: [
          h('thức dậy', 'get up / wake up'),
          h('lúc sáu giờ', "at six o'clock"),
        ],
        tip: 'Giờ đi với "at": "at six o\'clock".',
      },
      {
        vi: 'Tôi đánh răng mỗi sáng.',
        accepted: [
          'I brush my teeth every morning.',
          'I brush my teeth each morning.',
        ],
        hints: [
          h('đánh răng', 'brush my teeth'),
          h('mỗi sáng', 'every morning'),
        ],
        tip: 'Tiếng Anh nói rõ của ai: "brush my teeth". "Răng" ở đây là số nhiều: tooth → teeth.',
      },
      {
        vi: 'Anh ấy đi học bằng xe buýt.',
        accepted: [
          'He goes to school by bus.',
          'He takes the bus to school.',
          'He travels to school by bus.',
        ],
        hints: [h('đi học', 'go to school'), h('bằng xe buýt', 'by bus')],
        tip: 'He/she/it: go → "goes". Phương tiện đi với "by" và không có mạo từ: "by bus".',
      },
      {
        vi: 'Chúng tôi ăn trưa lúc mười hai giờ.',
        accepted: [
          "We have lunch at twelve o'clock.",
          "We eat lunch at twelve o'clock.",
          'We have lunch at twelve.',
          'We eat lunch at twelve.',
          'We have lunch at noon.',
        ],
        hints: [
          h('ăn trưa', 'have lunch'),
          h('mười hai giờ', "twelve o'clock"),
        ],
        tip: 'Bữa ăn thường đi với "have" và không có "the": "have lunch".',
      },
      {
        vi: 'Cô ấy không uống cà phê.',
        accepted: [
          "She doesn't drink coffee.",
          "She doesn't drink any coffee.",
          'She never drinks coffee.',
        ],
        hints: [h('uống', 'drink'), h('cà phê', 'coffee')],
        tip: 'Phủ định với he/she/it: "doesn\'t" + động từ nguyên mẫu ("drink", không phải "drinks").',
      },
      {
        vi: 'Buổi tối tôi thường đọc sách.',
        accepted: [
          'I usually read books in the evening.',
          'In the evening I usually read books.',
          'I often read books in the evening.',
          'In the evening I often read books.',
          'I usually read in the evening.',
        ],
        hints: [
          h('thường', 'usually / often'),
          h('buổi tối', 'in the evening'),
        ],
        tip: 'Trạng từ tần suất (usually, often) đứng trước động từ thường: "I usually read".',
      },
    ],
  },
  {
    title: 'Dịch câu: Đồ ăn (A1)',
    description:
      'Dịch sáu câu về món ăn và bữa ăn: "there is/are", số nhiều và câu hỏi "Do you...?".',
    level: 'A1',
    sentences: [
      {
        vi: 'Tôi thích ăn cơm với cá.',
        accepted: [
          'I like eating rice with fish.',
          'I like to eat rice with fish.',
          'I like rice with fish.',
        ],
        hints: [h('thích', 'like'), h('cơm', 'rice'), h('cá', 'fish')],
        tip: 'Sau "like" dùng V-ing hoặc to V: "like eating" / "like to eat".',
      },
      {
        vi: 'Có ba quả táo trên bàn.',
        accepted: [
          'There are three apples on the table.',
          'Three apples are on the table.',
        ],
        hints: [
          h('có (tồn tại)', 'there are'),
          h('quả táo', 'apple'),
          h('trên bàn', 'on the table'),
        ],
        tip: '"Có" chỉ sự tồn tại là "there is/there are". Số nhiều dùng "are" và danh từ thêm -s: "three apples".',
      },
      {
        vi: 'Món súp này rất nóng.',
        accepted: ['This soup is very hot.', 'This soup is really hot.'],
        hints: [h('món súp', 'soup'), h('này', 'this'), h('nóng', 'hot')],
        tip: '"Này" là "this", đứng trước danh từ. Nhớ có "is" trước tính từ.',
      },
      {
        vi: 'Bạn có muốn uống trà không?',
        accepted: [
          'Do you want to drink tea?',
          'Would you like some tea?',
          'Do you want some tea?',
          'Would you like to drink tea?',
          'Would you like a cup of tea?',
        ],
        hints: [h('muốn', 'want / would like'), h('trà', 'tea')],
        tip: 'Câu hỏi "có... không?" đặt trợ động từ lên đầu: "Do you want...?". Mời lịch sự hơn: "Would you like...?".',
      },
      {
        vi: 'Anh trai tôi không ăn thịt.',
        accepted: [
          "My older brother doesn't eat meat.",
          "My brother doesn't eat meat.",
          "My big brother doesn't eat meat.",
        ],
        hints: [h('anh trai', 'older brother'), h('thịt', 'meat')],
        tip: 'Chủ ngữ ngôi thứ ba số ít: "doesn\'t" + động từ nguyên mẫu ("eat").',
      },
      {
        vi: 'Chúng tôi ăn tối cùng nhau mỗi ngày.',
        accepted: [
          'We have dinner together every day.',
          'We eat dinner together every day.',
        ],
        hints: [
          h('ăn tối', 'have dinner'),
          h('cùng nhau', 'together'),
          h('mỗi ngày', 'every day'),
        ],
        tip: '"Mỗi ngày" là "every day" (hai từ); "everyday" (một từ) là tính từ, nghĩa là "thường ngày".',
      },
    ],
  },
  {
    title: 'Dịch câu: Ở trường (A1)',
    description:
      'Dịch sáu câu về lớp học: "has/have", giới từ chỉ thời gian và vị trí, "đang" và "không được".',
    level: 'A1',
    sentences: [
      {
        vi: 'Lớp học của tôi có ba mươi học sinh.',
        accepted: [
          'My class has thirty students.',
          'There are thirty students in my class.',
          'My class has thirty pupils.',
          'There are thirty pupils in my class.',
        ],
        hints: [
          h('lớp học', 'class'),
          h('học sinh', 'student'),
          h('ba mươi', 'thirty'),
        ],
        tip: '"Có" (sở hữu) với chủ ngữ số ít là "has": "My class has...". Cũng có thể nói "There are ... in my class".',
      },
      {
        vi: 'Cô giáo của chúng tôi rất thân thiện.',
        accepted: [
          'Our teacher is very friendly.',
          'Our teacher is really friendly.',
        ],
        hints: [h('của chúng tôi', 'our'), h('thân thiện', 'friendly')],
        tip: '"Của chúng tôi" là "our" và đứng trước danh từ: "our teacher".',
      },
      {
        vi: 'Tôi học tiếng Anh vào thứ Hai.',
        accepted: [
          'I study English on Monday.',
          'I study English on Mondays.',
          'I learn English on Monday.',
          'I learn English on Mondays.',
          'I have English on Mondays.',
        ],
        hints: [h('học', 'study / learn'), h('vào thứ Hai', 'on Monday')],
        tip: 'Thứ trong tuần đi với "on" và viết hoa chữ đầu: "on Monday".',
      },
      {
        vi: 'Thư viện ở cạnh phòng ăn.',
        accepted: [
          'The library is next to the canteen.',
          'The library is next to the cafeteria.',
          'The library is beside the canteen.',
          'The library is beside the cafeteria.',
          'The library is next to the dining room.',
        ],
        hints: [
          h('thư viện', 'library'),
          h('ở cạnh', 'next to'),
          h('phòng ăn', 'canteen'),
        ],
        tip: 'Nói vị trí cần "is": "The library is next to...". Nơi đã xác định dùng "the".',
      },
      {
        vi: 'Chúng tôi không được dùng điện thoại trong lớp.',
        accepted: [
          "We can't use phones in class.",
          "We can't use our phones in class.",
          'We are not allowed to use phones in class.',
          'We are not allowed to use our phones in class.',
          'We must not use phones in class.',
        ],
        hints: [
          h('không được', "can't / not allowed to"),
          h('điện thoại', 'phone'),
          h('trong lớp', 'in class'),
        ],
        tip: '"Không được" là "can\'t", "mustn\'t" hoặc "be not allowed to" + động từ nguyên mẫu.',
      },
      {
        vi: 'Bạn tôi đang làm bài tập về nhà.',
        accepted: [
          'My friend is doing homework.',
          'My friend is doing his homework.',
          'My friend is doing her homework.',
          'My friend is doing their homework.',
        ],
        hints: [h('đang làm', 'is doing'), h('bài tập về nhà', 'homework')],
        tip: '"Đang" là thì hiện tại tiếp diễn: "is + V-ing". "Homework" không đếm được, không thêm -s.',
      },
    ],
  },
  {
    title: 'Dịch câu: Mua sắm (A2)',
    description:
      'Dịch sáu câu khi đi mua sắm: quá khứ đơn, tương lai với "will", so sánh hơn và so sánh nhất.',
    level: 'A2',
    sentences: [
      {
        vi: 'Hôm qua tôi đã mua một đôi giày mới.',
        accepted: [
          'Yesterday I bought a new pair of shoes.',
          'I bought a new pair of shoes yesterday.',
          'Yesterday I bought new shoes.',
          'I bought new shoes yesterday.',
        ],
        hints: [
          h('mua', 'buy (quá khứ: bought)'),
          h('một đôi giày', 'a pair of shoes'),
        ],
        tip: '"Đã" cùng "hôm qua" là quá khứ đơn: buy → "bought".',
      },
      {
        vi: 'Cái áo này đắt hơn cái áo kia.',
        accepted: [
          'This shirt is more expensive than that one.',
          'This shirt is more expensive than that shirt.',
          'This T-shirt is more expensive than that one.',
          'This top is more expensive than that one.',
        ],
        hints: [
          h('cái áo', 'shirt'),
          h('đắt hơn', 'more expensive than'),
          h('cái kia', 'that one'),
        ],
        tip: 'Tính từ dài so sánh hơn: "more + tính từ + than". Không viết "expensiver".',
      },
      {
        vi: 'Cửa hàng mở cửa lúc chín giờ sáng.',
        accepted: [
          'The shop opens at nine in the morning.',
          'The store opens at nine in the morning.',
          'The shop opens at nine a.m.',
          'The store opens at nine a.m.',
          "The shop opens at nine o'clock in the morning.",
        ],
        hints: [
          h('cửa hàng', 'shop / store'),
          h('mở cửa', 'open'),
          h('chín giờ sáng', 'nine a.m.'),
        ],
        tip: 'Giờ giấc cố định dùng hiện tại đơn; chủ ngữ số ít nên động từ thêm -s: "opens".',
      },
      {
        vi: 'Tôi sẽ trả bằng thẻ.',
        accepted: [
          'I will pay by card.',
          'I will pay with my card.',
          'I will pay with a card.',
          'I will pay by credit card.',
        ],
        hints: [
          h('sẽ', 'will'),
          h('trả tiền', 'pay'),
          h('bằng thẻ', 'by card'),
        ],
        tip: '"Sẽ" là "will" + động từ nguyên mẫu: "will pay".',
      },
      {
        vi: 'Siêu thị gần nhà tôi rẻ nhất.',
        accepted: [
          'The supermarket near my house is the cheapest.',
          'The supermarket near my home is the cheapest.',
          'The supermarket near my house is the cheapest one.',
        ],
        hints: [
          h('siêu thị', 'supermarket'),
          h('gần nhà tôi', 'near my house'),
          h('rẻ nhất', 'the cheapest'),
        ],
        tip: 'So sánh nhất của tính từ ngắn: "the + tính từ-est". Cụm "gần nhà tôi" đứng sau danh từ.',
      },
      {
        vi: 'Bạn đã tìm thấy chiếc túi bạn muốn chưa?',
        accepted: [
          'Have you found the bag you wanted?',
          'Did you find the bag you wanted?',
          'Have you found the bag that you wanted?',
          'Did you find the bag that you wanted?',
        ],
        hints: [h('tìm thấy', 'find (V3: found)'), h('chiếc túi', 'bag')],
        tip: '"Đã... chưa?" thường dùng hiện tại hoàn thành: "Have you + V3?". "Found" là V3 của "find".',
      },
    ],
  },
  {
    title: 'Dịch câu: Du lịch (A2)',
    description:
      'Dịch sáu câu về chuyến đi: quá khứ đơn, "will", so sánh hơn, "should" và "may".',
    level: 'A2',
    sentences: [
      {
        vi: 'Năm ngoái chúng tôi đã đi Đà Nẵng.',
        accepted: [
          'Last year we went to Da Nang.',
          'We went to Da Nang last year.',
          'Last year we visited Da Nang.',
          'We visited Da Nang last year.',
          'Last year we traveled to Da Nang.',
          'We travelled to Da Nang last year.',
        ],
        hints: [h('năm ngoái', 'last year'), h('đi (quá khứ)', 'went to')],
        tip: '"Năm ngoái" là quá khứ đơn: go → "went". "Last year" không có "in" hay "the".',
      },
      {
        vi: 'Khách sạn ở rất gần bãi biển.',
        accepted: [
          'The hotel is very close to the beach.',
          'The hotel is very near the beach.',
          'The hotel is really close to the beach.',
        ],
        hints: [
          h('khách sạn', 'hotel'),
          h('gần', 'close to / near'),
          h('bãi biển', 'beach'),
        ],
        tip: '"Gần" là "close to" hoặc "near" ("near" không cần "to"). Nhớ có "is".',
      },
      {
        vi: 'Tôi sẽ đặt vé máy bay vào tuần tới.',
        accepted: [
          'I will book the plane tickets next week.',
          'I will book plane tickets next week.',
          'I will book the flight tickets next week.',
          'I will book flight tickets next week.',
          'I will book the air tickets next week.',
        ],
        hints: [
          h('đặt vé', 'book tickets'),
          h('vé máy bay', 'plane ticket'),
          h('tuần tới', 'next week'),
        ],
        tip: '"Next week" không có "the" hay "in". "Sẽ" là "will" + động từ nguyên mẫu.',
      },
      {
        vi: 'Thời tiết ở Sa Pa lạnh hơn ở Hà Nội.',
        accepted: [
          'The weather in Sa Pa is colder than in Hanoi.',
          'The weather in Sapa is colder than in Hanoi.',
          'The weather in Sa Pa is colder than in Ha Noi.',
          'It is colder in Sa Pa than in Hanoi.',
          'It is colder in Sapa than in Hanoi.',
        ],
        hints: [h('thời tiết', 'weather'), h('lạnh hơn', 'colder than')],
        tip: 'Tính từ ngắn so sánh hơn: "cold → colder than".',
      },
      {
        vi: 'Chúng tôi đã chụp rất nhiều ảnh.',
        accepted: [
          'We took a lot of photos.',
          'We took lots of photos.',
          'We took many photos.',
          'We took a lot of pictures.',
          'We took many pictures.',
        ],
        hints: [
          h('chụp ảnh', 'take photos (quá khứ: took)'),
          h('rất nhiều', 'a lot of'),
        ],
        tip: '"Chụp ảnh" là "take photos"; quá khứ của "take" là "took".',
      },
      {
        vi: 'Bạn nên mang theo áo khoác vì trời có thể mưa.',
        accepted: [
          'You should bring a jacket because it may rain.',
          'You should bring a jacket because it might rain.',
          'You should take a jacket because it may rain.',
          'You should take a jacket because it might rain.',
          'You should bring a jacket because it could rain.',
        ],
        hints: [
          h('nên', 'should'),
          h('áo khoác', 'jacket'),
          h('có thể mưa', 'it may rain'),
        ],
        tip: '"Nên" là "should" + động từ nguyên mẫu. "Có thể" (khả năng) là "may/might". Trời mưa: "it rains".',
      },
    ],
  },
  {
    title: 'Dịch câu: Công việc (A2)',
    description:
      'Dịch sáu câu ở nơi làm việc: hiện tại hoàn thành, "will", "have to", so sánh hơn và lời nhờ lịch sự.',
    level: 'A2',
    sentences: [
      {
        vi: 'Chị ấy đã làm việc ở công ty này ba năm.',
        accepted: [
          'She has worked at this company for three years.',
          'She has worked for this company for three years.',
          'She has worked in this company for three years.',
          'She has been working at this company for three years.',
          'She worked at this company for three years.',
        ],
        hints: [h('công ty', 'company'), h('ba năm', 'for three years')],
        tip: 'Việc kéo dài đến bây giờ dùng hiện tại hoàn thành với "for": "has worked ... for three years".',
      },
      {
        vi: 'Cuộc họp sẽ bắt đầu lúc hai giờ chiều.',
        accepted: [
          'The meeting will start at two in the afternoon.',
          'The meeting will begin at two in the afternoon.',
          'The meeting will start at two p.m.',
          'The meeting starts at two in the afternoon.',
        ],
        hints: [
          h('cuộc họp', 'meeting'),
          h('bắt đầu', 'start / begin'),
          h('hai giờ chiều', 'two p.m.'),
        ],
        tip: '"Sẽ" là "will" + động từ nguyên mẫu; giờ đi với "at".',
      },
      {
        vi: 'Tôi phải gửi báo cáo trước thứ Sáu.',
        accepted: [
          'I have to send the report before Friday.',
          'I must send the report before Friday.',
          'I have to send the report by Friday.',
          'I need to send the report before Friday.',
          'I have to submit the report before Friday.',
        ],
        hints: [
          h('phải', 'have to / must'),
          h('báo cáo', 'report'),
          h('trước thứ Sáu', 'before Friday'),
        ],
        tip: '"Phải" là "have to" hoặc "must" + động từ nguyên mẫu. Hạn chót có thể dùng "by Friday".',
      },
      {
        vi: 'Văn phòng mới lớn hơn văn phòng cũ.',
        accepted: [
          'The new office is bigger than the old one.',
          'The new office is larger than the old one.',
          'The new office is bigger than the old office.',
          'The new office is larger than the old office.',
        ],
        hints: [
          h('văn phòng', 'office'),
          h('lớn hơn', 'bigger than'),
          h('cũ', 'old'),
        ],
        tip: 'big → "bigger" (gấp đôi chữ g). Tránh lặp danh từ bằng "the old one".',
      },
      {
        vi: 'Hôm qua anh ấy không đi làm vì bị ốm.',
        accepted: [
          "He didn't go to work yesterday because he was sick.",
          "He didn't go to work yesterday because he was ill.",
          "Yesterday he didn't go to work because he was sick.",
          "Yesterday he didn't go to work because he was ill.",
        ],
        hints: [h('đi làm', 'go to work'), h('bị ốm', 'be sick / be ill')],
        tip: 'Phủ định quá khứ: "didn\'t" + động từ nguyên mẫu ("go"). "Bị ốm" cần "be": "he was sick".',
      },
      {
        vi: 'Bạn có thể gọi lại cho tôi sau không?',
        accepted: [
          'Can you call me back later?',
          'Could you call me back later?',
          'Can you call me later?',
          'Could you call me later?',
          'Can you phone me back later?',
        ],
        hints: [h('gọi lại', 'call back'), h('sau', 'later')],
        tip: 'Nhờ ai làm gì: "Can you...?", lịch sự hơn "Could you...?". "Gọi lại cho tôi" là "call me back".',
      },
    ],
  },
  {
    title: 'Dịch câu: Sức khỏe (A2)',
    description:
      'Dịch sáu câu về sức khỏe: hiện tại hoàn thành với "since", "should", "tell sb to", V-ing làm chủ ngữ và câu "if".',
    level: 'A2',
    sentences: [
      {
        vi: 'Tôi bị đau đầu từ sáng nay.',
        accepted: [
          'I have had a headache since this morning.',
          'My head has hurt since this morning.',
          'My head has been hurting since this morning.',
        ],
        hints: [
          h('bị đau đầu', 'have a headache'),
          h('từ sáng nay', 'since this morning'),
        ],
        tip: '"Since" + mốc thời gian đi với hiện tại hoàn thành: "I have had a headache since...".',
      },
      {
        vi: 'Bạn nên uống nhiều nước hơn.',
        accepted: [
          'You should drink more water.',
          'You ought to drink more water.',
        ],
        hints: [h('nên', 'should'), h('nhiều nước hơn', 'more water')],
        tip: '"Nên" là "should" + động từ nguyên mẫu. "Nhiều... hơn" với danh từ là "more + danh từ".',
      },
      {
        vi: 'Bác sĩ bảo tôi nghỉ ngơi hai ngày.',
        accepted: [
          'The doctor told me to rest for two days.',
          'The doctor said I should rest for two days.',
          'The doctor asked me to rest for two days.',
        ],
        hints: [
          h('bác sĩ', 'doctor'),
          h('bảo ai làm gì', 'tell someone to do'),
          h('nghỉ ngơi', 'rest'),
        ],
        tip: '"Bảo ai làm gì" là "tell + người + to V"; quá khứ của "tell" là "told".',
      },
      {
        vi: 'Đi bộ mỗi ngày tốt cho sức khỏe.',
        accepted: [
          'Walking every day is good for your health.',
          'Walking every day is good for health.',
          'Walking every day is good for you.',
          'Walking every day is healthy.',
        ],
        hints: [
          h('đi bộ', 'walking'),
          h('tốt cho', 'good for'),
          h('sức khỏe', 'health'),
        ],
        tip: 'Hành động làm chủ ngữ dùng V-ing: "Walking every day is...". Tốt cho = "good for".',
      },
      {
        vi: 'Tối qua tôi ngủ không ngon.',
        accepted: [
          "I didn't sleep well last night.",
          "Last night I didn't sleep well.",
          'I slept badly last night.',
          'I slept poorly last night.',
        ],
        hints: [h('ngủ ngon', 'sleep well'), h('tối qua', 'last night')],
        tip: '"Ngủ ngon" là "sleep well": sau động từ dùng trạng từ "well", không dùng "good".',
      },
      {
        vi: 'Nếu bạn mệt, hãy đi ngủ sớm.',
        accepted: [
          'If you are tired, go to bed early.',
          'If you are tired, go to sleep early.',
          'If you feel tired, go to bed early.',
          'If you feel tired, go to sleep early.',
        ],
        hints: [h('mệt', 'tired'), h('đi ngủ', 'go to bed'), h('sớm', 'early')],
        tip: '"Mệt" là tính từ nên cần "be": "If you are tired". Câu khuyên "hãy..." bắt đầu bằng động từ: "go to bed".',
      },
    ],
  },
];

/** The stored content of one sentence, as the Writing service reads it. */
export function translationTaskContent(
  exercise: TranslationExerciseSeed,
  sentence: TranslationSentenceSeed,
) {
  return {
    skill: 'WRITING',
    taskType: 'SENTENCE_TRANSLATION',
    level: exercise.level,
    prompt: sentence.vi,
    acceptedAnswers: [...sentence.accepted],
    hints: sentence.hints.map((x) => ({ ...x })),
    grammarTip: sentence.tip,
  };
}
