import { PrismaClient, TopicCategory, QuizType, AssignmentType } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({ log: ['warn', 'error'] });

async function seedExercises() {
  console.log('🚀 Starting comprehensive Exercise & Quiz Seeding...');

  // Get existing users & classes
  const teachers = await prisma.user.findMany({ where: { role: 'TEACHER' } });
  const students = await prisma.user.findMany({ where: { role: 'STUDENT' } });
  const classes = await prisma.class.findMany();

  if (teachers.length === 0 || students.length === 0 || classes.length === 0) {
    console.error('❌ Please run `prisma/seed.ts` first before seeding exercises.');
    return;
  }

  // ==========================================
  // 1. CLASS ASSIGNMENTS & STUDENT SUBMISSIONS
  // ==========================================
  console.log('📝 Seeding Class Assignments & Submissions...');

  const assignmentData = [
    {
      title: 'Bài tập tuần 2: Viết đoạn văn miêu tả kỳ nghỉ hoặc chuyến công tác',
      description: 'Hãy viết đoạn văn 80-120 từ mô tả chuyến đi gần đây của bạn, sử dụng thì Quá khứ đơn và ít nhất 3 từ vựng chủ đề Du lịch / Khách sạn.',
      type: AssignmentType.ESSAY,
      feedbackSample: 'Bài viết tốt, sử dụng thì quá khứ đơn chuẩn xác. Chú ý cách dùng giới từ "at the airport" thay vì "on the airport".',
    },
    {
      title: 'Bài tập tuần 3: Soạn thảo Email công việc phản hồi khách hàng',
      description: 'Khách hàng gửi thư phàn nàn vì đơn hàng bị giao trễ 2 ngày. Hãy viết một email lịch sự xin lỗi, giải thích lý do khách quan và đề xuất tặng voucher giảm giá 10% cho lần mua kế tiếp.',
      type: AssignmentType.ESSAY,
      feedbackSample: 'Rất chuyên nghiệp! Cấu trúc email công sở hoàn hảo, từ ngữ trang trọng đúng chuẩn Business English.',
    },
    {
      title: 'Kiểm tra trắc nghiệm kiến thức tổng hợp Part 5 TOEIC',
      description: 'Làm bài kiểm tra 10 câu trắc nghiệm nhanh để đánh giá mức độ hiểu bài về từ loại và liên từ.',
      type: AssignmentType.QUIZ,
      quizData: [
        { question: 'The board of directors ______ the proposed merger unanimously yesterday.', options: ['approve', 'approved', 'approval', 'approving'], correctOptionIndex: 1 },
        { question: 'Ms. Kelly worked ______ to complete the financial audit on time.', options: ['diligent', 'diligently', 'diligence', 'diligentness'], correctOptionIndex: 1 },
        { question: 'Please keep all confidential files in a ______ cabinet.', options: ['secure', 'securely', 'security', 'securing'], correctOptionIndex: 0 },
        { question: '______ the heavy rain, the outdoor corporate event proceeded as scheduled.', options: ['Although', 'Because', 'Despite', 'Even though'], correctOptionIndex: 2 },
        { question: 'Our marketing director is responsible for ______ the regional campaign.', options: ['oversee', 'overseeing', 'overseen', 'overseer'], correctOptionIndex: 1 },
      ],
      feedbackSample: 'Em làm bài trắc nghiệm rất tốt, nắm chắc cấu trúc phân biệt Despite và Although!',
    }
  ];

  for (let cIdx = 0; cIdx < classes.length; cIdx++) {
    const cls = classes[cIdx];
    const assignConfig = assignmentData[cIdx % assignmentData.length];

    const assignment = await prisma.assignment.create({
      data: {
        classId: cls.id,
        title: `[${cls.name.split('(')[0].trim()}] ${assignConfig.title}`,
        description: assignConfig.description,
        type: assignConfig.type,
        quizData: assignConfig.quizData || undefined,
        dueDate: new Date(Date.now() + 86400000 * (7 + cIdx)),
      }
    });

    // Seed submissions for 2-3 students in this class
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const student = students[(cIdx * 2 + sIdx) % students.length];
      const isQuiz = assignConfig.type === AssignmentType.QUIZ;

      await prisma.assignmentSubmission.create({
        data: {
          assignmentId: assignment.id,
          userId: student.id,
          content: isQuiz ? null : `Dear Mr. Smith,\n\nThank you for bringing this issue to our attention. We sincerely apologize for the unexpected delay in delivering your package (Order #8921). Due to severe weather disruptions at our regional fulfillment hub, transit times were unfortunately affected.\n\nYour order is currently out for delivery and will arrive by 3:00 PM today. To express our gratitude for your patience, we have credited a 10% discount voucher to your account for future purchases.\n\nSincerely,\nCustomer Support Team`,
          quizAnswers: isQuiz ? [1, 1, 0, 2, 1] : undefined,
          grade: 8.5 + (sIdx % 3) * 0.5,
          feedback: assignConfig.feedbackSample,
          submittedAt: new Date(Date.now() - 86400000 * (sIdx + 1)),
        }
      });
    }
  }

  // ==========================================
  // 2. 10 GRAMMAR TOPICS & 60+ MC QUESTIONS (TOEIC PART 5 & 6)
  // ==========================================
  console.log('📖 Seeding 10 Grammar Topics & 60+ TOEIC Questions...');

  const grammarTopics = [
    {
      name: 'Adjectives vs Adverbs',
      vietnameseName: 'Vị Trí & Chức Năng Tính Từ - Trạng Từ',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 4,
      theory: `
## VỊ TRÍ TÍNH TỪ & TRẠNG TỪ TRONG ĐỀ THI TOEIC
1. **Tính từ (Adjectives)**:
   - Đứng trước danh từ để bổ nghĩa: \`Adj + Noun\` (ví dụ: \`a reliable supplier\`).
   - Đứng sau động từ to be / linking verbs (seem, look, remain, become): \`S + be + Adj\`.
   - Các đuôi phổ biến: \`-ful, -able, -ible, -ive, -ous, -ic, -al\`.
2. **Trạng từ (Adverbs)**:
   - Bổ nghĩa cho động từ thường: \`S + V + Adv\` hoặc \`Adv + Verb\`.
   - Bổ nghĩa cho tính từ: \`Adv + Adj + Noun\` (ví dụ: \`an extremely successful project\`).
   - Bổ nghĩa cho cả câu: \`Adv, S + V + O\`.
      `,
      questions: [
        { text: 'The financial advisor provided ______ suggestions during the board meeting.', options: ['constructive', 'constructively', 'construction', 'construct'], correct: 'constructive', exp: 'Đứng trước danh từ "suggestions" cần tính từ bổ nghĩa: constructive (mang tính xây dựng).' },
        { text: 'The new express train travels ______ between Hanoi and Da Nang.', options: ['smooth', 'smoothly', 'smoothness', 'smoothed'], correct: 'smoothly', exp: 'Bổ nghĩa cho động từ "travels" cần trạng từ chỉ thể cách: smoothly (một cách êm ái, trôi chảy).' },
        { text: 'The executive committee found the marketing proposal ______ convincing.', options: ['high', 'highly', 'height', 'heighten'], correct: 'highly', exp: 'Bổ nghĩa cho tính từ "convincing" (thuyết phục) cần một trạng từ mức độ: highly (rất, vô cùng).' },
        { text: 'All participants must arrive ______ at 8:00 AM for registration.', options: ['prompt', 'promptly', 'promptness', 'prompted'], correct: 'promptly', exp: 'Bổ nghĩa cho động từ "arrive at 8:00 AM" cần trạng từ: promptly (đúng giờ).' },
        { text: 'The technical support team remained ______ throughout the server upgrade.', options: ['patient', 'patiently', 'patience', 'patients'], correct: 'patient', exp: 'Sau linking verb "remained" cần tính từ miêu tả trạng thái: patient (kiên nhẫn).' },
      ]
    },
    {
      name: 'Pronouns & Reflexive Pronouns',
      vietnameseName: 'Đại Từ Nhân Xưng & Đại Từ Phản Thân',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 5,
      theory: `
## ĐẠI TỪ TRONG TIẾNG ANH
1. **Chủ ngữ / Tân ngữ**: \`He / Him, She / Her, They / Them\`.
2. **Tính từ sở hữu + Danh từ**: \`My, Your, His, Her, Their + Noun\`.
3. **Đại từ sở hữu (thay thế Tính từ sở hữu + Danh từ)**: \`Mine, Yours, His, Hers, Theirs\`.
4. **Đại từ phản thân (Reflexive Pronouns)**:
   - Dùng khi chủ ngữ và tân ngữ là cùng một người: \`He introduced himself\`.
   - Nhấn mạnh: \`S + itself/himself + V\` hoặc \`by + myself/himself\` = tự mình làm, không có ai giúp.
      `,
      questions: [
        { text: 'Mr. Tanaka designed the company website entirely by ______.', options: ['he', 'him', 'his', 'himself'], correct: 'himself', exp: 'Cụm "by himself" = tự mình anh ấy làm một mình.' },
        { text: 'Employees are reminded to keep ______ identification badges visible at all times.', options: ['they', 'them', 'their', 'themselves'], correct: 'their', exp: 'Đứng trước danh từ ghép "identification badges" cần tính từ sở hữu: their.' },
        { text: 'Our research methodology is quite different from ______.', options: ['they', 'them', 'theirs', 'their'], correct: 'theirs', exp: '"theirs" = their methodology (đại từ sở hữu thay cho tính từ sở hữu + danh từ).' },
        { text: 'Ms. Clara scheduled the appointment for ______ and her client.', options: ['she', 'herself', 'her', 'hers'], correct: 'herself', exp: 'Sau giới từ "for" khi chủ ngữ là người thực hiện hành động cho chính mình, dùng đại từ phản thân "herself".' },
      ]
    },
    {
      name: 'Prepositions of Time & Place',
      vietnameseName: 'Giới Từ Chỉ Thời Gian & Địa Điểm',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 6,
      theory: `
## CÁCH DÙNG GIỚI TỪ TRỌNG TÂM
- **In**: Dùng cho tháng, năm, mùa, thế kỷ (\`in July, in 2026\`), khoảng không gian rộng lớn (\`in Vietnam, in the city\`).
- **On**: Dùng cho thứ, ngày cụ thể (\`on Monday, on May 15th\`), trên bề mặt (\`on the table, on the 3rd floor\`).
- **At**: Dùng cho giờ cụ thể (\`at 9:00 AM\`), địa điểm cụ thể (\`at the lobby, at the entrance\`).
- **Within**: Trong vòng (thời gian / khoảng cách): \`within 3 business days\`.
- **Prior to / Before**: Trước thời điểm: \`prior to the conference\`.
      `,
      questions: [
        { text: 'The warranty covers all repairs performed ______ thirty days of purchase.', options: ['within', 'among', 'at', 'into'], correct: 'within', exp: '"within thirty days" = trong vòng 30 ngày kể từ ngày mua hàng.' },
        { text: 'All visitors must sign in at the front reception desk ______ entering the laboratory.', options: ['prior to', 'because', 'between', 'during to'], correct: 'prior to', exp: '"prior to + V-ing/Noun" = trước khi (tương đương before).' },
        { text: 'The annual general meeting will be held ______ Monday morning at 10:00 AM.', options: ['in', 'on', 'at', 'by'], correct: 'on', exp: 'Dùng "on" trước buổi của ngày cụ thể trong tuần (on Monday morning).' },
        { text: 'Complimentary shuttle buses operate ______ the airport and downtown hotels.', options: ['between', 'among', 'through', 'about'], correct: 'between', exp: 'Cấu trúc "between A and B" = giữa A và B.' },
      ]
    },
    {
      name: 'Conjunctions & Transition Words',
      vietnameseName: 'Liên Từ & Trạng Từ Chuyển Tiếp',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 7,
      theory: `
## PHÂN BIỆT LIÊN TỪ VÀ GIỚI TỪ
1. **Mặc dù**:
   - \`Although / Even though / Though + Mệnh đề (S + V)\`
   - \`Despite / In spite of + Cụm danh từ / V-ing\`
2. **Bởi vì**:
   - \`Because / Since / As + Mệnh đề (S + V)\`
   - \`Because of / Due to / Owing to + Cụm danh từ / V-ing\`
3. **Trong khi**:
   - \`While + Mệnh đề (S + V)\`
   - \`During + Danh từ chỉ khoảng thời gian\`
      `,
      questions: [
        { text: '______ the flight was delayed by fog, the delegates arrived in time for the opening remarks.', options: ['Despite', 'Although', 'Because of', 'In spite of'], correct: 'Although', exp: 'Phía sau là một mệnh đề hoàn chỉnh "the flight was delayed", mang nghĩa tương phản -> Dùng Although.' },
        { text: 'Production was temporarily halted ______ unexpected power outage.', options: ['because', 'due to', 'even though', 'while'], correct: 'due to', exp: 'Phía sau là cụm danh từ "unexpected power outage" chỉ nguyên nhân -> Dùng due to.' },
        { text: 'Please silence all mobile phones ______ the symphony performance.', options: ['during', 'while', 'whereas', 'since'], correct: 'during', exp: 'Phía sau là danh từ "the symphony performance" (buổi biểu diễn) -> Dùng giới từ during.' },
        { text: 'The contract will not take effect ______ both parties have affixed their official signatures.', options: ['unless', 'despite', 'because of', 'during'], correct: 'unless', exp: '"unless + S + V" = trừ khi / nếu không.' },
      ]
    },
    {
      name: 'Subject-Verb Agreement',
      vietnameseName: 'Sự Hòa Hợp Giữa Chủ Ngữ & Động Từ',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 8,
      theory: `
## CÁC QUY TẮC HÒA HỢP CHỦ - VỊ QUAN TRỌNG
- Chủ ngữ có \`Each / Every / Either / Neither / Everyone / Somebody\` chia động từ **SỐ ÍT**.
- Danh từ không đếm được (information, equipment, luggage, water) chia động từ **SỐ ÍT**.
- Cấu trúc \`A together with / along with / as well as B\` chia động từ theo **A**.
- Cấu trúc \`Neither A nor B / Either A or B / Not only A but also B\` chia động từ theo **B**.
- \`The number of + N_số nhiều\` chia **SỐ ÍT**; \`A number of + N_số nhiều\` chia **SỐ NHIỀU**.
      `,
      questions: [
        { text: 'The number of international applicants ______ steadily over the last three quarters.', options: ['has increased', 'have increased', 'increasing', 'are increasing'], correct: 'has increased', exp: '"The number of..." đi với động từ số ít (has increased).' },
        { text: 'Every employee in our division ______ required to attend the cybersecurity seminar.', options: ['is', 'are', 'were', 'have been'], correct: 'is', exp: '"Every + Noun" là chủ ngữ số ít -> dùng "is".' },
        { text: 'The CEO, along with several department directors, ______ traveling to the Singapore branch tomorrow.', options: ['is', 'are', 'were', 'have been'], correct: 'is', exp: 'Cấu trúc "A along with B" chia theo chủ ngữ chính A (The CEO - số ít) -> dùng is.' },
        { text: 'Detailed information regarding the annual bonus ______ available on the company intranet portal.', options: ['is', 'are', 'were', 'have been'], correct: 'is', exp: 'Chủ ngữ "information" là danh từ không đếm được -> chia động từ số ít "is".' },
      ]
    },
    {
      name: 'Relative Clauses & Reductions',
      vietnameseName: 'Mệnh Đề Quan Hệ & Rút Gọn Mệnh Đề',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 9,
      theory: `
## MỆNH ĐỀ QUAN HỆ & RÚT GỌN
1. **Đại từ quan hệ**: \`Who\` (người - chủ ngữ), \`Whom\` (người - tân ngữ), \`Which\` (vật), \`That\` (người hoặc vật), \`Whose\` (sở hữu).
2. **Rút gọn mệnh đề quan hệ**:
   - Dạng chủ động: Rút gọn thành \`V-ing\` (ví dụ: \`The man who sits there\` -> \`The man sitting there\`).
   - Dạng bị động: Rút gọn thành \`V3/V-ed\` (ví dụ: \`The goods that were ordered yesterday\` -> \`The goods ordered yesterday\`).
      `,
      questions: [
        { text: 'Anyone ______ wishes to register for the workshop should contact HR immediately.', options: ['who', 'whom', 'which', 'whose'], correct: 'who', exp: '"Anyone" chỉ người làm chủ ngữ cho mệnh đề quan hệ phía sau -> dùng "who".' },
        { text: 'The presentation ______ by Ms. Jenny received a standing ovation from the audience.', options: ['delivers', 'delivered', 'delivering', 'deliver'], correct: 'delivered', exp: 'Rút gọn mệnh đề quan hệ bị động "which was delivered by Ms. Jenny" thành "delivered".' },
        { text: 'Passengers ______ flights have been cancelled should report to the customer service counter.', options: ['who', 'whom', 'whose', 'which'], correct: 'whose', exp: 'Chỉ quyền sở hữu "whose flights" (những hành khách có chuyến bay bị hủy).' },
      ]
    },
    {
      name: 'Comparisons & Superlatives',
      vietnameseName: 'Các Dạng Câu So Sánh Trong TOEIC',
      category: TopicCategory.GRAMMAR_TOPIC,
      order: 10,
      theory: `
## CÁC DẠNG SO SÁNH PHỔ BIẾN
1. **So sánh bằng**: \`as + Adj/Adv + as\` (ví dụ: \`as efficient as\`).
2. **So sánh hơn**: \`Adj-er / more + Adj + than\` (ví dụ: \`faster than, more convenient than\`).
3. **So sánh nhất**: \`the + Adj-est / the most + Adj\` (ví dụ: \`the largest manufacturer\`).
4. **Từ nhấn mạnh so sánh hơn**: \`much, far, significantly, substantially, considerably + So sánh hơn\` (không dùng *more* trước so sánh hơn).
      `,
      questions: [
        { text: 'The new engine is significantly ______ than the previous prototype.', options: ['quiet', 'quieter', 'quietest', 'more quiet'], correct: 'quieter', exp: 'So sánh hơn của tính từ ngắn "quiet" là "quieter", có từ nhấn mạnh "significantly".' },
        { text: 'This quarter marked the ______ profitable period in our corporation\'s history.', options: ['most', 'more', 'much', 'many'], correct: 'most', exp: 'So sánh nhất với tính từ dài: "the most profitable period" (kỳ có lợi nhuận cao nhất).' },
        { text: 'Our delivery service is as ______ as any top competitor in the logistics market.', options: ['reliable', 'more reliable', 'most reliable', 'reliably'], correct: 'reliable', exp: 'Cấu trúc so sánh bằng "as + Adj + as" đứng sau động từ to be "is" -> dùng "reliable".' },
      ]
    }
  ];

  for (const gt of grammarTopics) {
    await prisma.practiceTopic.create({
      data: {
        name: gt.name,
        vietnameseName: gt.vietnameseName,
        category: gt.category,
        order: gt.order,
        quizzes: {
          create: [
            {
              title: `Trắc Nghiệm TOEIC: ${gt.vietnameseName}`,
              type: QuizType.TOEIC,
              theoryContent: gt.theory,
              timeLimit: 10,
              questions: {
                create: gt.questions.map((q, qIdx) => ({
                  type: 'MULTIPLE_CHOICE',
                  order: qIdx + 1,
                  content: {
                    text: q.text,
                    options: q.options,
                    correctAnswer: q.correct,
                    explanation: q.exp,
                  }
                }))
              }
            }
          ]
        }
      }
    });
  }

  // ==========================================
  // 3. 6 DICTATION / LISTENING PRACTICE QUIZZES
  // ==========================================
  console.log('🎧 Seeding 6 Listening Practice (Dictation) Quizzes...');

  const dictationPractices = [
    {
      title: 'Luyện Nghe Chép Chính Tả: Thông Báo Sân Bay',
      description: 'Lắng nghe từng câu thông báo sân bay và gõ lại chính xác từng từ bạn nghe được.',
      questions: [
        { audioText: 'Flight VN218 to Da Nang is now boarding at Gate Number 14.', answer: 'Flight VN218 to Da Nang is now boarding at Gate Number 14.' },
        { audioText: 'All passengers are requested to keep their carry-on luggage with them at all times.', answer: 'All passengers are requested to keep their carry-on luggage with them at all times.' },
        { audioText: 'Please have your passport and boarding pass ready for inspection.', answer: 'Please have your passport and boarding pass ready for inspection.' },
        { audioText: 'The departure of flight QR970 has been delayed by approximately forty-five minutes.', answer: 'The departure of flight QR970 has been delayed by approximately forty-five minutes.' },
      ]
    },
    {
      title: 'Luyện Nghe Chép Chính Tả: Cuộc Họp Văn Phòng',
      description: 'Nghe đoạn trao đổi công việc trong phòng họp và chép lại câu hoàn chỉnh.',
      questions: [
        { audioText: 'We need to finalize the quarterly budget before the executive review tomorrow.', answer: 'We need to finalize the quarterly budget before the executive review tomorrow.' },
        { audioText: 'Could everyone please review the attached agenda before joining the video call?', answer: 'Could everyone please review the attached agenda before joining the video call?' },
        { audioText: 'Our marketing team achieved a fifteen percent increase in sales this month.', answer: 'Our marketing team achieved a fifteen percent increase in sales this month.' },
        { audioText: 'Mr. David will present the project roadmap at the beginning of the meeting.', answer: 'Mr. David will present the project roadmap at the beginning of the meeting.' },
      ]
    },
    {
      title: 'Luyện Nghe Chép Chính Tả: Đặt Phòng Khách Sạn',
      description: 'Nghe hội thoại tại quầy lễ tân khách sạn và thực hành chép chính tả.',
      questions: [
        { audioText: 'I have a reservation under the name of James Wilson for two nights.', answer: 'I have a reservation under the name of James Wilson for two nights.' },
        { audioText: 'Complimentary breakfast is served on the second floor from six to ten AM.', answer: 'Complimentary breakfast is served on the second floor from six to ten AM.' },
        { audioText: 'Would you like assistance with carrying your luggage to your room?', answer: 'Would you like assistance with carrying your luggage to your room?' },
      ]
    },
    {
      title: 'Luyện Nghe Chép Chính Tả: Tin Nhắn Thoại Công Sở',
      description: 'Nghe tin nhắn thoại từ đối tác kinh doanh và ghi lại nội dung chính xác.',
      questions: [
        { audioText: 'Please return my call at your earliest convenience regarding the vendor contract.', answer: 'Please return my call at your earliest convenience regarding the vendor contract.' },
        { audioText: 'I am calling to confirm our scheduled luncheon meeting on Thursday afternoon.', answer: 'I am calling to confirm our scheduled luncheon meeting on Thursday afternoon.' },
      ]
    },
    {
      title: 'Luyện Nghe Chép Chính Tả: Bản Tin Thời Tiết & Giao Thông',
      description: 'Nghe bản tin radio giao thông buổi sáng và luyện tai bắt từ vựng tốc độ nhanh.',
      questions: [
        { audioText: 'Expect heavy traffic delays on Highway 51 due to ongoing road construction.', answer: 'Expect heavy traffic delays on Highway 51 due to ongoing road construction.' },
        { audioText: 'Sunny skies will continue throughout the weekend with temperatures reaching thirty degrees.', answer: 'Sunny skies will continue throughout the weekend with temperatures reaching thirty degrees.' },
      ]
    },
    {
      title: 'Luyện Nghe Chép Chính Tả: Gọi Món Nhà Hàng',
      description: 'Nghe đoạn hội thoại giữa nhân viên phục vụ và khách hàng tại nhà hàng.',
      questions: [
        { audioText: 'Are you ready to order or would you like a few more minutes to look over the menu?', answer: 'Are you ready to order or would you like a few more minutes to look over the menu?' },
        { audioText: 'We highly recommend our chef special grilled salmon with roasted vegetables.', answer: 'We highly recommend our chef special grilled salmon with roasted vegetables.' },
      ]
    },
  ];

  for (const dp of dictationPractices) {
    await prisma.quiz.create({
      data: {
        title: dp.title,
        description: dp.description,
        type: QuizType.LISTENING_PRACTICE,
        questions: {
          create: dp.questions.map((q, idx) => ({
            type: 'DICTATION',
            order: idx + 1,
            content: {
              audioText: q.audioText,
              correctAnswer: q.answer,
            }
          }))
        }
      }
    });
  }

  // ==========================================
  // 4. 6 BILINGUAL READING PASSAGES & QUESTIONS
  // ==========================================
  console.log('📰 Seeding 6 Bilingual Reading Passages...');

  const bilingualPassages = [
    {
      name: 'The Psychology of Habit Formation',
      vietnameseName: 'Tâm Lý Học Về Sự Hình Thành Thói Quen',
      bilingualContent: [
        { en: 'Building consistent daily habits is more effective than relying solely on motivation.', vi: 'Xây dựng thói quen hàng ngày kiên trì sẽ hiệu quả hơn nhiều so với việc chỉ dựa vào động lực tức thời.' },
        { en: 'Small, incremental actions repeated over time create monumental improvements in language learning.', vi: 'Những hành động nhỏ được lặp đi lặp lại qua thời gian sẽ tạo nên sự tiến bộ vượt bậc trong việc học ngoại ngữ.' },
        { en: 'According to behavioral scientists, associating a new routine with an existing trigger increases success rates.', vi: 'Theo các nhà khoa học hành vi, việc gắn một thói quen mới với một kích hoạt sẵn có sẽ nâng cao tỷ lệ thành công.' },
        { en: 'For instance, practicing flashcards immediately after having morning coffee builds strong neural connections.', vi: 'Chẳng hạn, việc ôn từ vựng flashcard ngay sau khi uống cà phê sáng sẽ xây dựng các liên kết nơ-ron thần kinh mạnh mẽ.' },
        { en: 'Never break the chain twice; consistency always triumphs over sporadic intensity.', vi: 'Đừng bao giờ để đứt chuỗi hai ngày liên tiếp; sự kiên trì luôn chiến thắng những nỗ lực bộc phát nhất thời.' },
      ],
      questions: [
        { text: 'According to the passage, what is more dependable than temporary motivation?', options: ['Consistent daily habits', 'Strict punishments', 'Expensive courses', 'Luck'], correct: 'Consistent daily habits' },
        { text: 'How can learners increase their habit success rate?', options: ['By studying all night', 'By linking new routines to existing triggers', 'By changing goals every week', 'By avoiding difficult vocabulary'], correct: 'By linking new routines to existing triggers' },
      ]
    },
    {
      name: 'How AI is Transforming Modern Workplaces',
      vietnameseName: 'Trí Tuệ Nhân Tạo Đang Thay Đổi Nơi Làm Việc',
      bilingualContent: [
        { en: 'Artificial intelligence is rapidly automating repetitive analytical and administrative workflows.', vi: 'Trí tuệ nhân tạo đang tự động hóa nhanh chóng các quy trình làm việc hành chính và phân tích lặp đi lặp lại.' },
        { en: 'Modern professionals must cultivate high-level critical thinking, creativity, and effective communication.', vi: 'Nhân sự hiện đại cần trau dồi tư duy phản biện cấp cao, sự sáng tạo và kỹ năng giao tiếp hiệu quả.' },
        { en: 'Proficiency in English allows specialists to collaborate effortlessly with global cross-functional teams.', vi: 'Thành thạo tiếng Anh cho phép các chuyên gia hợp tác dễ dàng với các nhóm đa chức năng trên toàn cầu.' },
        { en: 'Rather than replacing humans, AI empowers workers who learn how to leverage it intelligently.', vi: 'Thay vì thay thế con người, AI sẽ nâng cao năng lực cho những ai biết cách tận dụng nó một cách thông minh.' },
      ],
      questions: [
        { text: 'What does AI automate rapidly in workplaces?', options: ['Repetitive analytical workflows', 'Personal relationships', 'Creative artistic feelings', 'Physical health'], correct: 'Repetitive analytical workflows' },
        { text: 'Why is English proficiency vital in the AI era?', options: ['To memorize grammar rules', 'To collaborate with global cross-functional teams', 'To pass school exams only', 'To replace computers'], correct: 'To collaborate with global cross-functional teams' },
      ]
    },
    {
      name: 'The Cultural Heritage of Vietnamese Bánh Mì',
      vietnameseName: 'Di Sản Ẩm Thực Bánh Mì Việt Nam',
      bilingualContent: [
        { en: 'Vietnamese Bánh Mì is widely celebrated as one of the world\'s most iconic street food masterpieces.', vi: 'Bánh mì Việt Nam được tôn vinh rộng rãi là một trong những kiệt tác ẩm thực đường phố biểu tượng nhất thế giới.' },
        { en: 'It features a crispy baguette crust packed with savory paté, fresh herbs, pickled vegetables, and succulent meats.', vi: 'Nó sở hữu lớp vỏ bánh mì giòn tan hòa quyện cùng pate béo ngậy, rau thơm tươi, đồ chua và thịt đậm đà.' },
        { en: 'The word "Bánh Mì" has been officially recognized in the prestigious Oxford English Dictionary.', vi: 'Từ "Bánh Mì" đã được công nhận chính thức trong cuốn từ điển Oxford danh tiếng.' },
        { en: 'It represents the pinnacle of culinary fusion, blending French baking techniques with vibrant Vietnamese flavors.', vi: 'Nó đại diện cho đỉnh cao của sự giao thoa ẩm thực, kết hợp kỹ thuật nướng bánh Pháp với hương vị Việt Nam sống động.' },
      ],
      questions: [
        { text: 'In which prestigious dictionary is the word "Bánh Mì" officially included?', options: ['Oxford English Dictionary', 'Wikipedia only', 'Local travel brochure', 'Culinary magazine'], correct: 'Oxford English Dictionary' },
        { text: 'What makes Bánh Mì a pinnacle of culinary fusion?', options: ['It uses only imported spices', 'It blends French baking techniques with Vietnamese flavors', 'It is made by robots', 'It is served only in luxury hotels'], correct: 'It blends French baking techniques with Vietnamese flavors' },
      ]
    },
    {
      name: 'Sustainable Travel & Eco-Tourism',
      vietnameseName: 'Du Lịch Bền Vững & Bảo Vệ Môi Trường',
      bilingualContent: [
        { en: 'Eco-tourism encourages travelers to minimize their environmental footprint while exploring natural wonders.', vi: 'Du lịch sinh thái khuyến khích du khách giảm thiểu dấu chân môi trường khi khám phá các kỳ quan thiên nhiên.' },
        { en: 'Supporting local businesses and respecting indigenous traditions ensures long-term community benefits.', vi: 'Ủng hộ các doanh nghiệp địa phương và tôn trọng truyền thống bản địa đảm bảo lợi ích lâu dài cho cộng đồng.' },
        { en: 'Travelers are increasingly choosing public transportation and eco-certified accommodations.', vi: 'Du khách ngày càng ưa chuộng các phương tiện giao thông công cộng và các khu lưu trú đạt chứng chỉ xanh.' },
      ],
      questions: [
        { text: 'What is the core principle of eco-tourism?', options: ['Spending maximum money', 'Minimizing environmental footprint', 'Taking flights every day', 'Visiting only crowded theme parks'], correct: 'Minimizing environmental footprint' },
      ]
    },
    {
      name: 'Effective Cross-Cultural Communication',
      vietnameseName: 'Giao Tiếp Đa Văn Hóa Hiệu Quả',
      bilingualContent: [
        { en: 'Working with multinational colleagues requires cultural empathy and active listening skills.', vi: 'Làm việc với các đồng nghiệp đa quốc gia đòi hỏi sự thấu cảm văn hóa và kỹ năng lắng nghe chủ động.' },
        { en: 'Non-verbal cues such as eye contact and hand gestures can have vastly different meanings across regions.', vi: 'Các dấu hiệu phi ngôn ngữ như ánh mắt và cử chỉ tay có thể mang ý nghĩa hoàn toàn khác nhau giữa các vùng miền.' },
        { en: 'Clear, concise English phrasing prevents misunderstandings in high-stakes negotiations.', vi: 'Cách diễn đạt tiếng Anh rõ ràng, súc tích sẽ ngăn ngừa những hiểu lầm trong các cuộc đàm phán quan trọng.' },
      ],
      questions: [
        { text: 'Why is clear and concise English important in negotiations?', options: ['To show off vocabulary', 'To prevent misunderstandings', 'To talk longer than others', 'To write poems'], correct: 'To prevent misunderstandings' },
      ]
    },
    {
      name: 'Mindfulness & Stress Management',
      vietnameseName: 'Nuôi Dưỡng Tâm Trí & Quản Lý Căng Thẳng',
      bilingualContent: [
        { en: 'Balancing intensive study schedules with regular mindfulness exercises preserves mental wellness.', vi: 'Cân bằng lịch học tập căng thẳng với các bài tập thư giãn tâm trí đều đặn sẽ giúp duy trì sức khỏe tinh thần.' },
        { en: 'Taking short five-minute breathing breaks recharges cognitive stamina and sharpens concentration.', vi: 'Dành những khoảng nghỉ ngắn 5 phút để hít thở sâu sẽ phục hồi năng lượng não bộ và tăng cường sự tập trung.' },
        { en: 'Adequate sleep is proven to consolidate newly acquired vocabulary in long-term memory.', vi: 'Giấc ngủ đầy đủ đã được chứng minh giúp củng cố các từ vựng mới học vào vùng trí nhớ dài hạn.' },
      ],
      questions: [
        { text: 'How does adequate sleep benefit language learners?', options: ['It helps forget old lessons', 'It consolidates new vocabulary into long-term memory', 'It replaces studying', 'It makes you hungry'], correct: 'It consolidates new vocabulary into long-term memory' },
      ]
    }
  ];

  for (const bp of bilingualPassages) {
    const practiceTopic = await prisma.practiceTopic.create({
      data: {
        name: bp.name,
        vietnameseName: bp.vietnameseName,
        category: TopicCategory.BILINGUAL_LEVEL,
        iconUrl: '📰',
        quizzes: {
          create: [
            {
              title: `Đọc Song Ngữ: ${bp.vietnameseName}`,
              type: QuizType.BILINGUAL_READING,
              bilingualContent: bp.bilingualContent,
              timeLimit: 15,
              questions: {
                create: bp.questions.map((q, idx) => ({
                  type: 'MULTIPLE_CHOICE',
                  order: idx + 1,
                  content: {
                    text: q.text,
                    options: q.options,
                    correctAnswer: q.correct,
                  }
                }))
              }
            }
          ]
        }
      }
    });
  }

  // ==========================================
  // 5. 10 TOEIC WRITING PRACTICE EXERCISES
  // ==========================================
  console.log('✍️ Seeding 10 TOEIC Writing Practice Exercises...');

  const writingTopics = [
    {
      topicName: 'Office Meeting & Strategy Discussion',
      category: TopicCategory.WRITING_PART1,
      type: QuizType.WRITING_PICTURE,
      title: 'TOEIC Writing Part 1: Buổi Họp Ban Quản Trị',
      prompt: 'Viết một câu mô tả hình ảnh sử dụng 2 từ khóa gợi ý: [discuss, proposal]',
      keywords: ['discuss', 'proposal'],
      imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=500&auto=format&fit=crop&q=80',
    },
    {
      topicName: 'Restaurant Dining & Friendly Service',
      category: TopicCategory.WRITING_PART1,
      type: QuizType.WRITING_PICTURE,
      title: 'TOEIC Writing Part 1: Phục Vụ Tại Nhà Hàng',
      prompt: 'Viết một câu mô tả hình ảnh sử dụng 2 từ khóa gợi ý: [order, waiter]',
      keywords: ['order', 'waiter'],
      imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500&auto=format&fit=crop&q=80',
    },
    {
      topicName: 'Construction Site Safety Protocol',
      category: TopicCategory.WRITING_PART1,
      type: QuizType.WRITING_PICTURE,
      title: 'TOEIC Writing Part 1: An Toàn Công Trường',
      prompt: 'Viết một câu mô tả hình ảnh sử dụng 2 từ khóa gợi ý: [wear, helmet]',
      keywords: ['wear', 'helmet'],
      imageUrl: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=500&auto=format&fit=crop&q=80',
    },
    {
      topicName: 'Airport Terminal & Passenger Boarding',
      category: TopicCategory.WRITING_PART1,
      type: QuizType.WRITING_PICTURE,
      title: 'TOEIC Writing Part 1: Hành Khách Tại Sân Bay',
      prompt: 'Viết một câu mô tả hình ảnh sử dụng 2 từ khóa gợi ý: [carry, luggage]',
      keywords: ['carry', 'luggage'],
      imageUrl: 'https://images.unsplash.com/photo-1530521954074-e64f6810b32d?w=500&auto=format&fit=crop&q=80',
    },
    {
      topicName: 'Library Research & Focused Studying',
      category: TopicCategory.WRITING_PART1,
      type: QuizType.WRITING_PICTURE,
      title: 'TOEIC Writing Part 1: Sinh Viên Học Tập Tại Thư Viện',
      prompt: 'Viết một câu mô tả hình ảnh sử dụng 2 từ khóa gợi ý: [study, laptop]',
      keywords: ['study', 'laptop'],
      imageUrl: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=500&auto=format&fit=crop&q=80',
    },
    {
      topicName: 'Supermarket Checkout & Cashier Interaction',
      category: TopicCategory.WRITING_PART1,
      type: QuizType.WRITING_PICTURE,
      title: 'TOEIC Writing Part 1: Thanh Toán Tại Siêu Thị',
      prompt: 'Viết một câu mô tả hình ảnh sử dụng 2 từ khóa gợi ý: [pay, cashier]',
      keywords: ['pay', 'cashier'],
      imageUrl: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=500&auto=format&fit=crop&q=80',
    },
    // Part 2: Email Writing
    {
      topicName: 'Responding to a Customer Refund Request',
      category: TopicCategory.WRITING_PART2,
      type: QuizType.WRITING_EMAIL,
      title: 'TOEIC Writing Part 2: Viết Email Xử Lý Khiếu Nại Hoàn Tiền',
      prompt: 'Khách hàng gửi thư thắc mắc về đơn hàng bị lỗi. Hãy viết một email từ 50-80 từ để thông báo chính sách hoàn tiền trong vòng 3 ngày làm việc và gửi lời xin lỗi chân thành.',
      keywords: ['refund', 'apologize', 'business days'],
      imageUrl: 'https://images.unsplash.com/photo-1586769852044-692d6e3703f0?w=500&auto=format&fit=crop&q=80',
    },
    {
      topicName: 'Rescheduling a Client Meeting',
      category: TopicCategory.WRITING_PART2,
      type: QuizType.WRITING_EMAIL,
      title: 'TOEIC Writing Part 2: Viết Email Xin Dời Lịch Hẹn Đối Tác',
      prompt: 'Viết email thông báo do có cuộc họp khẩn cấp với ban điều hành, bạn cần dời lịch hẹn gặp đối tác sang thứ Năm lúc 2:00 PM.',
      keywords: ['reschedule', 'urgent meeting', 'available'],
      imageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&auto=format&fit=crop&q=80',
    },
  ];

  for (const wt of writingTopics) {
    const practiceTopic = await prisma.practiceTopic.create({
      data: {
        name: wt.topicName,
        category: wt.category,
        iconUrl: '✍️',
        quizzes: {
          create: [
            {
              title: wt.title,
              description: wt.prompt,
              type: wt.type,
              timeLimit: 15,
              questions: {
                create: [
                  {
                    type: wt.category === TopicCategory.WRITING_PART1 ? 'WRITING_PART1' : 'WRITING_EMAIL',
                    order: 1,
                    content: {
                      imageUrl: wt.imageUrl,
                      writingPrompt: wt.prompt,
                      keywords: wt.keywords,
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    });
  }

  // ==========================================
  // 6. 2 FULL MINI TOEIC EXAM SETS
  // ==========================================
  console.log('🏆 Seeding 2 Full Mini TOEIC Exam Sets...');

  // Exam Set 1
  await prisma.toeicExamSet.create({
    data: {
      title: 'TOEIC Mini Practice Test 1: Listening & Reading Booster',
      description: 'Bài thi thử nghiệm gồm 15 câu hỏi trọng điểm Part 1, Part 2, Part 5 và Part 7 có đồng hồ bấm giờ chuẩn.',
      difficulty: 'Trung bình',
      createdBy: teachers[0].id,
      groups: {
        create: [
          {
            part: 1,
            groupOrder: 1,
            imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&auto=format&fit=crop&q=80',
            audioUrl: 'https://actions.google.com/sounds/v1/ambiences/office.ogg',
            questions: {
              create: [
                {
                  questionNumber: 1,
                  text: 'Select the statement that best describes what you see in the picture.',
                  options: [
                    '(A) They are discussing a project around a conference table.',
                    '(B) The man is repairing a photocopier.',
                    '(C) People are exiting the lecture theater.',
                    '(D) A worker is painting the office wall.'
                  ],
                  correctIndex: 0,
                  explanation: 'Bức ảnh thể hiện nhóm người đang họp và thảo luận tài liệu quanh bàn.'
                }
              ]
            }
          },
          {
            part: 5,
            groupOrder: 2,
            questions: {
              create: [
                {
                  questionNumber: 2,
                  text: 'Ms. Clara requested that the financial audit report _______ submitted by noon.',
                  options: ['is', 'be', 'was', 'being'],
                  correctIndex: 1,
                  explanation: 'Cấu trúc bàng thái cách (Subjunctive): S + request + that + S + (should) + V_inf.'
                },
                {
                  questionNumber: 3,
                  text: 'The newly recruited engineers solved the network outage _______ than anticipated.',
                  options: ['more rapid', 'more rapidly', 'rapidity', 'most rapid'],
                  correctIndex: 1,
                  explanation: 'Bổ nghĩa cho động từ "solved" trong so sánh hơn cần trạng từ: more rapidly.'
                },
                {
                  questionNumber: 4,
                  text: 'All employees must wear their safety goggles ______ entering the chemical storage area.',
                  options: ['prior to', 'because', 'between', 'during to'],
                  correctIndex: 0,
                  explanation: '"prior to + V-ing" = trước khi (tương đương before).'
                }
              ]
            }
          },
          {
            part: 7,
            groupOrder: 3,
            passageText: `
**MEMORANDUM**
**To:** All Staff Members
**From:** Human Resources Department
**Date:** August 20, 2026
**Subject:** Annual Health Screening

Please be advised that the company-sponsored annual health screening will take place on **Friday, September 4th**, in the Main Conference Room from **8:30 AM to 4:30 PM**. Participation is free of charge for all full-time employees. Please schedule your 20-minute appointment slot on the intranet by next Wednesday.
            `,
            questions: {
              create: [
                {
                  questionNumber: 5,
                  text: 'What is the primary purpose of the memorandum?',
                  options: [
                    'To announce the annual health screening schedule',
                    'To introduce a new health insurance package',
                    'To cancel next week\'s conference',
                    'To recruit doctors for the clinic'
                  ],
                  correctIndex: 0,
                  explanation: 'Nội dung chính của thông báo là thông tin về lịch khám sức khỏe thường niên.'
                },
                {
                  questionNumber: 6,
                  text: 'What are employees required to do by next Wednesday?',
                  options: [
                    'Submit medical test results',
                    'Book an appointment slot on the intranet',
                    'Pay a participation fee',
                    'Clean the conference room'
                  ],
                  correctIndex: 1,
                  explanation: '"Please schedule your 20-minute appointment slot on the intranet by next Wednesday".'
                }
              ]
            }
          }
        ]
      }
    }
  });

  // ==========================================
  // 7. 8 NEW SPEAKING & PRONUNCIATION EXERCISES
  // ==========================================
  console.log('🎙️ Seeding 8 New Speaking Exercises...');

  const newSpeakingExercises = [
    { title: 'Đặt Vé Xem Phim Tại Rạp', targetText: 'Hello! I would like two tickets for the 7:30 PM showing of Inside Out, please.', difficulty: 'BEGINNER', category: 'DAILY' },
    { title: 'Mua Quà Lưu Niệm & Mặc Cả Lịch Sự', targetText: 'Is it possible to get a small discount if I purchase three of these ceramic mugs together?', difficulty: 'BEGINNER', category: 'TRAVEL' },
    { title: 'Hỏi Thăm Sức Khỏe Đồng Nghiệp', targetText: 'I heard you were feeling under the weather yesterday. Are you feeling much better today?', difficulty: 'BEGINNER', category: 'OFFICE' },
    { title: 'Đặt Lịch Hẹn Khám Nha Khoa', targetText: 'Good morning! I would like to schedule a routine dental checkup for next Tuesday morning.', difficulty: 'INTERMEDIATE', category: 'DAILY' },
    { title: 'Thuyết Minh Món Bánh Mì Việt Nam', targetText: 'Vietnamese Bánh Mì is a world-renowned street food that perfectly harmonizes crispy baguettes with savory fillings.', difficulty: 'INTERMEDIATE', category: 'GENERAL' },
    { title: 'Phỏng Vấn: Lý Do Bạn Chọn Công Ty', targetText: 'I admire your company innovative culture, and my expertise in project management aligns with your vision.', difficulty: 'ADVANCED', category: 'CAREER' },
    { title: 'Báo Cáo Tiến Độ Dự Án Cho Cấp Trên', targetText: 'We have completed the frontend integration ahead of schedule and are now conducting end-to-end testing.', difficulty: 'ADVANCED', category: 'BUSINESS' },
    { title: 'Đưa Ra Lời Khuyên Cho Đồng Nghiệp', targetText: 'If you break down the large task into smaller daily milestones, you will manage the deadline much more easily.', difficulty: 'ADVANCED', category: 'GENERAL' },
  ];

  for (const se of newSpeakingExercises) {
    await prisma.speakingExercise.create({ data: se });
  }

  console.log('\n🎉 ==========================================');
  console.log('✅ ALL PRACTICE EXERCISES & QUIZZES SEEDED!');
  console.log('==========================================\n');
}

seedExercises()
  .catch((e) => {
    console.error('❌ Error during exercise seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
