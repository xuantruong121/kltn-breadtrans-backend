import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GRAMMAR_DATA = [
  {
    title: 'Thì Hiện Tại Đơn (Present Simple Tense)',
    level: 'BEGINNER',
    description: 'Chủ điểm ngữ pháp căn bản nhất trong bài thi TOEIC Part 5 & 6, diễn tả thói quen, chân lý và lịch trình cố định.',
    videoYoutubeId: '10r9ke8Gg3Y',
    keyFormula: 'Khẳng định: S + V(s/es) + O | Phủ định: S + do/does not + V_inf | Nghi vấn: Do/Does + S + V_inf?',
    order: 1,
    questions: [
      {
        question: 'Mr. David usually _______ the financial report by 5 PM every Friday.',
        options: ['submits', 'submit', 'submitting', 'submitted'],
        correctIndex: 0,
        explanation: 'Chủ ngữ "Mr. David" là ngôi thứ 3 số ít, có trạng từ chỉ tần suất "usually" chỉ thói quen lặp đi lặp lại nên động từ chia ở hiện tại đơn thêm "s": submits.',
        order: 1,
      },
      {
        question: 'The flight to Tokyo _______ at 9:30 AM tomorrow according to the timetable.',
        options: ['departs', 'departed', 'will be departing', 'depart'],
        correctIndex: 0,
        explanation: 'Thì hiện tại đơn được dùng để diễn tả lịch trình tàu xe, máy bay cố định (timetable/schedule) trong tương lai.',
        order: 2,
      },
      {
        question: 'Water _______ at 100 degrees Celsius under standard atmospheric pressure.',
        options: ['boiling', 'boils', 'boil', 'boiled'],
        correctIndex: 1,
        explanation: 'Diễn tả một chân lý khoa học, sự thật hiển nhiên. Water là danh từ không đếm được nên động từ chia "boils".',
        order: 3,
      },
      {
        question: 'Our marketing team _______ not hold weekly meetings on Mondays.',
        options: ['is', 'do', 'does', 'are'],
        correctIndex: 2,
        explanation: 'Chủ ngữ tập hợp "team" đóng vai trò là một đơn vị số ít trong ngữ cảnh này, trợ động từ phủ định ở hiện tại đơn là "does not".',
        order: 4,
      },
      {
        question: '_______ Ms. Clara handle client inquiries during the weekend?',
        options: ['Is', 'Does', 'Do', 'Are'],
        correctIndex: 1,
        explanation: 'Câu hỏi nghi vấn hiện tại đơn với chủ ngữ số ít "Ms. Clara" và động từ nguyên mẫu "handle", dùng trợ động từ "Does".',
        order: 5,
      },
    ],
  },
  {
    title: 'Thì Hiện Tại Hoàn Thành (Present Perfect Tense)',
    level: 'INTERMEDIATE',
    description: 'Diễn tả hành động đã xảy ra trong quá khứ và vẫn còn ảnh hưởng hoặc tiếp diễn đến hiện tại. Rất phổ biến với since, for, already, yet.',
    videoYoutubeId: 'j9Yd_0G63bU',
    keyFormula: 'S + have/has + V3/V-ed (+ since + mốc thời gian / for + khoảng thời gian)',
    order: 2,
    questions: [
      {
        question: 'The CEO _______ in this corporation for more than twenty years.',
        options: ['has worked', 'works', 'is working', 'worked'],
        correctIndex: 0,
        explanation: 'Có dấu hiệu "for more than twenty years" diễn tả hành động bắt đầu trong quá khứ và kéo dài đến nay -> dùng Present Perfect: has worked.',
        order: 1,
      },
      {
        question: 'We have not received the signed agreement from the vendor _______ .',
        options: ['already', 'yet', 'since', 'just'],
        correctIndex: 1,
        explanation: 'Trạng từ "yet" thường đứng ở cuối câu phủ định hoặc nghi vấn trong thì Hiện tại hoàn thành mang nghĩa "chưa".',
        order: 2,
      },
      {
        question: 'Since Mr. Johnson joined the company, quarterly revenue _______ by 15 percent.',
        options: ['increases', 'has increased', 'increased', 'is increasing'],
        correctIndex: 1,
        explanation: 'Mệnh đề có "Since + mốc thời gian/quá khứ đơn", mệnh đề chính chia thì Hiện tại hoàn thành (has increased).',
        order: 3,
      },
      {
        question: 'They have _______ finalized the contract terms before the meeting.',
        options: ['already', 'yet', 'still', 'ever'],
        correctIndex: 0,
        explanation: '"Already" dùng trong câu khẳng định giữa have/has và V3 để chỉ việc đã hoàn thành sớm hơn mong đợi.',
        order: 4,
      },
      {
        question: 'How many software updates _______ the engineering department released this year?',
        options: ['did', 'has', 'have', 'does'],
        correctIndex: 1,
        explanation: 'Chủ ngữ "the engineering department" là danh từ số ít, thì hiện tại hoàn thành với "this year" dùng trợ động từ "has".',
        order: 5,
      },
    ],
  },
  {
    title: 'Câu Bị Động (Passive Voice)',
    level: 'INTERMEDIATE',
    description: 'Trọng tâm bài thi TOEIC Part 5. Nhấn mạnh vào đối tượng tiếp nhận hành động thay vì người thực hiện.',
    videoYoutubeId: 'nPZ2nwbP3-g',
    keyFormula: 'S + be + V3/V-ed (+ by + O)',
    order: 3,
    questions: [
      {
        question: 'All safety guidelines must be strictly _______ by every employee on site.',
        options: ['observe', 'observed', 'observing', 'observant'],
        correctIndex: 1,
        explanation: 'Cấu trúc bị động với động từ khuyết thiếu: Modal verb + be + V3/V-ed (must be observed).',
        order: 1,
      },
      {
        question: 'The new employee handbook was _______ to all department heads yesterday.',
        options: ['distribute', 'distributing', 'distributed', 'distribution'],
        correctIndex: 2,
        explanation: 'Bị động quá khứ đơn: was + V-ed (was distributed).',
        order: 2,
      },
      {
        question: 'The annual charity banquet is being _______ in the grand ballroom tonight.',
        options: ['held', 'hold', 'holding', 'holds'],
        correctIndex: 0,
        explanation: 'Bị động hiện tại tiếp diễn: is being + V3 (is being held).',
        order: 3,
      },
      {
        question: 'Refund requests will be _______ within three to five business days.',
        options: ['processed', 'process', 'processing', 'processes'],
        correctIndex: 0,
        explanation: 'Bị động tương lai đơn: will be + V3/V-ed (will be processed).',
        order: 4,
      },
      {
        question: 'These confidential files should not _______ without managerial approval.',
        options: ['be accessed', 'access', 'have accessed', 'accessing'],
        correctIndex: 0,
        explanation: 'Bị động: should not + be + V3/V-ed (should not be accessed).',
        order: 5,
      },
    ],
  },
  {
    title: 'Mệnh Đề Quan Hệ (Relative Clauses)',
    level: 'ADVANCED',
    description: 'Cách sử dụng Who, Whom, Whose, Which, That và rút gọn mệnh đề quan hệ dạng V-ing / V-ed.',
    videoYoutubeId: 'GP3p0wP8yZk',
    keyFormula: 'Who (người - S), Whom (người - O), Whose (sở hữu), Which (vật), That (thay thế who/which trong MĐQH xác định)',
    order: 4,
    questions: [
      {
        question: 'The architect _______ designed the new corporate headquarters won a prestigious award.',
        options: ['who', 'which', 'whom', 'whose'],
        correctIndex: 0,
        explanation: 'Đại từ quan hệ thay thế cho danh từ chỉ người "The architect" đóng vai trò chủ ngữ trong mệnh đề phụ -> Dùng "who".',
        order: 1,
      },
      {
        question: 'The software _______ was purchased last month needs to be updated immediately.',
        options: ['which', 'who', 'whose', 'whom'],
        correctIndex: 0,
        explanation: 'Thay thế cho danh từ chỉ vật "The software" đóng vai trò chủ ngữ -> Dùng "which" (hoặc "that").',
        order: 2,
      },
      {
        question: 'Applicants _______ resumes meet the criteria will be contacted for an interview.',
        options: ['whose', 'who', 'which', 'whom'],
        correctIndex: 0,
        explanation: 'Đại từ quan hệ chỉ quan hệ sở hữu giữa Applicants và resumes -> Dùng "whose".',
        order: 3,
      },
      {
        question: 'The conference room _______ we held the board meeting has state-of-the-art audiovisual equipment.',
        options: ['where', 'which', 'who', 'whose'],
        correctIndex: 0,
        explanation: 'Trạng từ quan hệ chỉ nơi chốn "where" (= in which) bổ nghĩa cho "The conference room".',
        order: 4,
      },
      {
        question: 'The proposal _______ by Mr. Kim was unanimously approved by the executive committee.',
        options: ['submitting', 'submitted', 'submits', 'submit'],
        correctIndex: 1,
        explanation: 'Rút gọn mệnh đề quan hệ ở thể bị động: "The proposal (which was) submitted by Mr. Kim" -> chỉ giữ lại V-ed: submitted.',
        order: 5,
      },
    ],
  },
  {
    title: 'Câu Điều Kiện (Conditional Sentences - Type 1 & 2)',
    level: 'INTERMEDIATE',
    description: 'Cấu trúc câu điều kiện loại 1 (có thật ở hiện tại/tương lai) và loại 2 (giả định trái ngược với hiện tại).',
    videoYoutubeId: '77oM0W27F1w',
    keyFormula: 'Loại 1: If + S + V(s/es), S + will/can + V_inf | Loại 2: If + S + V2/were, S + would/could + V_inf',
    order: 5,
    questions: [
      {
        question: 'If the supplier _______ the raw materials on time, we will finish production tomorrow.',
        options: ['delivers', 'delivered', 'will deliver', 'is delivering'],
        correctIndex: 0,
        explanation: 'Câu điều kiện loại 1: Mệnh đề If chia ở hiện tại đơn (delivers), mệnh đề chính dùng will + V_inf.',
        order: 1,
      },
      {
        question: 'If we _______ a larger marketing budget, we would launch an international campaign.',
        options: ['have', 'had', 'will have', 'are having'],
        correctIndex: 1,
        explanation: 'Câu điều kiện loại 2: Mệnh đề chính dùng "would launch" -> Mệnh đề If dùng quá khứ đơn "had".',
        order: 2,
      },
      {
        question: 'Unless the client _______ by noon, the project deadline will be postponed.',
        options: ['approves', 'approved', 'will approve', 'approving'],
        correctIndex: 0,
        explanation: 'Unless = If not. Trong mệnh đề chứa Unless chỉ dùng thì hiện tại đơn, không dùng will (approves).',
        order: 3,
      },
      {
        question: 'If Mr. Harrison _______ here today, he would clarify all the inquiries.',
        options: ['were', 'is', 'was being', 'will be'],
        correctIndex: 0,
        explanation: 'Câu điều kiện loại 2 giả định trái ngược hiện tại: to be chia là "were" cho tất cả các ngôi.',
        order: 4,
      },
      {
        question: 'Should you _______ any further assistance, please do not hesitate to contact customer support.',
        options: ['require', 'requires', 'required', 'requiring'],
        correctIndex: 0,
        explanation: 'Đảo ngữ câu điều kiện loại 1: "Should + S + V_inf" (thay cho If you require...).',
        order: 5,
      },
    ],
  },
  {
    title: 'Sự Hòa Hợp Chủ Ngữ & Động Từ (Subject-Verb Agreement)',
    level: 'ADVANCED',
    description: 'Quy tắc chia động từ theo các cấu trúc đặc biệt: Each of, Neither...nor, Along with, A number of vs The number of.',
    videoYoutubeId: 'pGz3Bw05Vrg',
    keyFormula: 'The number of + N(pl) + V(sing) | A number of + N(pl) + V(pl) | Each/Every + N(sing) + V(sing)',
    order: 6,
    questions: [
      {
        question: 'The number of international attendees at the summit _______ steadily each year.',
        options: ['increases', 'increase', 'increasing', 'are increasing'],
        correctIndex: 0,
        explanation: '"The number of + N số nhiều" luôn đi với động từ số ít (increases).',
        order: 1,
      },
      {
        question: 'A number of innovative solutions _______ proposed during the brainstorming session.',
        options: ['was', 'were', 'is', 'has been'],
        correctIndex: 1,
        explanation: '"A number of + N số nhiều" luôn đi với động từ số nhiều trong quá khứ (were proposed).',
        order: 2,
      },
      {
        question: 'Each of the participants _______ required to sign a non-disclosure agreement.',
        options: ['is', 'are', 'were', 'have been'],
        correctIndex: 0,
        explanation: 'Chủ ngữ "Each of + N số nhiều" động từ luôn chia ở số ít (is required).',
        order: 3,
      },
      {
        question: 'The project manager, along with his team members, _______ attending the seminar tomorrow.',
        options: ['is', 'are', 'were', 'have been'],
        correctIndex: 0,
        explanation: 'Cấu trúc "S1, along with + S2" thì động từ chia theo S1 (The project manager -> số ít: is).',
        order: 4,
      },
      {
        question: 'Neither the supervisor nor the technicians _______ able to locate the technical glitch.',
        options: ['was', 'were', 'is', 'has been'],
        correctIndex: 1,
        explanation: 'Cấu trúc "Neither S1 nor S2" động từ chia theo chủ ngữ gần nó nhất (technicians -> số nhiều: were).',
        order: 5,
      },
    ],
  },
];

async function seedGrammar() {
  console.log('Seeding Grammar Topics & Questions...');

  for (const item of GRAMMAR_DATA) {
    const { questions, ...topicData } = item;

    // Check if topic exists
    let topic = await prisma.grammarTopic.findFirst({
      where: { title: topicData.title },
    });

    if (!topic) {
      topic = await prisma.grammarTopic.create({
        data: topicData,
      });
      console.log(`Created topic: ${topic.title}`);
    } else {
      topic = await prisma.grammarTopic.update({
        where: { id: topic.id },
        data: topicData,
      });
      console.log(`Updated topic: ${topic.title}`);
    }

    // Upsert questions
    await prisma.grammarQuestion.deleteMany({
      where: { topicId: topic.id },
    });

    for (const q of questions) {
      await prisma.grammarQuestion.create({
        data: {
          topicId: topic.id,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          order: q.order,
        },
      });
    }
  }

  console.log('Successfully seeded 6 comprehensive TOEIC Grammar topics!');
}

seedGrammar()
  .catch((e) => {
    console.error('Error seeding grammar:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
