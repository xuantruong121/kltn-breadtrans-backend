import {
  AssignmentType,
  AttemptMode,
  AuthProvider,
  Class,
  ClassStatus,
  Course,
  CourseStatus,
  EnrollmentStatus,
  ExamType,
  PaymentStatus,
  Prisma,
  PrismaClient,
  QuizType,
  Role,
  TopicCategory,
  User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const PASSWORD = 'Password123!';
const SEED_ASSET_BASE_URL =
  process.env.SEED_ASSET_BASE_URL ?? process.env.R2_PUBLIC_URL ?? '';
const seedAssetUrl = (key: string): string | null => {
  const base = SEED_ASSET_BASE_URL.replace(/\/$/, '');
  return base ? `${base}/${key}` : null;
};

type SeedCollocation = {
  phrase: string;
  meaningVi: string;
};

const VOCAB_COLLOCATIONS: Record<string, SeedCollocation[]> = {
  schedule: [{ phrase: 'a tight schedule', meaningVi: 'lịch trình kín' }],
  routine: [{ phrase: 'daily routine', meaningVi: 'thói quen hằng ngày' }],
  appointment: [{ phrase: 'make an appointment', meaningVi: 'đặt lịch hẹn' }],
  available: [
    { phrase: 'be available for work', meaningVi: 'sẵn sàng làm việc' },
  ],
  usually: [
    { phrase: 'usually arrive on time', meaningVi: 'thường đến đúng giờ' },
  ],
  prepare: [
    { phrase: 'prepare for an exam', meaningVi: 'chuẩn bị cho kỳ thi' },
  ],
  delay: [{ phrase: 'a flight delay', meaningVi: 'chuyến bay bị trì hoãn' }],
  remind: [
    {
      phrase: 'remind someone about something',
      meaningVi: 'nhắc ai về việc gì',
    },
  ],
  early: [{ phrase: 'an early departure', meaningVi: 'khởi hành sớm' }],
  cancel: [{ phrase: 'cancel a reservation', meaningVi: 'hủy đặt chỗ' }],
  departure: [{ phrase: 'departure time', meaningVi: 'giờ khởi hành' }],
  arrival: [{ phrase: 'arrival time', meaningVi: 'giờ đến' }],
  passenger: [
    { phrase: 'airline passenger', meaningVi: 'hành khách hàng không' },
  ],
  reservation: [{ phrase: 'make a reservation', meaningVi: 'đặt chỗ' }],
  luggage: [{ phrase: 'checked luggage', meaningVi: 'hành lý ký gửi' }],
  platform: [{ phrase: 'train platform', meaningVi: 'sân ga tàu' }],
  destination: [
    { phrase: 'final destination', meaningVi: 'điểm đến cuối cùng' },
  ],
  itinerary: [
    { phrase: 'travel itinerary', meaningVi: 'lịch trình chuyến đi' },
  ],
  board: [{ phrase: 'board a flight', meaningVi: 'lên máy bay' }],
  route: [{ phrase: 'a direct route', meaningVi: 'tuyến đường trực tiếp' }],
  agenda: [{ phrase: 'meeting agenda', meaningVi: 'chương trình họp' }],
  conference: [
    { phrase: 'attend a conference', meaningVi: 'tham dự hội nghị' },
  ],
  colleague: [
    { phrase: 'a close colleague', meaningVi: 'đồng nghiệp thân thiết' },
  ],
  deadline: [{ phrase: 'meet a deadline', meaningVi: 'đáp ứng thời hạn' }],
  proposal: [{ phrase: 'submit a proposal', meaningVi: 'nộp đề xuất' }],
  document: [
    { phrase: 'an official document', meaningVi: 'tài liệu chính thức' },
  ],
  department: [
    { phrase: 'the sales department', meaningVi: 'phòng kinh doanh' },
  ],
  approve: [{ phrase: 'approve a request', meaningVi: 'phê duyệt yêu cầu' }],
  attend: [{ phrase: 'attend a meeting', meaningVi: 'tham dự cuộc họp' }],
  reschedule: [
    { phrase: 'reschedule an appointment', meaningVi: 'dời lịch hẹn' },
  ],
  customer: [
    { phrase: 'a loyal customer', meaningVi: 'khách hàng trung thành' },
  ],
  refund: [{ phrase: 'a full refund', meaningVi: 'hoàn tiền toàn bộ' }],
  receipt: [{ phrase: 'keep the receipt', meaningVi: 'giữ lại hóa đơn' }],
  discount: [{ phrase: 'offer a discount', meaningVi: 'đưa ra mức giảm giá' }],
  replace: [{ phrase: 'replace a part', meaningVi: 'thay thế một bộ phận' }],
  complaint: [{ phrase: 'file a complaint', meaningVi: 'gửi khiếu nại' }],
  purchase: [
    { phrase: 'make a purchase', meaningVi: 'thực hiện giao dịch mua' },
  ],
  stock: [{ phrase: 'be in stock', meaningVi: 'còn hàng' }],
  deliver: [{ phrase: 'deliver a package', meaningVi: 'giao một bưu kiện' }],
  satisfaction: [
    {
      phrase: 'customer satisfaction',
      meaningVi: 'sự hài lòng của khách hàng',
    },
  ],
  invoice: [{ phrase: 'issue an invoice', meaningVi: 'xuất hóa đơn' }],
  budget: [{ phrase: 'an annual budget', meaningVi: 'ngân sách hằng năm' }],
  revenue: [{ phrase: 'increase revenue', meaningVi: 'tăng doanh thu' }],
  expense: [{ phrase: 'operating expenses', meaningVi: 'chi phí vận hành' }],
  contract: [{ phrase: 'sign a contract', meaningVi: 'ký hợp đồng' }],
  negotiate: [{ phrase: 'negotiate a price', meaningVi: 'thương lượng giá' }],
  forecast: [{ phrase: 'a sales forecast', meaningVi: 'dự báo doanh số' }],
  profit: [{ phrase: 'earn a profit', meaningVi: 'thu lợi nhuận' }],
  payment: [{ phrase: 'make a payment', meaningVi: 'thực hiện thanh toán' }],
  estimate: [{ phrase: 'a cost estimate', meaningVi: 'báo giá ước tính' }],
  software: [{ phrase: 'install software', meaningVi: 'cài đặt phần mềm' }],
  database: [
    { phrase: 'a relational database', meaningVi: 'cơ sở dữ liệu quan hệ' },
  ],
  security: [{ phrase: 'network security', meaningVi: 'bảo mật mạng' }],
  upgrade: [
    { phrase: 'a software upgrade', meaningVi: 'bản nâng cấp phần mềm' },
  ],
  install: [{ phrase: 'install an update', meaningVi: 'cài đặt bản cập nhật' }],
  backup: [{ phrase: 'make a backup', meaningVi: 'tạo bản sao lưu' }],
  feature: [{ phrase: 'a key feature', meaningVi: 'tính năng chính' }],
  release: [
    { phrase: 'a software release', meaningVi: 'bản phát hành phần mềm' },
  ],
  milestone: [{ phrase: 'reach a milestone', meaningVi: 'đạt một cột mốc' }],
  reliable: [{ phrase: 'a reliable source', meaningVi: 'nguồn đáng tin cậy' }],
  campaign: [
    { phrase: 'a marketing campaign', meaningVi: 'chiến dịch tiếp thị' },
  ],
  advertise: [
    { phrase: 'advertise a product', meaningVi: 'quảng cáo sản phẩm' },
  ],
  survey: [{ phrase: 'conduct a survey', meaningVi: 'tiến hành khảo sát' }],
  launch: [{ phrase: 'launch a product', meaningVi: 'ra mắt sản phẩm' }],
  target: [{ phrase: 'a target audience', meaningVi: 'đối tượng mục tiêu' }],
  consumer: [
    { phrase: 'consumer demand', meaningVi: 'nhu cầu của người tiêu dùng' },
  ],
  promote: [{ phrase: 'promote a service', meaningVi: 'quảng bá dịch vụ' }],
  competitor: [
    { phrase: 'a major competitor', meaningVi: 'đối thủ cạnh tranh lớn' },
  ],
  demand: [{ phrase: 'high demand', meaningVi: 'nhu cầu cao' }],
  strategy: [
    { phrase: 'a business strategy', meaningVi: 'chiến lược kinh doanh' },
  ],
  improve: [
    { phrase: 'improve performance', meaningVi: 'cải thiện hiệu suất' },
  ],
  habit: [{ phrase: 'a healthy habit', meaningVi: 'thói quen lành mạnh' }],
  concentrate: [
    { phrase: 'concentrate on work', meaningVi: 'tập trung vào công việc' },
  ],
  balanced: [{ phrase: 'a balanced diet', meaningVi: 'chế độ ăn cân bằng' }],
  exercise: [
    { phrase: 'regular exercise', meaningVi: 'tập thể dục thường xuyên' },
  ],
  recover: [{ phrase: 'recover from illness', meaningVi: 'hồi phục sau bệnh' }],
  focus: [{ phrase: 'focus on a goal', meaningVi: 'tập trung vào mục tiêu' }],
  progress: [{ phrase: 'make progress', meaningVi: 'tiến bộ' }],
  review: [{ phrase: 'review a document', meaningVi: 'xem lại tài liệu' }],
  goal: [{ phrase: 'achieve a goal', meaningVi: 'đạt mục tiêu' }],
};

async function main() {
  const password = await bcrypt.hash(PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@breadtrans.com' },
    update: { password, role: Role.ADMIN, emailVerifiedAt: new Date() },
    create: {
      email: 'admin@breadtrans.com',
      password,
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
      profile: {
        create: { fullName: 'BreadTrans Admin', isSelfClaimed: true },
      },
    },
  });

  const students: User[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const student = await prisma.user.upsert({
      where: { email: `student${index}@breadtrans.com` },
      update: {
        password,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
      },
      create: {
        email: `student${index}@breadtrans.com`,
        password,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: {
          create: {
            fullName: `Học viên BreadTrans ${index}`,
            targetScore: index % 3 === 0 ? 'TOEIC 750+' : 'TOEIC 600+',
            birthYear: 2004 + (index % 5),
            isSelfClaimed: true,
          },
        },
      },
      include: { profile: true },
    });
    students.push(student);
    await prisma.userStats.upsert({
      where: { userId: student.id },
      update: {
        totalBanhRan: index * 35,
        streakCount: index % 7,
        quizAccuracy: 62 + index,
        speakingAccuracy: 5 + index / 2,
      },
      create: {
        userId: student.id,
        totalBanhRan: index * 35,
        streakCount: index % 7,
        quizAccuracy: 62 + index,
        speakingAccuracy: 5 + index / 2,
      },
    });
    await prisma.userPet.upsert({
      where: { userId: student.id },
      update: {
        name: index % 2 ? 'Bread' : 'Bun',
        level: 1 + (index % 4),
        exp: index * 20,
      },
      create: {
        userId: student.id,
        name: index % 2 ? 'Bread' : 'Bun',
        level: 1 + (index % 4),
        exp: index * 20,
      },
    });
    await prisma.leaderboard.upsert({
      where: { userId: student.id },
      update: {
        totalPoints: index * 125,
        weeklyExp: index * 18,
        rank: index,
        tier: index > 8 ? 'Bạc' : 'Đồng',
      },
      create: {
        userId: student.id,
        totalPoints: index * 125,
        weeklyExp: index * 18,
        rank: index,
        tier: index > 8 ? 'Bạc' : 'Đồng',
      },
    });
  }

  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: AuthProvider.GOOGLE,
        providerAccountId: 'seed-google-student-1',
      },
    },
    update: { userId: students[0].id },
    create: {
      provider: AuthProvider.GOOGLE,
      providerAccountId: 'seed-google-student-1',
      userId: students[0].id,
    },
  });

  for (const user of [admin, ...students]) {
    await prisma.userBilling.upsert({
      where: { userId: user.id },
      update: {
        tuitionFee: { '2026-09': { amount: 1490000, paidAt: '2026-09-01' } },
      },
      create: {
        userId: user.id,
        tuitionFee: { '2026-09': { amount: 1490000, paidAt: '2026-09-01' } },
      },
    });
  }

  const courseDefinitions = [
    {
      id: 1,
      title: 'English Foundations A1–A2',
      level: 'BEGINNER',
      status: 'PUBLISHED',
      description:
        'Lộ trình nền tảng cho người mới: phát âm, nghe câu ngắn, giao tiếp hằng ngày, đọc thông báo và viết tin nhắn cơ bản.',
      thumbnail: '/images/courses/english-foundations.jpg',
    },
    {
      id: 2,
      title: 'English Four Skills B1',
      level: 'INTERMEDIATE',
      status: 'PUBLISHED',
      description:
        'Phát triển đồng đều Listening, Speaking, Reading và Writing ở mức B1 qua tình huống đời sống, học tập và công việc.',
      thumbnail: '/images/courses/four-skills-b1.jpg',
    },
    {
      id: 3,
      title: 'TOEIC Listening & Reading 450–650',
      level: 'INTERMEDIATE',
      status: 'PUBLISHED',
      description:
        'Lộ trình TOEIC 2 kỹ năng tập trung đủ Part 1–7, từ vựng công sở và chiến thuật làm bài cho mục tiêu 450–650.',
      thumbnail: '/images/courses/toeic-450-650.jpg',
    },
    {
      id: 4,
      title: 'TOEIC Listening & Reading 650–850+',
      level: 'ADVANCED',
      status: 'PUBLISHED',
      description:
        'Luyện TOEIC Listening & Reading nâng cao với hội thoại dài, suy luận, Part 6–7 đa văn bản và quản lý thời gian.',
      thumbnail: '/images/courses/toeic-650-850.jpg',
    },
    {
      id: 5,
      title: 'TOEIC Speaking & Writing',
      level: 'INTERMEDIATE',
      status: 'PUBLISHED',
      description:
        'Luyện đúng các dạng nhiệm vụ TOEIC Speaking và Writing: đọc thành tiếng, mô tả, phản hồi, email và bài luận ý kiến.',
      thumbnail: '/images/courses/toeic-speaking-writing.jpg',
    },
    {
      id: 6,
      title: 'TOEIC 4 Skills Mastery',
      level: 'INTERMEDIATE',
      status: 'PUBLISHED',
      description:
        'Lộ trình 4 kỹ năng kết hợp TOEIC Listening & Reading với TOEIC Speaking & Writing, phù hợp cho học viên cần đánh giá toàn diện.',
      thumbnail: '/images/courses/toeic-4-skills.jpg',
    },
    {
      id: 7,
      title: 'Business English B1–B2',
      level: 'INTERMEDIATE',
      status: 'PUBLISHED',
      description:
        'Tiếng Anh công sở thực tế: họp, email, điện thoại, chăm sóc khách hàng, báo cáo, thuyết trình và giải quyết vấn đề.',
      thumbnail: '/images/courses/business-english.jpg',
    },
    {
      id: 8,
      title: 'Grammar & Vocabulary Builder',
      level: 'BEGINNER',
      status: 'PUBLISHED',
      description:
        'Củng cố ngữ pháp cốt lõi và vốn từ thông dụng/TOEIC theo chủ đề để hỗ trợ cả bốn kỹ năng.',
      thumbnail: '/images/courses/grammar-vocabulary.jpg',
    },
  ].map((item) => ({
    ...item,
    status:
      item.status === 'PUBLISHED' ? CourseStatus.PUBLISHED : CourseStatus.DRAFT,
  }));
  const courses: Course[] = [];
  for (const definition of courseDefinitions) {
    const { id, ...courseData } = definition;
    courses.push(
      await prisma.course.upsert({
        where: { id },
        update: courseData,
        create: { id, ...courseData },
      }),
    );
  }

  const offeringDefinitions = [
    {
      courseIndex: 0,
      name: 'English Foundations — Free Access',
      capacity: 200,
      tuitionFeeVnd: 0,
      status: 'UPCOMING',
    },
    {
      courseIndex: 2,
      name: 'TOEIC 450–650 — Standard Access',
      capacity: 80,
      tuitionFeeVnd: 1490000,
      status: 'UPCOMING',
    },
    {
      courseIndex: 1,
      name: 'Four Skills B1 — Free Practice',
      capacity: 150,
      tuitionFeeVnd: 0,
      status: 'UPCOMING',
    },
    {
      courseIndex: 5,
      name: 'TOEIC 4 Skills — Complete Access',
      capacity: 60,
      tuitionFeeVnd: 2490000,
      status: 'UPCOMING',
    },
    {
      courseIndex: 3,
      name: 'TOEIC 650–850+ — Intensive Access',
      capacity: 50,
      tuitionFeeVnd: 1990000,
      status: 'UPCOMING',
    },
    {
      courseIndex: 4,
      name: 'TOEIC Speaking & Writing — Practice Access',
      capacity: 80,
      tuitionFeeVnd: 1290000,
      status: 'UPCOMING',
    },
    {
      courseIndex: 6,
      name: 'Business English — Self Study',
      capacity: 120,
      tuitionFeeVnd: 990000,
      status: 'UPCOMING',
    },
    {
      courseIndex: 7,
      name: 'Grammar & Vocabulary — Open Practice',
      capacity: 200,
      tuitionFeeVnd: 0,
      status: 'UPCOMING',
    },
  ].map((item) => ({
    courseId: courses[item.courseIndex].id,
    name: item.name,
    capacity: item.capacity,
    tuitionFeeVnd: item.tuitionFeeVnd,
    status: ClassStatus[item.status as keyof typeof ClassStatus],
  }));
  // Scoped cleanup of obsolete prototype offerings from early development seeds
  const seededOfferingNames = offeringDefinitions.map((o) => o.name);
  const oldSeedClasses = await prisma.class.findMany({
    where: { name: { notIn: seededOfferingNames } },
    select: { id: true },
  });
  if (oldSeedClasses.length > 0) {
    const oldClassIds = oldSeedClasses.map((c) => c.id);
    const oldEnrollments = await prisma.enrollment.findMany({
      where: { classId: { in: oldClassIds } },
      select: { id: true },
    });
    if (oldEnrollments.length > 0) {
      await prisma.payment.deleteMany({
        where: { enrollmentId: { in: oldEnrollments.map((e) => e.id) } },
      });
    }
    await prisma.class.deleteMany({
      where: { id: { in: oldClassIds } },
    });
  }

  const offerings: Class[] = [];
  for (const [index, definition] of offeringDefinitions.entries()) {
    const offeringData = {
      courseId: definition.courseId,
      name: definition.name,
      capacity: definition.capacity,
      tuitionFeeVnd: definition.tuitionFeeVnd,
      status: definition.status,
    };
    offerings.push(
      await prisma.class.upsert({
        where: {
          courseId_name: {
            courseId: offeringData.courseId,
            name: offeringData.name,
          },
        },
        update: offeringData,
        create: {
          ...offeringData,
          startDate: new Date(
            `2026-${String(9 + (index % 3)).padStart(2, '0')}-15T08:00:00.000Z`,
          ),
          endDate: new Date(
            `2026-${String(11 + (index % 2)).padStart(2, '0')}-30T08:00:00.000Z`,
          ),
        },
      }),
    );
  }

  const courseLessonCatalog: Record<
    number,
    Array<{ title: string; description: string }>
  > = {
    1: [
      {
        title: 'Sound & Spelling Basics',
        description:
          'Làm quen âm cơ bản, trọng âm từ và cách dùng công cụ nghe mẫu US/UK.',
      },
      {
        title: 'Introducing Yourself',
        description:
          'Nghe và nói các mẫu giới thiệu tên, quê quán, nghề nghiệp và sở thích.',
      },
      {
        title: 'Daily Routines',
        description: 'Từ vựng và Present Simple cho thói quen hằng ngày.',
      },
      {
        title: 'Time, Dates & Schedules',
        description: 'Nghe giờ, ngày tháng và đọc lịch trình đơn giản.',
      },
      {
        title: 'Shopping & Prices',
        description: 'Hỏi giá, số lượng, kích cỡ và hiểu hóa đơn ngắn.',
      },
      {
        title: 'Travel & Directions',
        description: 'Hỏi đường, phương tiện và đọc biển báo cơ bản.',
      },
      {
        title: 'Short Messages & Emails',
        description: 'Đọc và viết tin nhắn/email ngắn, lịch sự.',
      },
      {
        title: 'Foundation Review',
        description: 'Ôn bốn kỹ năng qua bài tổng hợp A1–A2.',
      },
    ],
    2: [
      {
        title: 'Listening for Main Ideas',
        description: 'Nghe đoạn hội thoại B1 và xác định mục đích, ý chính.',
      },
      {
        title: 'Listening for Details',
        description:
          'Bắt thông tin số, thời gian, địa điểm và hành động tiếp theo.',
      },
      {
        title: 'Speaking: Clear Responses',
        description: 'Phản hồi câu hỏi tự nhiên, đủ ý và đúng ngữ cảnh.',
      },
      {
        title: 'Speaking: Describe & Explain',
        description: 'Mô tả tình huống và giải thích lựa chọn bằng câu nối.',
      },
      {
        title: 'Reading Emails & Notices',
        description: 'Đọc email, thông báo và suy luận từ ngữ cảnh.',
      },
      {
        title: 'Reading Longer Texts',
        description: 'Đọc bài 150–250 từ, tìm ý chính và chi tiết hỗ trợ.',
      },
      {
        title: 'Writing Messages & Paragraphs',
        description: 'Viết email và đoạn văn B1 có bố cục rõ.',
      },
      {
        title: 'Four-Skills Project',
        description:
          'Bài tổng hợp nghe–nói–đọc–viết theo một tình huống thực tế.',
      },
    ],
    3: [
      {
        title: 'TOEIC Part 1 — Photographs',
        description:
          'Nhận diện hành động, vị trí và mô tả phù hợp với hình ảnh.',
      },
      {
        title: 'TOEIC Part 2 — Question–Response',
        description: 'Nhận biết dạng câu hỏi và chọn phản hồi tự nhiên.',
      },
      {
        title: 'TOEIC Part 3 — Conversations',
        description:
          'Theo dõi hội thoại, mục đích, chi tiết và bước tiếp theo.',
      },
      {
        title: 'TOEIC Part 4 — Talks',
        description:
          'Nghe thông báo, voicemail và bài nói ngắn trong bối cảnh công việc.',
      },
      {
        title: 'TOEIC Part 5 — Incomplete Sentences',
        description: 'Ôn từ loại, thì, giới từ, liên từ và collocation.',
      },
      {
        title: 'TOEIC Part 6 — Text Completion',
        description:
          'Hoàn thành email/thông báo dựa trên ngữ pháp và mạch văn.',
      },
      {
        title: 'TOEIC Part 7 — Reading Comprehension',
        description: 'Đọc single/multiple passages và kết nối thông tin.',
      },
      {
        title: 'Chiến lược làm đề TOEIC Listening & Reading',
        description:
          'Chiến thuật phân bổ 45 phút Listening và 75 phút Reading.',
      },
    ],
    4: [
      {
        title: 'Advanced Listening Inference',
        description:
          'Suy luận thái độ, mục đích và hàm ý trong hội thoại nhanh.',
      },
      {
        title: 'Multi-Speaker Conversations',
        description: 'Theo dõi ba người nói, tham chiếu và thay đổi kế hoạch.',
      },
      {
        title: 'Advanced Talks & Announcements',
        description: 'Xử lý bài nói dài và câu hỏi liên kết thông tin.',
      },
      {
        title: 'Part 5 High-Frequency Traps',
        description: 'Phân biệt collocation, từ loại và cấu trúc dễ nhầm.',
      },
      {
        title: 'Part 6 Coherence',
        description: 'Dùng ngữ pháp và logic đoạn văn để hoàn thành văn bản.',
      },
      {
        title: 'Part 7 Single Passages',
        description: 'Đọc nhanh email, quảng cáo, bài báo và memo.',
      },
      {
        title: 'Part 7 Multiple Passages',
        description: 'Đối chiếu thông tin giữa 2–3 văn bản.',
      },
      {
        title: 'Luyện đề 850+ & Chữa chi tiết',
        description: 'Thi thử và phân tích lỗi theo Part/khả năng.',
      },
    ],
    5: [
      {
        title: 'Speaking Q1–2: Read Aloud',
        description: 'Đọc thành tiếng với phát âm, ngữ điệu và nhịp câu rõ.',
      },
      {
        title: 'Speaking Q3–4: Describe a Picture',
        description: 'Tổ chức câu mô tả người, vật, hành động và không gian.',
      },
      {
        title: 'Speaking Q5–7: Respond to Questions',
        description: 'Trả lời nhanh câu hỏi đời sống/công việc.',
      },
      {
        title: 'Speaking Q8–10: Use Information',
        description: 'Đọc bảng thông tin rồi phản hồi chính xác.',
      },
      {
        title: 'Speaking Q11: Express an Opinion',
        description: 'Nêu quan điểm, lý do và ví dụ trong 60 giây.',
      },
      {
        title: 'Writing Q1–5: Picture Sentences',
        description: 'Viết câu đúng ngữ pháp từ hai từ/cụm từ bắt buộc.',
      },
      {
        title: 'Writing Q6–7: Email Response',
        description:
          'Trả lời yêu cầu bằng email đầy đủ, lịch sự và đúng nhiệm vụ.',
      },
      {
        title: 'Writing Q8: Opinion Essay',
        description: 'Viết bài luận có luận điểm, lý do, ví dụ và kết luận.',
      },
    ],
    6: [
      {
        title: '4-Skill Diagnostic',
        description:
          'Đánh giá điểm mạnh/yếu ban đầu ở Listening, Speaking, Reading, Writing.',
      },
      {
        title: 'Listening Intensive',
        description: 'Luyện Part 1–4 và kỹ năng nghe thông tin công việc.',
      },
      {
        title: 'Reading Intensive',
        description: 'Luyện Part 5–7 và tốc độ đọc văn bản thực tế.',
      },
      {
        title: 'Speaking Intensive',
        description: 'Luyện 11 nhiệm vụ Speaking theo trình tự bài thi.',
      },
      {
        title: 'Writing Intensive',
        description: 'Luyện 8 nhiệm vụ Writing và phản hồi AI.',
      },
      {
        title: 'Integrated Workplace Scenario',
        description: 'Một tình huống được khai thác bằng đủ bốn kỹ năng.',
      },
      {
        title: 'Chuẩn bị đề thi tổng hợp',
        description:
          'Quản lý thời gian, thiết bị và chiến lược trước khi thi thử.',
      },
      {
        title: '4-Skill Capstone',
        description: 'Hoàn thành bộ đề 4 kỹ năng và tổng hợp kết quả.',
      },
    ],
    7: [
      {
        title: 'Professional Introductions',
        description:
          'Giới thiệu bản thân, vai trò và mục tiêu trong môi trường công sở.',
      },
      {
        title: 'Meetings & Scheduling',
        description: 'Đặt lịch, đổi lịch, xác nhận và tham gia cuộc họp.',
      },
      {
        title: 'Phone & Video Calls',
        description:
          'Mở đầu, làm rõ, ghi nhận và kết thúc cuộc gọi chuyên nghiệp.',
      },
      {
        title: 'Customer Service',
        description: 'Tiếp nhận yêu cầu, xin lỗi và đưa giải pháp.',
      },
      {
        title: 'Business Emails',
        description:
          'Viết subject, request, update, follow-up và closing phù hợp.',
      },
      {
        title: 'Reports & Data',
        description: 'Mô tả xu hướng, số liệu và tiến độ dự án.',
      },
      {
        title: 'Presentations',
        description: 'Cấu trúc mở đầu, chuyển ý và trả lời câu hỏi.',
      },
      {
        title: 'Problem Solving',
        description: 'Thảo luận lựa chọn, rủi ro và khuyến nghị.',
      },
    ],
    8: [
      {
        title: 'Present & Past Tenses',
        description: 'Ôn hiện tại/quá khứ qua ngữ cảnh bốn kỹ năng.',
      },
      {
        title: 'Future & Perfect Forms',
        description: 'Diễn tả kế hoạch, dự đoán và trải nghiệm.',
      },
      {
        title: 'Parts of Speech',
        description: 'Nhận diện danh từ, động từ, tính từ, trạng từ.',
      },
      {
        title: 'Modals & Requests',
        description: 'Khả năng, nghĩa vụ, lời khuyên và yêu cầu lịch sự.',
      },
      {
        title: 'Passive Voice',
        description: 'Câu bị động trong thông báo, quy trình và báo cáo.',
      },
      {
        title: 'Conditionals',
        description: 'Điều kiện thật/giả định và kết quả.',
      },
      {
        title: 'Relative Clauses & Connectors',
        description: 'Nối ý, mô tả danh từ và tạo văn bản mạch lạc.',
      },
      {
        title: 'Vocabulary Review',
        description: 'Ôn 80 từ theo chủ đề bằng ngữ cảnh thực tế.',
      },
    ],
  };

  let lessonId = 1;
  for (const course of courses) {
    const lessons = courseLessonCatalog[course.id] ?? [];
    for (let order = 1; order <= lessons.length; order += 1) {
      const item = lessons[order - 1];
      const lesson = await prisma.lesson.upsert({
        where: { id: lessonId },
        update: {
          courseId: course.id,
          title: item.title,
          description: item.description,
          order,
          videoUrl: null,
        },
        create: {
          id: lessonId,
          courseId: course.id,
          title: item.title,
          description: item.description,
          order,
          videoUrl: null,
        },
      });
      await prisma.material.upsert({
        where: { id: lessonId },
        update: {
          lessonId: lesson.id,
          title: `Tài nguyên tham khảo — ${item.title}`,
          fileUrl:
            course.id >= 3 && course.id <= 6
              ? 'https://www.ets.org/toeic/test-takers/prepare.html'
              : course.id === 7
                ? 'https://learnenglish.britishcouncil.org/free-resources/business'
                : 'https://learnenglish.britishcouncil.org/free-resources',
          fileType: 'LINK',
        },
        create: {
          id: lessonId,
          lessonId: lesson.id,
          title: `Tài nguyên tham khảo — ${item.title}`,
          fileUrl:
            course.id >= 3 && course.id <= 6
              ? 'https://www.ets.org/toeic/test-takers/prepare.html'
              : course.id === 7
                ? 'https://learnenglish.britishcouncil.org/free-resources/business'
                : 'https://learnenglish.britishcouncil.org/free-resources',
          fileType: 'LINK',
        },
      });
      lessonId += 1;
    }
  }

  const assignmentQuizBanks: Record<
    number,
    Array<{ question: string; options: string[]; correctOptionIndex: number }>
  > = {
    1: [
      {
        question: 'Which sentence correctly describes a daily routine?',
        options: [
          'She going to work at eight.',
          'She gone to work at eight.',
          'She goes to work at eight.',
          'She go to work at eight.',
        ],
        correctOptionIndex: 2,
      },
      {
        question:
          'What is the most natural response to “What time does the store open?”',
        options: [
          'For two hours.',
          'At nine o’clock.',
          'On the second floor.',
          'By bus.',
        ],
        correctOptionIndex: 1,
      },
      {
        question:
          'Choose the correct preposition: “The appointment is ___ Monday morning.”',
        options: ['by', 'at', 'on', 'for'],
        correctOptionIndex: 2,
      },
      {
        question: 'Which phrase politely asks someone to repeat?',
        options: [
          'Could you repeat that, please?',
          'Repeat now.',
          'You say again.',
          'What repeat?',
        ],
        correctOptionIndex: 0,
      },
      {
        question: 'Choose the correct sentence.',
        options: [
          'I am reservation for nights.',
          'I has a reservation.',
          'I have a reservation for two nights.',
          'I have reservation two night.',
        ],
        correctOptionIndex: 2,
      },
    ],
    2: [
      {
        question: 'Which sentence best states a main idea?',
        options: [
          'A manager bought coffee.',
          'The company is changing its remote-work policy next month.',
          'The office has blue chairs.',
          'Tuesday follows Monday.',
        ],
        correctOptionIndex: 1,
      },
      {
        question:
          'Choose the best connector: “The train was delayed; ___, we arrived on time.”',
        options: ['therefore of', 'unless', 'however', 'because'],
        correctOptionIndex: 2,
      },
      {
        question: 'Which response gives a clear reason?',
        options: [
          'Online meetings because.',
          'Travel is online.',
          'I prefer online meetings because they reduce travel time.',
          'I prefer meeting time.',
        ],
        correctOptionIndex: 2,
      },
      {
        question: 'Choose the correct present perfect form.',
        options: [
          'We have completed the report.',
          'We have complete the report.',
          'We completing the report.',
          'We has completed the report.',
        ],
        correctOptionIndex: 0,
      },
      {
        question: 'What should a professional email subject line do?',
        options: [
          'Use only emojis.',
          'Stay blank.',
          'Include unrelated details.',
          'Clearly state the topic.',
        ],
        correctOptionIndex: 3,
      },
    ],
    3: [
      {
        question: 'In TOEIC Part 2, what should you listen for first?',
        options: [
          'The question type and key information.',
          'A dictionary definition.',
          'A picture caption on screen.',
          'A written passage.',
        ],
        correctOptionIndex: 0,
      },
      {
        question:
          'Choose the correct word: “The invoice must be paid ___ Friday.”',
        options: ['during', 'by', 'among', 'since'],
        correctOptionIndex: 1,
      },
      {
        question: 'Which is a likely purpose of a voicemail?',
        options: [
          'To leave information or request a callback.',
          'To test spelling only.',
          'To show a map only.',
          'To display a photograph.',
        ],
        correctOptionIndex: 0,
      },
      {
        question:
          'Choose the correct form: “The documents were ___ yesterday.”',
        options: ['sent', 'send', 'sends', 'sending'],
        correctOptionIndex: 0,
      },
      {
        question: 'For Part 7 multiple passages, what is essential?',
        options: [
          'Answer without reading.',
          'Read only the first line.',
          'Ignore dates and names.',
          'Connect information across documents.',
        ],
        correctOptionIndex: 3,
      },
    ],
    4: [
      {
        question: 'Choose the best collocation.',
        options: [
          'do a deadline',
          'make deadline to',
          'meet a deadline',
          'take deadline',
        ],
        correctOptionIndex: 2,
      },
      {
        question: 'Which sentence uses an appropriate transition?',
        options: [
          'Sales increased however because costs.',
          'Sales however operating.',
          'Sales rose unless cost.',
          'Sales increased; however, operating costs also rose.',
        ],
        correctOptionIndex: 3,
      },
      {
        question: 'What does “postpone” mean?',
        options: [
          'Cancel permanently',
          'Finish early',
          'Repeat immediately',
          'Move to a later time',
        ],
        correctOptionIndex: 3,
      },
      {
        question: 'Choose the correct relative clause.',
        options: [
          'The applicant who call yesterday has.',
          'The applicant who called yesterday has accepted the offer.',
          'The applicant which called yesterday accepted.',
          'The applicant where called accepted.',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'Which strategy is best for a long Part 7 set?',
        options: [
          'Identify document purpose and scan for linked details.',
          'Translate every word before reading questions.',
          'Skip all headings.',
          'Guess before reading.',
        ],
        correctOptionIndex: 0,
      },
    ],
    5: [
      {
        question: 'Which feature matters in TOEIC Speaking read-aloud tasks?',
        options: [
          'Memorizing a photograph.',
          'Writing 300 words.',
          'Selecting four options.',
          'Intelligible pronunciation and natural delivery.',
        ],
        correctOptionIndex: 3,
      },
      {
        question: 'What should an email response do first?',
        options: [
          'Copy the prompt word for word.',
          'Address the request in the prompt.',
          'Avoid a greeting and purpose.',
          'Change the topic completely.',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'Choose the best opinion opener.',
        options: [
          'Productivity schedule words.',
          'I no reason.',
          'I believe flexible schedules can improve productivity for two main reasons.',
          'Flexible maybe yes.',
        ],
        correctOptionIndex: 2,
      },
      {
        question: 'Which sentence is clearest?',
        options: [
          'Confirm room is availability.',
          'Room available confirm two?',
          'Could you confirm whether the room is available at 2 P.M.?',
          'You room two available.',
        ],
        correctOptionIndex: 2,
      },
      {
        question: 'A strong spoken response should be…',
        options: [
          'Direct, relevant, and sufficiently developed.',
          'Only one memorized phrase for every prompt.',
          'Silent after preparation.',
          'Unrelated but long.',
        ],
        correctOptionIndex: 0,
      },
    ],
    6: [
      {
        question: 'Which pair represents productive skills?',
        options: [
          'Listening and Reading',
          'Vocabulary and Listening',
          'Speaking and Writing',
          'Reading and Grammar',
        ],
        correctOptionIndex: 2,
      },
      {
        question: 'Which pair represents receptive skills?',
        options: [
          'Writing and Grammar',
          'Listening and Reading',
          'Speaking and Writing',
          'Speaking and Vocabulary',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'What is useful after a practice test?',
        options: [
          'Repeat without feedback.',
          'Review errors by skill and task type.',
          'Delete every wrong answer.',
          'Only look at the total score.',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'Which response is professional?',
        options: [
          'No.',
          'Thank you for the update. I’ll review the document this afternoon.',
          'Update okay maybe.',
          'Why document?',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'What should AI feedback be used for?',
        options: [
          'Replacing all study decisions blindly.',
          'Generating fake scores.',
          'Ignoring original responses.',
          'Identifying specific areas to improve.',
        ],
        correctOptionIndex: 3,
      },
    ],
    7: [
      {
        question: 'Choose the best meeting phrase.',
        options: [
          'Thursday meeting moving yesterday.',
          'Move meeting Thursday yes?',
          'Meeting move is Thursday.',
          'Could we move the meeting to Thursday afternoon?',
        ],
        correctOptionIndex: 3,
      },
      {
        question: 'Which email closing is professional?',
        options: ['Best regards,', 'Finish now,', 'No more,', 'Bye!!!'],
        correctOptionIndex: 0,
      },
      {
        question: 'What does “follow up” mean in business communication?',
        options: [
          'Cancel all communication',
          'Contact again to continue or check progress',
          'Pay an invoice immediately',
          'Open a new office',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'Choose the best apology.',
        options: [
          'Delay happened, okay.',
          'I’m sorry for the delay. We are working to resolve the issue.',
          'Not our problem.',
          'You wait.',
        ],
        correctOptionIndex: 1,
      },
      {
        question: 'A concise status update should include…',
        options: [
          'Only greetings.',
          'No dates or actions.',
          'Unrelated personal history.',
          'Current progress, blockers, and next step.',
        ],
        correctOptionIndex: 3,
      },
    ],
    8: [
      {
        question:
          'Choose the correct form: “If the client agrees, we ___ the contract tomorrow.”',
        options: ['would signed', 'signing', 'will sign', 'signed'],
        correctOptionIndex: 2,
      },
      {
        question: 'Which word is an adjective?',
        options: ['rely', 'reliably', 'reliable', 'reliability'],
        correctOptionIndex: 2,
      },
      {
        question: 'Choose the passive sentence.',
        options: [
          'The report preparing finance.',
          'The report was prepared by the finance team.',
          'The finance team was report.',
          'The finance team prepared report by.',
        ],
        correctOptionIndex: 1,
      },
      {
        question:
          'Choose the correct preposition: “responsible ___ customer support.”',
        options: ['for', 'to', 'from', 'at'],
        correctOptionIndex: 0,
      },
      {
        question: 'Which connector introduces contrast?',
        options: ['so that', 'because', 'therefore', 'although'],
        correctOptionIndex: 3,
      },
    ],
  };
  const assignmentEssayPrompts: Record<number, string> = {
    1: 'Viết 80–100 từ giới thiệu một ngày học/làm việc điển hình của bạn. Dùng ít nhất ba mốc thời gian và một câu nêu sở thích.',
    2: 'Viết 120–150 từ về một phương pháp học tiếng Anh hiệu quả với bạn. Nêu quan điểm, hai lý do và một ví dụ.',
    3: 'Viết email 120–150 từ cho quản lý để xin đổi lịch họp. Nêu lý do, đề xuất hai khung giờ thay thế và yêu cầu xác nhận.',
    4: 'Viết 180–220 từ đề xuất một thay đổi giúp cải thiện trải nghiệm khách hàng. Nêu vấn đề, giải pháp và lợi ích.',
    5: 'Viết email phản hồi khách hàng 150–180 từ về một đơn hàng giao trễ. Xin lỗi, giải thích ngắn gọn, đưa giải pháp và bước tiếp theo.',
    6: 'Viết 220–260 từ trình bày ý kiến: doanh nghiệp có nên cho phép làm việc linh hoạt hay không? Dùng ít nhất hai luận điểm và ví dụ.',
    7: 'Viết 150–180 từ tóm tắt tiến độ một dự án cho quản lý: việc đã xong, khó khăn hiện tại và kế hoạch tuần tới.',
    8: 'Viết 120–150 từ giải thích một điểm ngữ pháp bạn thường nhầm, kèm ít nhất ba ví dụ đúng do bạn tự tạo.',
  };

  let assignmentId = 1;
  for (const [classIndex, offering] of offerings.entries()) {
    const courseId = offering.courseId;
    const quizBank = assignmentQuizBanks[courseId] ?? assignmentQuizBanks[1];
    for (let assignmentIndex = 1; assignmentIndex <= 3; assignmentIndex += 1) {
      const type =
        assignmentIndex === 3 ? AssignmentType.ESSAY : AssignmentType.QUIZ;
      const title =
        type === AssignmentType.ESSAY
          ? `Writing checkpoint — ${courses.find((c) => c.id === courseId)?.title ?? 'Course'}`
          : `${assignmentIndex === 1 ? 'Knowledge' : 'Applied'} quiz — ${courses.find((c) => c.id === courseId)?.title ?? 'Course'}`;
      await prisma.assignment.upsert({
        where: { id: assignmentId },
        update: {
          classId: offering.id,
          title,
          description:
            type === AssignmentType.ESSAY
              ? assignmentEssayPrompts[courseId]
              : 'Hoàn thành bài quiz để kiểm tra kiến thức và cách dùng tiếng Anh trong ngữ cảnh.',
          type,
          quizData: type === AssignmentType.QUIZ ? quizBank : undefined,
        },
        create: {
          id: assignmentId,
          classId: offering.id,
          title,
          description:
            type === AssignmentType.ESSAY
              ? assignmentEssayPrompts[courseId]
              : 'Hoàn thành bài quiz để kiểm tra kiến thức và cách dùng tiếng Anh trong ngữ cảnh.',
          type,
          dueDate: new Date(
            `2026-${String(10 + (classIndex % 2)).padStart(2, '0')}-${String(12 + assignmentIndex).padStart(2, '0')}T23:59:00.000Z`,
          ),
          quizData: type === AssignmentType.QUIZ ? quizBank : undefined,
        },
      });
      assignmentId += 1;
    }
    await prisma.announcement.upsert({
      where: { id: classIndex + 1 },
      update: {
        classId: offering.id,
        title: 'Chào mừng bạn đến lộ trình tự học',
        content:
          'Hãy học theo thứ tự lesson, luyện tập chủ động và xem lại phản hồi sau mỗi bài.',
      },
      create: {
        id: classIndex + 1,
        classId: offering.id,
        title: 'Chào mừng bạn đến lộ trình tự học',
        content:
          'Hãy học theo thứ tự lesson, luyện tập chủ động và xem lại phản hồi sau mỗi bài.',
      },
    });
  }

  for (let index = 1; index <= 3; index += 1) {
    await prisma.assignmentSubmission.upsert({
      where: {
        assignmentId_userId: { assignmentId: index, userId: students[0].id },
      },
      update: {
        content:
          index === 3
            ? 'I study English every morning before work. I review vocabulary at seven o’clock and listen to a short dialogue on the bus. In the evening, I usually write a short journal entry because it helps me remember new expressions.'
            : null,
        quizAnswers: index < 3 ? [2, 1, 2, 0, 2] : undefined,
        grade: index === 3 ? 8.5 : 9,
        feedback:
          'Bài làm rõ ràng, đúng trọng tâm. Hãy tiếp tục chú ý collocation và độ tự nhiên của câu.',
        isPointsAwarded: true,
      },
      create: {
        assignmentId: index,
        userId: students[0].id,
        content:
          index === 3
            ? 'I study English every morning before work. I review vocabulary at seven o’clock and listen to a short dialogue on the bus. In the evening, I usually write a short journal entry because it helps me remember new expressions.'
            : null,
        quizAnswers: index < 3 ? [2, 1, 2, 0, 2] : undefined,
        grade: index === 3 ? 8.5 : 9,
        feedback:
          'Bài làm rõ ràng, đúng trọng tâm. Hãy tiếp tục chú ý collocation và độ tự nhiên của câu.',
        isPointsAwarded: true,
      },
    });
  }

  let enrollmentIndex = 1;
  for (const [studentIndex, student] of students.entries()) {
    const freeOffering = offerings[studentIndex % 2 === 0 ? 0 : 2];
    await prisma.enrollment.upsert({
      where: {
        userId_classId: { userId: student.id, classId: freeOffering.id },
      },
      update: {
        status: EnrollmentStatus.ACTIVE,
        progress: Math.min(96, studentIndex * 7),
      },
      create: {
        userId: student.id,
        classId: freeOffering.id,
        status: EnrollmentStatus.ACTIVE,
        progress: Math.min(96, studentIndex * 7),
      },
    });
    if (studentIndex < 8) {
      const paidOffering = offerings[studentIndex % 2 === 0 ? 1 : 3];
      const status =
        studentIndex % 3 === 0
          ? EnrollmentStatus.COMPLETED
          : studentIndex % 3 === 1
            ? EnrollmentStatus.PENDING_PAYMENT
            : EnrollmentStatus.ACTIVE;
      const enrollment = await prisma.enrollment.upsert({
        where: {
          userId_classId: { userId: student.id, classId: paidOffering.id },
        },
        update: {
          status,
          progress:
            status === EnrollmentStatus.COMPLETED ? 100 : studentIndex * 5,
        },
        create: {
          userId: student.id,
          classId: paidOffering.id,
          status,
          progress:
            status === EnrollmentStatus.COMPLETED ? 100 : studentIndex * 5,
        },
      });
      await prisma.payment.upsert({
        where: { enrollmentId: enrollment.id },
        update: {
          amountVnd: paidOffering.tuitionFeeVnd,
          status:
            status === EnrollmentStatus.PENDING_PAYMENT
              ? PaymentStatus.PENDING
              : PaymentStatus.CONFIRMED,
        },
        create: {
          enrollmentId: enrollment.id,
          amountVnd: paidOffering.tuitionFeeVnd,
          transferCode: `BT-SEED-${String(enrollmentIndex).padStart(4, '0')}`,
          status:
            status === EnrollmentStatus.PENDING_PAYMENT
              ? PaymentStatus.PENDING
              : PaymentStatus.CONFIRMED,
        },
      });
      enrollmentIndex += 1;
    }
  }

  const practiceTopics = [
    ['Grammar Foundation', 'Ngữ pháp nền tảng', 'GRAMMAR_TOPIC'],
    ['Grammar Intermediate', 'Ngữ pháp trung cấp', 'GRAMMAR_LEVEL'],
    [
      'Bài kiểm tra ngữ pháp tổng hợp',
      'Bài kiểm tra ngữ pháp',
      'GRAMMAR_MOCK_TEST',
    ],
    ['Reading A2', 'Đọc hiểu A2', 'BILINGUAL_LEVEL'],
    ['Reading B1–B2', 'Đọc hiểu B1–B2', 'BILINGUAL_LEVEL'],
    ['Writing Sentence', 'Viết câu', 'WRITING_PART1'],
    ['Writing Email', 'Viết email', 'WRITING_PART2'],
    ['Writing Opinion', 'Viết đoạn/bài nêu quan điểm', 'WRITING_PART2'],
  ].map(([name, vietnameseName, category], index) => ({
    id: index + 1,
    name,
    vietnameseName,
    category: TopicCategory[category as keyof typeof TopicCategory],
  }));
  for (const topic of practiceTopics) {
    await prisma.practiceTopic.upsert({
      where: { id: topic.id },
      update: {
        name: topic.name,
        vietnameseName: topic.vietnameseName,
        category: topic.category,
        order: topic.id,
      },
      create: { ...topic, order: topic.id },
    });
  }

  const practiceQuizDefinitions = [
    {
      id: 1,
      title: 'Listening A2 — Everyday Communication',
      type: 'LISTENING_PRACTICE',
      description:
        'Nghe câu và hội thoại ngắn về lịch hẹn, mua sắm, giao thông và đời sống.',
      timeLimit: 12,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'The dentist can see you at two thirty on Thursday afternoon.',
            text: 'When is the appointment?',
            options: [
              'Thursday at 3:30 P.M.',
              'Friday at 2:30 P.M.',
              'Thursday at 2:30 P.M.',
              'Wednesday at 2:00 P.M.',
            ],
            correctIndex: 2,
            explanation: 'The speaker states Thursday afternoon at 2:30.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'This sweater is twenty dollars, but it is ten percent off today.',
            text: 'What is special about the sweater today?',
            options: [
              'It is discounted.',
              'It is sold out.',
              'It is available only online.',
              'It costs ten dollars.',
            ],
            correctIndex: 0,
            explanation: 'The speaker says it is ten percent off.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'The next bus to the city center leaves in fifteen minutes from stop number four.',
            text: 'Where should the passenger wait?',
            options: [
              'At platform fifteen',
              'At the ticket counter',
              'At stop four',
              'At the city center',
            ],
            correctIndex: 2,
            explanation: 'The bus leaves from stop number four.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText: 'I’m sorry, the café closes at six on Sundays.',
            text: 'What time does the café close on Sunday?',
            options: ['7 P.M.', '9 P.M.', '6 P.M.', '8 P.M.'],
            correctIndex: 2,
            explanation: 'The closing time stated is six.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'Could you bring an umbrella? The forecast says it may rain after lunch.',
            text: 'Why should the listener bring an umbrella?',
            options: [
              'The listener is going swimming.',
              'It is very sunny.',
              'Rain is expected.',
              'The umbrella is on sale.',
            ],
            correctIndex: 2,
            explanation: 'The forecast says it may rain.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'Your parcel arrived this morning. You can collect it at the front desk.',
            text: 'Where can the parcel be collected?',
            options: [
              'At a supermarket',
              'At the post office',
              'At the parking lot',
              'At the front desk',
            ],
            correctIndex: 3,
            explanation: 'The speaker says to collect it at the front desk.',
          },
        },
      ],
    },
    {
      id: 2,
      title: 'Reading A2 — Notices & Messages',
      type: 'BILINGUAL_READING',
      description:
        'Đọc thông báo, tin nhắn và email ngắn để tìm thông tin chính.',
      timeLimit: 15,
      practiceTopicId: 4,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'NOTICE: The library will close at 5 P.M. this Friday for electrical maintenance. It will reopen at 9 A.M. on Saturday.',
            text: 'Why will the library close early?',
            options: [
              'For a holiday',
              'For a staff meeting',
              'For electrical maintenance',
              'For book delivery',
            ],
            correctIndex: 2,
            explanation:
              'The notice gives electrical maintenance as the reason.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'Hi Linh, I’m running ten minutes late. Please order a coffee for me. I’ll meet you near the station entrance. — Mai',
            text: 'Where will Mai meet Linh?',
            options: [
              'At the bus stop',
              'At Linh’s home',
              'Near the station entrance',
              'Inside a coffee shop',
            ],
            correctIndex: 2,
            explanation: 'Mai explicitly says near the station entrance.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'SALE: Buy two notebooks and get the third one free. Offer valid through September 30.',
            text: 'What does the promotion offer?',
            options: [
              'A free bag',
              'Free delivery',
              'A free third notebook',
              'Half-price pens',
            ],
            correctIndex: 2,
            explanation: 'The third notebook is free when two are purchased.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'Your appointment with Dr. Pham is confirmed for Monday, October 12 at 10:15 A.M. Please arrive 10 minutes early.',
            text: 'What should the patient do?',
            options: [
              'Arrive before 10:15 A.M.',
              'Come on Tuesday',
              'Bring another doctor',
              'Call after the appointment',
            ],
            correctIndex: 0,
            explanation:
              'The message asks the patient to arrive 10 minutes early.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'The swimming pool is open from 6 A.M. to 9 P.M. Members must show their membership card at reception.',
            text: 'What must members show?',
            options: [
              'A passport',
              'A membership card',
              'A medical form',
              'A receipt',
            ],
            correctIndex: 1,
            explanation: 'A membership card is required at reception.',
          },
        },
      ],
    },
    {
      id: 3,
      title: 'Writing A2–B1 — Sentence Builder',
      type: 'WRITING_PICTURE',
      description: 'Viết câu đúng ngữ pháp dựa trên tình huống và từ khóa.',
      timeLimit: 20,
      practiceTopicId: 6,
      questions: [
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            taskType: 'SENTENCE',
            prompt:
              'Viết một câu tự nhiên dùng cả hai từ/cụm từ: meeting / tomorrow.',
            requiredKeywords: ['meeting', 'tomorrow'],
            sampleResponse: 'We have an important meeting tomorrow morning.',
            rubric: {
              grammar: 4,
              taskCompletion: 4,
              naturalness: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            taskType: 'SENTENCE',
            prompt: 'Viết một câu dùng: because / delayed.',
            requiredKeywords: ['because', 'delayed'],
            sampleResponse: 'The flight was delayed because of heavy rain.',
            rubric: {
              grammar: 4,
              taskCompletion: 4,
              naturalness: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            taskType: 'SENTENCE',
            prompt: 'Viết một câu dùng: customer / politely.',
            requiredKeywords: ['customer', 'politely'],
            sampleResponse: 'The receptionist spoke politely to the customer.',
            rubric: {
              grammar: 4,
              taskCompletion: 4,
              naturalness: 2,
            },
          },
        },
      ],
    },
    {
      id: 4,
      title: 'Writing B1 — Professional Email',
      type: 'WRITING_EMAIL',
      description: 'Viết email ngắn, rõ mục đích và phản hồi đủ yêu cầu.',
      timeLimit: 25,
      practiceTopicId: 7,
      questions: [
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            taskType: 'EMAIL',
            prompt:
              'Bạn đã đăng ký một workshop vào thứ Sáu nhưng không thể tham dự. Viết email 100–130 từ cho ban tổ chức để xin chuyển sang buổi thứ Hai. Nêu lý do ngắn gọn và yêu cầu xác nhận.',
            wordRange: [100, 130],
            sampleResponse:
              'Dear Workshop Team, I am writing about my registration for Friday’s customer-service workshop. Unfortunately, I have an important appointment that afternoon and will not be able to attend. If possible, could you please transfer my registration to the Monday session instead? I would appreciate a confirmation of the change and any updated joining instructions. Thank you for your help. Best regards, Minh',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            taskType: 'EMAIL',
            prompt:
              'Viết email 100–130 từ cho đồng nghiệp để nhờ họ gửi lại phiên bản mới nhất của báo cáo trước 3 P.M. Giải thích vì sao bạn cần tài liệu và cảm ơn họ.',
            wordRange: [100, 130],
            sampleResponse:
              'Hi Alex, Could you please send me the latest version of the quarterly sales report before 3 P.M. today? I am preparing the slides for tomorrow morning’s management meeting and want to make sure the figures in my presentation match the final report. If there were any major changes since yesterday, please let me know as well. Thanks very much for your help. Best regards, Lan',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
      ],
    },
    {
      id: 5,
      title: 'Listening B1 — Workplace Conversations',
      type: 'LISTENING_PRACTICE',
      description:
        'Nghe hội thoại công sở và xác định mục đích, vấn đề, hành động tiếp theo.',
      timeLimit: 15,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'M: Did the supplier confirm the delivery date? W: Yes, but the shipment will arrive on Wednesday instead of Tuesday because of a customs delay. M: All right. I’ll update the warehouse team.',
            text: 'What will the man probably do next?',
            options: [
              'Change the supplier',
              'Inform the warehouse team',
              'Call customs',
              'Cancel the shipment',
            ],
            correctIndex: 1,
            explanation: 'He says he will update the warehouse team.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'W: I can’t open the budget spreadsheet you sent. M: I may have forgotten to change the sharing settings. I’ll fix them now and send you a new link.',
            text: 'What problem does the woman have?',
            options: [
              'She lost the budget',
              'She cannot access a file',
              'She needs a new computer',
              'She sent the wrong link',
            ],
            correctIndex: 1,
            explanation: 'She says she cannot open the spreadsheet.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            audioText:
              'M: Are we still meeting the client at ten? W: They asked to move it to eleven thirty. The conference room is already booked for us.',
            text: 'What changed?',
            options: [
              'The meeting time',
              'The client',
              'The meeting location',
              'The conference room',
            ],
            correctIndex: 0,
            explanation:
              'The client moved the meeting from ten to eleven thirty.',
          },
        },
      ],
    },
    {
      id: 6,
      title: 'Reading B1–B2 — Workplace Documents',
      type: 'BILINGUAL_READING',
      description:
        'Đọc email, memo và thông báo để suy luận mục đích và kết nối chi tiết.',
      timeLimit: 20,
      practiceTopicId: 5,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'To: All Staff\nSubject: Office Access This Weekend\nThe main office will be closed on Saturday while the security system is upgraded. Employees who need to collect equipment should do so before 6 P.M. Friday. Remote access to company systems will remain available.',
            text: 'What is the purpose of the email?',
            options: [
              'To advertise security equipment',
              'To announce new employees',
              'To change remote-work policy',
              'To explain weekend office access',
            ],
            correctIndex: 3,
            explanation:
              'The message explains the Saturday closure and how employees can prepare.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'To: All Staff\nSubject: Office Access This Weekend\nThe main office will be closed on Saturday while the security system is upgraded. Employees who need to collect equipment should do so before 6 P.M. Friday. Remote access to company systems will remain available.',
            text: 'What will still be available on Saturday?',
            options: [
              'Remote system access',
              'Equipment collection',
              'The reception desk',
              'The main office',
            ],
            correctIndex: 0,
            explanation: 'Remote access remains available.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            passage:
              'Dear Ms. Brown, We have received your order for 120 conference folders. Because the navy folders are temporarily out of stock, we can deliver the same model in black this Thursday or wait until next Tuesday for navy. Please let us know which option you prefer.',
            text: 'Why is the company contacting Ms. Brown?',
            options: [
              'To change the folder quantity',
              'To offer alternative delivery options',
              'To cancel a conference',
              'To request payment',
            ],
            correctIndex: 1,
            explanation:
              'The requested color is out of stock, so the company offers alternatives.',
          },
        },
      ],
    },
    {
      id: 7,
      title: 'Writing B2 — Problem & Solution Email',
      type: 'WRITING_EMAIL',
      description:
        'Viết email xử lý vấn đề với giọng điệu chuyên nghiệp và giải pháp cụ thể.',
      timeLimit: 30,
      practiceTopicId: 8,
      questions: [
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            taskType: 'EMAIL',
            prompt:
              'Một khách hàng báo rằng 10 chiếc ghế trong đơn hàng vừa nhận bị trầy xước. Viết email 150–180 từ: xin lỗi, xác nhận vấn đề, đề xuất hai phương án giải quyết và nêu bước tiếp theo.',
            wordRange: [150, 180],
            sampleResponse:
              'Dear Ms. Patel, Thank you for letting us know about the damaged chairs. I am very sorry that ten items in your recent order arrived with scratches. This is not the condition we expect our products to reach customers in. We can either send ten replacement chairs at no additional cost, or issue a refund for the affected items if that is more convenient. If you choose replacement, we can dispatch the new chairs within two business days and arrange collection of the damaged ones. Please reply with your preferred option and confirm the delivery address. I apologize again for the inconvenience and appreciate your patience while we resolve this matter. Best regards, Customer Care Team',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
      ],
    },
    {
      id: 8,
      title: 'TOEIC L&R Mini Mixed Practice',
      type: 'TOEIC',
      description:
        'Bài mini test nguyên bản mô phỏng dạng câu hỏi TOEIC Listening & Reading.',
      timeLimit: 25,
      courseId: 3,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            section: 'LISTENING',
            audioText:
              'The maintenance team will inspect the elevators after the office closes.',
            text: 'When will the elevators be inspected?',
            options: [
              'Before lunch',
              'During the meeting',
              'Tomorrow morning',
              'After the office closes',
            ],
            correctIndex: 3,
            explanation: 'The speaker says after the office closes.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            section: 'READING',
            text: 'The new software is considerably _____ to use than the previous version.',
            options: ['ease', 'easier', 'easiest', 'easily'],
            correctIndex: 1,
            explanation:
              'The comparative construction requires the adjective “easier”.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            section: 'READING',
            passage:
              'NOTICE: The cafeteria will reopen on Monday after a three-day renovation. During the closure, boxed lunches can be ordered through the employee portal.',
            text: 'What can employees do while the cafeteria is closed?',
            options: [
              'Attend a cooking class',
              'Request a renovation',
              'Order boxed lunches online',
              'Use the cafeteria normally',
            ],
            correctIndex: 2,
            explanation:
              'The notice says boxed lunches can be ordered through the portal.',
          },
        },
      ],
    },
  ];
  let questionId = 1;
  for (const definition of practiceQuizDefinitions) {
    const quiz = await prisma.quiz.upsert({
      where: { id: definition.id },
      update: {
        title: definition.title,
        description: definition.description,
        type: QuizType[definition.type as keyof typeof QuizType],
        timeLimit: definition.timeLimit,
        courseId: definition.courseId,
        practiceTopicId: definition.practiceTopicId,
        bilingualContent: Prisma.DbNull,
      },
      create: {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        type: QuizType[definition.type as keyof typeof QuizType],
        timeLimit: definition.timeLimit,
        courseId: definition.courseId,
        practiceTopicId: definition.practiceTopicId,
        bilingualContent: Prisma.DbNull,
      },
    });
    for (let order = 1; order <= definition.questions.length; order += 1) {
      const q = definition.questions[order - 1];
      await prisma.question.upsert({
        where: { id: questionId },
        update: { quizId: quiz.id, type: q.type, content: q.content, order },
        create: {
          id: questionId,
          quizId: quiz.id,
          type: q.type,
          content: q.content,
          order,
        },
      });
      questionId += 1;
    }
  }

  const skillExpansionQuizDefinitions = [
    {
      id: 9,
      title: 'Listening A1 — Essential Everyday English',
      type: 'LISTENING_PRACTICE',
      description:
        'Nghe thông tin rất ngắn về giờ, địa điểm, mua sắm và hoạt động hằng ngày.',
      timeLimit: 12,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'UK',
            audioText: 'The shop opens at nine o’clock.',
            text: 'When does the shop open?',
            options: ['At 8:00', 'At noon', 'At 10:00', 'At 9:00'],
            correctIndex: 3,
            explanation: 'The time stated is nine o’clock.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'US',
            audioText: 'Please put the books on the table by the window.',
            text: 'Where should the books be placed?',
            options: [
              'In a bag',
              'On the table by the window',
              'Under the chair',
              'At the door',
            ],
            correctIndex: 1,
            explanation: 'The speaker gives the location directly.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'UK',
            audioText: 'I’d like two bottles of water, please.',
            text: 'What does the speaker want?',
            options: [
              'Two bottles of water',
              'A sandwich',
              'Two cups of coffee',
              'One bottle of juice',
            ],
            correctIndex: 0,
            explanation: 'The speaker asks for two bottles of water.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'US',
            audioText: 'My bus arrives in five minutes.',
            text: 'What will arrive soon?',
            options: ['A taxi', 'A bus', 'A plane', 'A train'],
            correctIndex: 1,
            explanation: 'The speaker mentions a bus.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'US',
            audioText:
              'The restroom is on the first floor, next to the elevator.',
            text: 'Where is the restroom?',
            options: [
              'Behind the hotel',
              'Next to the elevator',
              'Inside the restaurant',
              'Near the station',
            ],
            correctIndex: 1,
            explanation: 'The location is stated directly.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'UK',
            audioText: 'I usually have lunch at twelve thirty.',
            text: 'When does the speaker usually have lunch?',
            options: ['11:30', '12:30', '2:00', '1:30'],
            correctIndex: 1,
            explanation: 'The speaker says twelve thirty.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'US',
            audioText: 'Today is cloudy, but it is not raining.',
            text: 'What is the weather like?',
            options: ['Stormy', 'Very sunny', 'Snowy', 'Cloudy'],
            correctIndex: 3,
            explanation: 'The speaker says it is cloudy.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A1',
            accent: 'UK',
            audioText: 'Please call me after dinner.',
            text: 'When should the listener call?',
            options: [
              'Tomorrow morning',
              'At lunchtime',
              'After dinner',
              'Before breakfast',
            ],
            correctIndex: 2,
            explanation: 'The requested time is after dinner.',
          },
        },
      ],
    },
    {
      id: 10,
      title: 'Listening A2 — Travel & Services',
      type: 'LISTENING_PRACTICE',
      description:
        'Nghe thông báo và hội thoại ngắn trong bối cảnh du lịch, khách sạn và dịch vụ.',
      timeLimit: 14,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'UK',
            audioText:
              'The train to Bristol will depart from platform three instead of platform five.',
            text: 'What has changed?',
            options: [
              'The ticket price',
              'The train company',
              'The destination',
              'The departure platform',
            ],
            correctIndex: 3,
            explanation: 'The train now leaves from platform three.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'US',
            audioText:
              'Your room is ready now, and breakfast is included in the price.',
            text: 'What is included?',
            options: ['Airport transport', 'Dinner', 'Laundry', 'Breakfast'],
            correctIndex: 3,
            explanation: 'Breakfast is included in the room price.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'UK',
            audioText: 'Could I see your passport and boarding pass, please?',
            text: 'What is the listener asked to show?',
            options: [
              'A passport and boarding pass',
              'A credit card only',
              'A train timetable',
              'A hotel key',
            ],
            correctIndex: 0,
            explanation: 'Both documents are requested.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'US',
            audioText:
              'We are fully booked tonight, but a room is available tomorrow.',
            text: 'When is a room available?',
            options: ['Tonight', 'Tomorrow', 'Next week', 'This afternoon'],
            correctIndex: 1,
            explanation: 'The speaker says tomorrow.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'UK',
            audioText:
              'The museum ticket includes a guided tour at two o’clock.',
            text: 'What does the ticket include?',
            options: [
              'A train ticket',
              'Lunch',
              'A guided tour',
              'A hotel room',
            ],
            correctIndex: 2,
            explanation: 'The guided tour is included.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'US',
            audioText: 'Please return the rental car with a full tank of fuel.',
            text: 'What should the customer do before returning the car?',
            options: [
              'Fill the fuel tank',
              'Buy insurance',
              'Wash the car',
              'Change the tires',
            ],
            correctIndex: 0,
            explanation: 'The tank should be full.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'UK',
            audioText:
              'The flight has been delayed by forty minutes because of strong winds.',
            text: 'Why is the flight delayed?',
            options: [
              'A staffing issue',
              'Strong winds',
              'Late passengers',
              'A technical problem',
            ],
            correctIndex: 1,
            explanation: 'Strong winds caused the delay.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'A2',
            accent: 'US',
            audioText: 'You can collect your luggage from carousel six.',
            text: 'Where should the listener go?',
            options: [
              'Desk sixteen',
              'Gate six',
              'Carousel six',
              'Platform six',
            ],
            correctIndex: 2,
            explanation: 'Luggage is at carousel six.',
          },
        },
      ],
    },
    {
      id: 11,
      title: 'Listening B1 — Work & Meetings',
      type: 'LISTENING_PRACTICE',
      description:
        'Nghe hội thoại công sở, thay đổi lịch, yêu cầu và bước hành động tiếp theo.',
      timeLimit: 16,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'US',
            audioText:
              'I’ve moved our weekly meeting to Thursday because the sales director will be visiting on Wednesday.',
            text: 'Why was the meeting moved?',
            options: [
              'The sales director will visit Wednesday',
              'The team requested a longer meeting',
              'The room is too small',
              'Thursday is a holiday',
            ],
            correctIndex: 0,
            explanation: 'The director’s Wednesday visit caused the change.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'UK',
            audioText:
              'Please review the contract before lunch so I can send it to the client this afternoon.',
            text: 'Why should the contract be reviewed before lunch?',
            options: [
              'It needs to be sent later today',
              'The contract expires today',
              'The client is visiting at lunch',
              'The office closes at noon',
            ],
            correctIndex: 0,
            explanation: 'The speaker plans to send it this afternoon.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'US',
            audioText:
              'The technician fixed the network issue, but we still need to restart all the meeting-room computers.',
            text: 'What still needs to be done?',
            options: [
              'Call the internet provider',
              'Repair the network',
              'Restart the meeting-room computers',
              'Buy new computers',
            ],
            correctIndex: 2,
            explanation: 'The remaining task is restarting computers.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'UK',
            audioText:
              'We received 120 applications, and the hiring team has selected twelve people for interviews next week.',
            text: 'How many applicants were selected for interviews?',
            options: ['20', '12', '120', '10'],
            correctIndex: 1,
            explanation: 'Twelve candidates were selected.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'US',
            audioText:
              'I can finish the report today if accounting sends me the final expense figures by three.',
            text: 'What does the speaker need?',
            options: [
              'A travel booking',
              'A new report template',
              'A client signature',
              'Final expense figures',
            ],
            correctIndex: 3,
            explanation: 'The report depends on accounting’s final figures.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'UK',
            audioText:
              'The supplier offered a five-percent discount if we increase the order to five hundred units.',
            text: 'What condition applies to the discount?',
            options: [
              'Delivery must be delayed',
              'The order must increase to 500 units',
              'Payment must be in cash',
              'The supplier must change',
            ],
            correctIndex: 1,
            explanation: 'The discount requires an order of 500 units.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'US',
            audioText:
              'Because Friday’s workshop is full, we’ve added another session next Monday morning.',
            text: 'Why was another session added?',
            options: [
              'The instructor is unavailable Monday',
              'Friday’s workshop is full',
              'The fee was reduced',
              'The topic changed',
            ],
            correctIndex: 1,
            explanation: 'A new session was added due to full capacity.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B1',
            accent: 'UK',
            audioText:
              'Could you update the customer list and remove anyone who has already canceled their subscription?',
            text: 'What should be removed from the list?',
            options: [
              'New customers',
              'All inactive products',
              'Customers who canceled',
              'Customers with discounts',
            ],
            correctIndex: 2,
            explanation: 'The speaker specifies customers who canceled.',
          },
        },
      ],
    },
    {
      id: 12,
      title: 'Listening B2 — Inference & Intent',
      type: 'LISTENING_PRACTICE',
      description:
        'Luyện suy luận thái độ, mục đích và hàm ý trong thông tin dài hơn.',
      timeLimit: 18,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'US',
            audioText:
              'I expected the prototype to be ready today, but the design team says they need another forty-eight hours to test the new material. I’d rather delay the presentation than show the client something unfinished.',
            text: 'What will the speaker probably do?',
            options: [
              'Change the client',
              'Postpone the presentation',
              'Cancel the project',
              'Present the unfinished prototype',
            ],
            correctIndex: 1,
            explanation:
              'The speaker prefers delaying rather than presenting unfinished work.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'UK',
            audioText:
              'We could renew the current lease, but the landlord’s proposed increase would make the new office across town almost the same price. Since the new place is twice as large, we should at least inspect it before deciding.',
            text: 'What does the speaker suggest?',
            options: [
              'Accept the rent increase immediately',
              'Close the company',
              'Move without inspection',
              'Inspect another office',
            ],
            correctIndex: 3,
            explanation:
              'The speaker recommends inspecting the alternative office.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'US',
            audioText:
              'The survey response rate is only thirty percent. Instead of sending another general reminder, let’s ask department managers to mention it during tomorrow’s team meetings.',
            text: 'Why does the speaker propose a new approach?',
            options: [
              'Managers wrote the survey',
              'The deadline was removed',
              'Too few people responded',
              'The survey questions are incorrect',
            ],
            correctIndex: 2,
            explanation: 'The low response rate motivates the new approach.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'UK',
            audioText:
              'Our afternoon train arrives only twenty minutes before the conference begins. Even a small delay could make us late, so I think the morning train is safer despite the earlier departure.',
            text: 'What is the speaker concerned about?',
            options: [
              'Arriving late to the conference',
              'Missing breakfast',
              'Finding the station',
              'Paying too much for a ticket',
            ],
            correctIndex: 0,
            explanation: 'The small transfer window creates lateness risk.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'US',
            audioText:
              'The client liked the proposal overall, but she asked for clearer cost estimates before signing anything. If finance can update the numbers today, I think we can close the deal this week.',
            text: 'What is preventing the deal from closing now?',
            options: [
              'The cost estimates need clarification',
              'Finance canceled the project',
              'The contract has already been signed',
              'The client disliked the proposal',
            ],
            correctIndex: 0,
            explanation: 'The client wants clearer cost estimates first.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'UK',
            audioText:
              'We’ve had fewer support tickets since the tutorial videos went online. Let’s translate the three most popular videos next, because international users still ask many of the same questions.',
            text: 'What does the speaker infer about the videos?',
            options: [
              'They reduce support requests',
              'They are only for employees',
              'They should be removed',
              'They are too difficult',
            ],
            correctIndex: 0,
            explanation:
              'Fewer tickets after publication suggests the videos help users.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'US',
            audioText:
              'I know the cheaper printer has lower running costs, but it can only handle half our monthly volume. Buying it would probably mean replacing it sooner, so the more expensive model may be better value over time.',
            text: 'What does the speaker favor?',
            options: [
              'Renting office space',
              'The cheaper printer',
              'Using no printer',
              'The more expensive printer',
            ],
            correctIndex: 3,
            explanation:
              'Long-term value leads the speaker toward the expensive model.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'LISTENING',
            level: 'B2',
            accent: 'UK',
            audioText:
              'The training room is available Friday, but several new employees won’t start until Monday. If we wait until Tuesday, everyone can attend the same session and we won’t need to repeat it.',
            text: 'Why does the speaker prefer Tuesday?',
            options: [
              'The room is unavailable Friday',
              'All new employees can attend',
              'Tuesday is cheaper',
              'The trainer is absent Friday',
            ],
            correctIndex: 1,
            explanation:
              'Waiting allows the new employees to attend one shared session.',
          },
        },
      ],
    },
    {
      id: 13,
      title: 'Reading A1–A2 — Everyday Texts',
      type: 'BILINGUAL_READING',
      description:
        'Đọc văn bản nguyên bản và luyện ý chính, chi tiết, suy luận, mục đích và từ vựng theo ngữ cảnh.',
      timeLimit: 20,
      practiceTopicId: 4,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'A1',
            questionType: 'DETAIL',
            passage:
              'NOTICE: The community center opens at 8 A.M. Monday to Friday and at 9 A.M. on Saturday. It is closed on Sunday.',
            text: 'When does the center open on Saturday?',
            options: ['10 A.M.', 'It is closed', '8 A.M.', '9 A.M.'],
            correctIndex: 3,
            explanation: 'Saturday opening time is 9 A.M.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'A1',
            questionType: 'DETAIL',
            passage:
              'NOTICE: The community center opens at 8 A.M. Monday to Friday and at 9 A.M. on Saturday. It is closed on Sunday.',
            text: 'When is the center closed?',
            options: ['Monday', 'Sunday', 'Friday', 'Saturday'],
            correctIndex: 1,
            explanation: 'The notice says it is closed on Sunday.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'A2',
            questionType: 'DETAIL',
            passage:
              'EMAIL: Hi Sam, The study group will meet in Room 204 instead of the library today because the library is hosting an event. We’ll start at the usual time, 4:30 P.M. Please bring your notes from Chapter 6. — Maya',
            text: 'Why did the meeting location change?',
            options: [
              'The group changed the time',
              'The library is hosting an event',
              'Room 204 is closed',
              'Maya forgot her notes',
            ],
            correctIndex: 1,
            explanation: 'The library event caused the move.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'A2',
            questionType: 'INFERENCE',
            passage:
              'EMAIL: Hi Sam, The study group will meet in Room 204 instead of the library today because the library is hosting an event. We’ll start at the usual time, 4:30 P.M. Please bring your notes from Chapter 6. — Maya',
            text: 'What has NOT changed?',
            options: [
              'The room',
              'The start time',
              'The building',
              'The chapter',
            ],
            correctIndex: 1,
            explanation: 'The email says the usual time remains 4:30.',
          },
        },
      ],
    },
    {
      id: 14,
      title: 'Reading B1 — Practical English',
      type: 'BILINGUAL_READING',
      description:
        'Đọc văn bản nguyên bản và luyện ý chính, chi tiết, suy luận, mục đích và từ vựng theo ngữ cảnh.',
      timeLimit: 20,
      practiceTopicId: 5,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B1',
            questionType: 'MAIN_IDEA',
            passage:
              'MEMO: Beginning next month, employees who use company bicycles must reserve them through the staff portal. Reservations can be made up to three days in advance. Helmets will continue to be available at reception, and there is no charge for using a bicycle. The new system is intended to reduce scheduling conflicts during busy periods.',
            text: 'What is changing?',
            options: [
              'The cost of bicycles',
              'Helmet availability',
              'The office location',
              'The bicycle reservation process',
            ],
            correctIndex: 3,
            explanation: 'Employees must use the staff portal to reserve.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B1',
            questionType: 'DETAIL',
            passage:
              'MEMO: Beginning next month, employees who use company bicycles must reserve them through the staff portal. Reservations can be made up to three days in advance. Helmets will continue to be available at reception, and there is no charge for using a bicycle. The new system is intended to reduce scheduling conflicts during busy periods.',
            text: 'How far in advance can reservations be made?',
            options: ['Same day only', 'One month', 'One week', 'Three days'],
            correctIndex: 3,
            explanation: 'The memo says up to three days.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B1',
            questionType: 'PURPOSE',
            passage:
              'MEMO: Beginning next month, employees who use company bicycles must reserve them through the staff portal. Reservations can be made up to three days in advance. Helmets will continue to be available at reception, and there is no charge for using a bicycle. The new system is intended to reduce scheduling conflicts during busy periods.',
            text: 'Why is the system being introduced?',
            options: [
              'To remove bicycles',
              'To sell helmets',
              'To reduce scheduling conflicts',
              'To charge employees',
            ],
            correctIndex: 2,
            explanation: 'The final sentence gives the purpose.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B1',
            questionType: 'DETAIL',
            passage:
              'ARTICLE: A small neighborhood bakery recently introduced online ordering. Before the change, customers often had to wait in line during the morning rush. Now, many regular customers place orders on their phones and collect them from a separate counter. The owner says wait times have fallen and staff can prepare popular items more efficiently.',
            text: 'What problem existed before online ordering?',
            options: [
              'Poor product quality',
              'No mobile phones',
              'Too many counters',
              'Long morning lines',
            ],
            correctIndex: 3,
            explanation: 'Customers often waited in line.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B1',
            questionType: 'DETAIL',
            passage:
              'ARTICLE: A small neighborhood bakery recently introduced online ordering. Before the change, customers often had to wait in line during the morning rush. Now, many regular customers place orders on their phones and collect them from a separate counter. The owner says wait times have fallen and staff can prepare popular items more efficiently.',
            text: 'What is one result of online ordering?',
            options: [
              'Longer opening hours',
              'Higher delivery fees',
              'Fewer products',
              'Shorter wait times',
            ],
            correctIndex: 3,
            explanation: 'The owner reports that wait times fell.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B1',
            questionType: 'VOCAB_IN_CONTEXT',
            passage:
              'ARTICLE: A small neighborhood bakery recently introduced online ordering. Before the change, customers often had to wait in line during the morning rush. Now, many regular customers place orders on their phones and collect them from a separate counter. The owner says wait times have fallen and staff can prepare popular items more efficiently.',
            text: 'What does “rush” most nearly mean?',
            options: ['A discount', 'A delivery', 'A busy period', 'A recipe'],
            correctIndex: 2,
            explanation: 'Morning rush refers to a busy time.',
          },
        },
      ],
    },
    {
      id: 15,
      title: 'Reading B2 — Workplace & Reports',
      type: 'BILINGUAL_READING',
      description:
        'Đọc văn bản nguyên bản và luyện ý chính, chi tiết, suy luận, mục đích và từ vựng theo ngữ cảnh.',
      timeLimit: 25,
      practiceTopicId: 5,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B2',
            questionType: 'MAIN_IDEA',
            passage:
              'EMAIL: Team, The pilot mentoring program has produced encouraging results, especially among employees in their first year. Participants reported greater confidence in handling client meetings, and managers observed fewer onboarding questions after the third month. However, only 40 percent of eligible employees joined the pilot. Before expanding the program company-wide, we should simplify registration and explain the time commitment more clearly. Please send suggestions by Friday.',
            text: 'What is the writer’s overall view of the pilot?',
            options: [
              'Too expensive to continue',
              'Only useful for managers',
              'Completely unsuccessful',
              'Positive but needing participation improvements',
            ],
            correctIndex: 3,
            explanation: 'Results are encouraging, but participation is low.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B2',
            questionType: 'DETAIL',
            passage:
              'EMAIL: Team, The pilot mentoring program has produced encouraging results, especially among employees in their first year. Participants reported greater confidence in handling client meetings, and managers observed fewer onboarding questions after the third month. However, only 40 percent of eligible employees joined the pilot. Before expanding the program company-wide, we should simplify registration and explain the time commitment more clearly. Please send suggestions by Friday.',
            text: 'What did managers observe?',
            options: [
              'Lower confidence',
              'Fewer onboarding questions',
              'Longer meetings',
              'More client complaints',
            ],
            correctIndex: 1,
            explanation:
              'Managers observed fewer onboarding questions after month three.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B2',
            questionType: 'INFERENCE',
            passage:
              'EMAIL: Team, The pilot mentoring program has produced encouraging results, especially among employees in their first year. Participants reported greater confidence in handling client meetings, and managers observed fewer onboarding questions after the third month. However, only 40 percent of eligible employees joined the pilot. Before expanding the program company-wide, we should simplify registration and explain the time commitment more clearly. Please send suggestions by Friday.',
            text: 'What issue must be addressed before expansion?',
            options: [
              'No program results',
              'Client-meeting quality',
              'Low participation',
              'Lack of managers',
            ],
            correctIndex: 2,
            explanation:
              'Only 40% joined, so registration/communication should improve.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B2',
            questionType: 'DETAIL',
            passage:
              'REPORT EXCERPT: During the first quarter, online sales increased by 18 percent while in-store sales remained nearly unchanged. The largest online growth came from returning customers using the new mobile checkout. Delivery complaints also decreased after the company added estimated arrival times to order-confirmation messages. Management plans to test the mobile checkout in two additional markets next quarter.',
            text: 'What contributed most to online growth?',
            options: [
              'Higher delivery fees',
              'New physical stores',
              'Reduced product variety',
              'Returning customers using mobile checkout',
            ],
            correctIndex: 3,
            explanation:
              'The report identifies returning mobile-checkout users as the largest source.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B2',
            questionType: 'DETAIL',
            passage:
              'REPORT EXCERPT: During the first quarter, online sales increased by 18 percent while in-store sales remained nearly unchanged. The largest online growth came from returning customers using the new mobile checkout. Delivery complaints also decreased after the company added estimated arrival times to order-confirmation messages. Management plans to test the mobile checkout in two additional markets next quarter.',
            text: 'What happened to delivery complaints?',
            options: [
              'They doubled',
              'They were not measured',
              'They remained unchanged',
              'They decreased',
            ],
            correctIndex: 3,
            explanation:
              'Complaints decreased after ETA information was added.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'B2',
            questionType: 'INFERENCE',
            passage:
              'REPORT EXCERPT: During the first quarter, online sales increased by 18 percent while in-store sales remained nearly unchanged. The largest online growth came from returning customers using the new mobile checkout. Delivery complaints also decreased after the company added estimated arrival times to order-confirmation messages. Management plans to test the mobile checkout in two additional markets next quarter.',
            text: 'What will management probably do next?',
            options: [
              'Expand mobile-checkout testing',
              'Remove arrival estimates',
              'Open two warehouses',
              'Close online sales',
            ],
            correctIndex: 0,
            explanation:
              'The report says the checkout will be tested in two more markets.',
          },
        },
      ],
    },
    {
      id: 16,
      title: 'Reading C1 — Analysis & Inference',
      type: 'BILINGUAL_READING',
      description:
        'Đọc văn bản nguyên bản và luyện ý chính, chi tiết, suy luận, mục đích và từ vựng theo ngữ cảnh.',
      timeLimit: 25,
      practiceTopicId: 5,
      questions: [
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'C1',
            questionType: 'MAIN_IDEA',
            passage:
              'ARTICLE: Organizations often assume that adding more communication channels improves collaboration. In practice, the opposite can occur when employees must monitor email, messaging platforms, project boards, and video calls simultaneously. The problem is not the number of tools alone but the absence of shared expectations about which channel should be used for which purpose. Teams that define clear communication norms often respond more quickly while experiencing fewer interruptions. Therefore, technology investment should be accompanied by deliberate decisions about communication behavior.',
            text: 'What is the author’s main argument?',
            options: [
              'Companies should eliminate all messaging platforms',
              'Video calls are always inefficient',
              'Technology investment alone guarantees collaboration',
              'Communication tools need clear usage norms to be effective',
            ],
            correctIndex: 3,
            explanation:
              'The article argues that tools need shared communication norms.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'C1',
            questionType: 'INFERENCE',
            passage:
              'ARTICLE: Organizations often assume that adding more communication channels improves collaboration. In practice, the opposite can occur when employees must monitor email, messaging platforms, project boards, and video calls simultaneously. The problem is not the number of tools alone but the absence of shared expectations about which channel should be used for which purpose. Teams that define clear communication norms often respond more quickly while experiencing fewer interruptions. Therefore, technology investment should be accompanied by deliberate decisions about communication behavior.',
            text: 'What does “the opposite can occur” refer to?',
            options: [
              'Employees may buy more devices',
              'More channels can reduce rather than improve collaboration',
              'Teams may stop using email entirely',
              'Companies may reduce technology spending',
            ],
            correctIndex: 1,
            explanation:
              'The contrast is between expected improvement and actual overload/interruption.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'C1',
            questionType: 'PURPOSE',
            passage:
              'ARTICLE: Organizations often assume that adding more communication channels improves collaboration. In practice, the opposite can occur when employees must monitor email, messaging platforms, project boards, and video calls simultaneously. The problem is not the number of tools alone but the absence of shared expectations about which channel should be used for which purpose. Teams that define clear communication norms often respond more quickly while experiencing fewer interruptions. Therefore, technology investment should be accompanied by deliberate decisions about communication behavior.',
            text: 'What does the author recommend?',
            options: [
              'Require employees to monitor every channel constantly',
              'Avoid project boards',
              'Use only face-to-face meetings',
              'Pair technology choices with communication-behavior decisions',
            ],
            correctIndex: 3,
            explanation: 'The final sentence gives this recommendation.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'C1',
            questionType: 'INFERENCE',
            passage:
              'MEMO: Our pilot four-day workweek maintained overall output, but the aggregate figure hides important differences between teams. Customer support handled the same number of cases but reported higher pressure on peak days, whereas product design reduced meeting time and completed slightly more project work. Before considering a broader rollout, we need team-level scheduling models rather than a single company-wide template. The next pilot should also measure service quality and employee recovery, not productivity alone.',
            text: 'Why does the writer caution against relying on overall output?',
            options: [
              'It hides differences between teams',
              'Employees refused to participate',
              'Output fell sharply',
              'The pilot lasted too long',
            ],
            correctIndex: 0,
            explanation:
              'The memo says the aggregate figure hides team-level differences.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'C1',
            questionType: 'DETAIL',
            passage:
              'MEMO: Our pilot four-day workweek maintained overall output, but the aggregate figure hides important differences between teams. Customer support handled the same number of cases but reported higher pressure on peak days, whereas product design reduced meeting time and completed slightly more project work. Before considering a broader rollout, we need team-level scheduling models rather than a single company-wide template. The next pilot should also measure service quality and employee recovery, not productivity alone.',
            text: 'Which team appears to have benefited from reduced meetings?',
            options: [
              'Finance',
              'Human resources',
              'Product design',
              'Customer support',
            ],
            correctIndex: 2,
            explanation:
              'Product design completed slightly more work after reducing meetings.',
          },
        },
        {
          type: 'MULTIPLE_CHOICE',
          content: {
            skill: 'READING',
            level: 'C1',
            questionType: 'DETAIL',
            passage:
              'MEMO: Our pilot four-day workweek maintained overall output, but the aggregate figure hides important differences between teams. Customer support handled the same number of cases but reported higher pressure on peak days, whereas product design reduced meeting time and completed slightly more project work. Before considering a broader rollout, we need team-level scheduling models rather than a single company-wide template. The next pilot should also measure service quality and employee recovery, not productivity alone.',
            text: 'What should the next pilot measure in addition to productivity?',
            options: [
              'Number of managers',
              'Service quality and employee recovery',
              'Office rent and electricity',
              'Customer location only',
            ],
            correctIndex: 1,
            explanation: 'The final sentence lists these additional measures.',
          },
        },
      ],
    },
    {
      id: 17,
      title: 'Writing A2 — Messages & Simple Emails',
      type: 'WRITING_EMAIL',
      description: 'Viết tin nhắn/email ngắn có mục đích rõ ràng.',
      timeLimit: 25,
      practiceTopicId: 6,
      questions: [
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'A2',
            taskType: 'SHORT_MESSAGE',
            prompt:
              'Bạn đến trễ 15 phút cho một buổi học nhóm. Viết 40–60 từ nhắn cho bạn cùng nhóm: xin lỗi, giải thích ngắn gọn và cho biết giờ bạn sẽ đến.',
            wordRange: [40, 60],
            requirements: ['apologize', 'give a reason', 'state arrival time'],
            sampleResponse:
              'Hi Lan, I’m sorry, but I’ll be about 15 minutes late because my bus was delayed. I should arrive at the library around 4:45. Please start without me, and I’ll join you as soon as I get there.',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'A2',
            taskType: 'EMAIL',
            prompt:
              'Viết 50–70 từ cho khách sạn để xác nhận bạn sẽ đến sau 9 P.M. và hỏi liệu lễ tân còn mở không.',
            wordRange: [50, 70],
            requirements: ['state late arrival', 'ask about reception'],
            sampleResponse:
              'Dear Hotel Team, I have a reservation for Friday night, but my flight arrives late, so I expect to reach the hotel after 9 P.M. Could you please confirm whether reception will still be open for check-in? Thank you for your help.',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'A2',
            taskType: 'INVITATION',
            prompt:
              'Viết 50–70 từ mời một người bạn tham gia hoạt động cuối tuần. Nêu địa điểm, thời gian và một lý do nên tham gia.',
            wordRange: [50, 70],
            requirements: ['place', 'time', 'reason'],
            sampleResponse:
              'Hi Minh, Would you like to join me at the weekend book fair in the city park this Saturday at 10 A.M.? There will be English books, short talks, and a coffee area. I think it will be a fun way to practise reading together.',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'A2',
            taskType: 'REQUEST',
            prompt:
              'Viết 40–60 từ hỏi giáo viên/nhân viên hỗ trợ về một tài liệu bạn không mở được.',
            wordRange: [40, 60],
            requirements: [
              'identify material',
              'explain problem',
              'ask for help',
            ],
            sampleResponse:
              'Hello, I’m trying to open the vocabulary review file for Lesson 4, but the link does not work on my phone or laptop. Could you please check the file or send me another link? Thank you.',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'A2',
            taskType: 'THANK_YOU',
            prompt:
              'Viết 50–70 từ cảm ơn một đồng nghiệp đã giúp bạn hoàn thành nhiệm vụ.',
            wordRange: [50, 70],
            requirements: ['thank', 'mention help', 'positive closing'],
            sampleResponse:
              'Hi Anna, Thank you very much for helping me prepare the presentation yesterday. Your suggestions made the slides much clearer, and I was able to finish on time. I really appreciate your support and hope I can help you with your next project too.',
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
      ],
    },
    {
      id: 18,
      title: 'Writing B1 — Professional Communication',
      type: 'WRITING_EMAIL',
      description:
        'Viết email 100–150 từ xử lý các yêu cầu công việc phổ biến.',
      timeLimit: 35,
      practiceTopicId: 7,
      questions: [
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B1',
            taskType: 'EMAIL',
            prompt:
              'Viết email xin đổi lịch họp vì bạn có cuộc hẹn quan trọng. Đề xuất hai giờ thay thế và yêu cầu xác nhận.',
            wordRange: [100, 140],
            requirements: [
              'reason',
              'two alternatives',
              'confirmation request',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B1',
            taskType: 'STATUS_UPDATE',
            prompt:
              'Viết email cập nhật tiến độ dự án: hai việc đã hoàn thành, một việc đang chậm và kế hoạch xử lý.',
            wordRange: [110, 150],
            requirements: ['two completed items', 'one delay', 'next step'],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B1',
            taskType: 'CUSTOMER_EMAIL',
            prompt:
              'Viết email phản hồi khách hàng hỏi khi nào đơn hàng sẽ đến. Nêu trạng thái, ngày dự kiến và cách theo dõi.',
            wordRange: [100, 140],
            requirements: ['status', 'expected date', 'tracking information'],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B1',
            taskType: 'INFORMATION_REQUEST',
            prompt:
              'Viết email cho ban tổ chức workshop để hỏi về phí, địa điểm và yêu cầu chuẩn bị trước.',
            wordRange: [100, 140],
            requirements: [
              'ask fee',
              'ask location',
              'ask preparation requirements',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B1',
            taskType: 'MEETING_FOLLOWUP',
            prompt:
              'Viết email cho đồng nghiệp tóm tắt quyết định của cuộc họp và ba hành động cần thực hiện.',
            wordRange: [120, 150],
            requirements: [
              'summary',
              'three action items',
              'deadline/owner if appropriate',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
      ],
    },
    {
      id: 19,
      title: 'Writing B2–C1 — Argument & Problem Solving',
      type: 'WRITING_EMAIL',
      description: 'Viết phản hồi dài hơn, lập luận và đề xuất giải pháp.',
      timeLimit: 45,
      practiceTopicId: 8,
      questions: [
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B2',
            taskType: 'OPINION',
            prompt:
              'Một công ty đang cân nhắc cho nhân viên làm việc từ xa ba ngày mỗi tuần. Viết 180–220 từ nêu quan điểm, hai lợi ích/rủi ro và đề xuất chính sách phù hợp.',
            wordRange: [180, 220],
            requirements: [
              'clear position',
              'two developed reasons',
              'practical recommendation',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'B2',
            taskType: 'PROPOSAL',
            prompt:
              'Viết 180–220 từ đề xuất cách giảm số cuộc họp không cần thiết trong một nhóm dự án mà vẫn giữ thông tin minh bạch.',
            wordRange: [180, 220],
            requirements: [
              'identify problem',
              'propose actions',
              'explain benefits',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'C1',
            taskType: 'ANALYTICAL_RESPONSE',
            prompt:
              'Viết 200–250 từ phản hồi một báo cáo cho thấy khách hàng hài lòng với sản phẩm nhưng phàn nàn về thời gian hỗ trợ. Phân tích nguyên nhân có thể và đề xuất hai giải pháp.',
            wordRange: [200, 250],
            requirements: [
              'interpret evidence',
              'possible causes',
              'two justified solutions',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'C1',
            taskType: 'ARGUMENT',
            prompt:
              'Viết 220–280 từ: doanh nghiệp nên ưu tiên đào tạo kỹ năng chuyên môn hay kỹ năng giao tiếp cho nhân viên mới? Nêu quan điểm có cân nhắc mặt đối lập.',
            wordRange: [220, 280],
            requirements: [
              'position',
              'counterpoint',
              'evidence/examples',
              'conclusion',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
        {
          type: 'WRITING',
          content: {
            skill: 'WRITING',
            level: 'C1',
            taskType: 'PROPOSAL',
            prompt:
              'Viết 200–250 từ đề xuất cách một nền tảng tự học có thể giúp người học duy trì thói quen mà không làm gamification lấn át mục tiêu học tập.',
            wordRange: [200, 250],
            requirements: [
              'learning objective',
              'engagement mechanism',
              'risk control',
              'success measure',
            ],
            rubric: {
              taskAchievement: 4,
              organization: 2,
              grammar: 2,
              vocabulary: 2,
            },
          },
        },
      ],
    },
  ];
  for (const definition of skillExpansionQuizDefinitions) {
    const quiz = await prisma.quiz.upsert({
      where: { id: definition.id },
      update: {
        title: definition.title,
        description: definition.description,
        type: QuizType[definition.type as keyof typeof QuizType],
        timeLimit: definition.timeLimit,
        practiceTopicId: definition.practiceTopicId,
        bilingualContent: Prisma.DbNull,
      },
      create: {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        type: QuizType[definition.type as keyof typeof QuizType],
        timeLimit: definition.timeLimit,
        practiceTopicId: definition.practiceTopicId,
        bilingualContent: Prisma.DbNull,
      },
    });
    for (let order = 1; order <= definition.questions.length; order += 1) {
      const q = definition.questions[order - 1];
      await prisma.question.upsert({
        where: { id: questionId },
        update: { quizId: quiz.id, type: q.type, content: q.content, order },
        create: {
          id: questionId,
          quizId: quiz.id,
          type: q.type,
          content: q.content,
          order,
        },
      });
      questionId += 1;
    }
  }

  const toeicSpeakingWritingQuiz = await prisma.quiz.upsert({
    where: { id: 20 },
    update: {
      title: 'TOEIC Speaking & Writing — Đề thi chuẩn 01',
      description:
        'Bộ nhiệm vụ nguyên bản theo cấu trúc TOEIC Speaking (11 câu) và Writing (8 câu).',
      type: QuizType.TOEIC,
      courseId: courses[4].id,
      timeLimit: 80,
      bilingualContent: {
        examFormat: 'SPEAKING_WRITING',
        speakingQuestions: 11,
        writingQuestions: 8,
        speakingMinutes: 20,
        writingMinutes: 60,
        speakingScoreScale: '0-200',
        writingScoreScale: '0-200',
        speakingInfoReadSeconds: 45,
        writingEmailResponseMinutes: 10,
        writingOpinionRecommendedMinWords: 300,
        writingPictureSectionMinutes: 8,
        writingWrittenRequestMinutesEach: 10,
        writingOpinionMinutes: 30,
        speakingTaskRatingScales: { questions1To10: '0-3', question11: '0-5' },
        writingTaskRatingScales: {
          questions1To5: '0-3',
          questions6To7: '0-4',
          question8: '0-5',
        },
        note: 'Original TOEIC-style practice content aligned to ETS public task structure; not official ETS questions.',
      },
    },
    create: {
      id: 20,
      title: 'TOEIC Speaking & Writing — Đề thi chuẩn 01',
      description:
        'Bộ nhiệm vụ nguyên bản theo cấu trúc TOEIC Speaking (11 câu) và Writing (8 câu).',
      type: QuizType.TOEIC,
      courseId: courses[4].id,
      timeLimit: 80,
      bilingualContent: {
        examFormat: 'SPEAKING_WRITING',
        speakingQuestions: 11,
        writingQuestions: 8,
        speakingMinutes: 20,
        writingMinutes: 60,
        speakingScoreScale: '0-200',
        writingScoreScale: '0-200',
        speakingInfoReadSeconds: 45,
        writingEmailResponseMinutes: 10,
        writingOpinionRecommendedMinWords: 300,
        writingPictureSectionMinutes: 8,
        writingWrittenRequestMinutesEach: 10,
        writingOpinionMinutes: 30,
        speakingTaskRatingScales: { questions1To10: '0-3', question11: '0-5' },
        writingTaskRatingScales: {
          questions1To5: '0-3',
          questions6To7: '0-4',
          question8: '0-5',
        },
        note: 'Original TOEIC-style practice content aligned to ETS public task structure; not official ETS questions.',
      },
    },
  });
  const toeicSpeakingWritingQuestions = [
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 1,
        taskType: 'READ_ALOUD',
        prompt:
          'Good morning, passengers. Flight 728 to Singapore will begin boarding at Gate 14 in approximately twenty minutes. Please have your boarding pass and identification ready before approaching the gate.',
        prepSeconds: 45,
        responseSeconds: 45,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 2,
        taskType: 'READ_ALOUD',
        prompt:
          'Thank you for visiting Greenway Fitness Center. Members can reserve group classes through our mobile application up to seven days in advance. Please cancel at least two hours before class if you cannot attend.',
        prepSeconds: 45,
        responseSeconds: 45,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 3,
        taskType: 'DESCRIBE_PICTURE',
        imageUrl: seedAssetUrl('toeic/visuals/cafe-counter.png'),
        ratingScale: '0-3',
        evaluationCriteria: [
          'pronunciation',
          'intonation and stress',
          'grammar',
          'vocabulary',
          'cohesion',
        ],
        visualAssetRequired: true,
        prompt:
          'Describe a busy café where two customers are ordering at the counter, a barista is preparing drinks, and several people are seated near the window.',
        sceneDescription:
          'Busy café with counter service, barista preparing drinks, seated customers by a window.',
        prepSeconds: 45,
        responseSeconds: 30,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 4,
        taskType: 'DESCRIBE_PICTURE',
        imageUrl: seedAssetUrl('toeic/visuals/office-meeting.png'),
        ratingScale: '0-3',
        evaluationCriteria: [
          'pronunciation',
          'intonation and stress',
          'grammar',
          'vocabulary',
          'cohesion',
        ],
        visualAssetRequired: true,
        prompt:
          'Describe an office meeting where four colleagues are sitting around a table, one person is presenting a chart, and laptops and documents are visible.',
        sceneDescription:
          'Four-person office meeting with chart presentation, laptops and documents.',
        prepSeconds: 45,
        responseSeconds: 30,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 5,
        taskType: 'RESPOND_TO_QUESTION',
        prompt:
          'How often do you use public transportation, and which type do you use most often?',
        prepSeconds: 3,
        responseSeconds: 15,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 6,
        taskType: 'RESPOND_TO_QUESTION',
        prompt:
          'What is one thing you usually do to prepare for an important meeting?',
        prepSeconds: 3,
        responseSeconds: 15,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 7,
        taskType: 'RESPOND_TO_QUESTION',
        prompt:
          'Some people prefer shopping online, while others prefer visiting stores. Which do you prefer, and why?',
        prepSeconds: 3,
        responseSeconds: 30,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 8,
        taskType: 'RESPOND_USING_INFORMATION',
        information:
          'Professional Development Day — Monday, October 19. 9:00 Welcome & Registration; 9:30 Effective Presentations — Room A; 11:00 Customer Communication — Room B; 12:30 Lunch; 2:00 Project Planning Workshop — Room A; 4:00 Closing Session.',
        prompt:
          'What time does the Effective Presentations session begin, and where will it be held?',
        prepSeconds: 3,
        responseSeconds: 15,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 9,
        taskType: 'RESPOND_USING_INFORMATION',
        information:
          'Professional Development Day — Monday, October 19. 9:00 Welcome & Registration; 9:30 Effective Presentations — Room A; 11:00 Customer Communication — Room B; 12:30 Lunch; 2:00 Project Planning Workshop — Room A; 4:00 Closing Session.',
        prompt:
          'I’m interested in customer service. Is there a relevant session before lunch?',
        prepSeconds: 3,
        responseSeconds: 15,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 10,
        taskType: 'RESPOND_USING_INFORMATION',
        questionRepeated: true,
        information:
          'Professional Development Day — Monday, October 19. 9:00 Welcome & Registration; 9:30 Effective Presentations — Room A; 11:00 Customer Communication — Room B; 12:30 Lunch; 2:00 Project Planning Workshop — Room A; 4:00 Closing Session.',
        prompt: 'Please summarize the activities scheduled in Room A.',
        prepSeconds: 3,
        responseSeconds: 30,
      },
    },
    {
      type: 'SPEAKING',
      content: {
        section: 'SPEAKING',
        questionNumber: 11,
        taskType: 'EXPRESS_OPINION',
        prompt:
          'Do you agree or disagree that companies should allow employees to work from home at least one day per week? Give reasons and examples to support your opinion.',
        prepSeconds: 45,
        responseSeconds: 60,
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 1,
        taskType: 'PICTURE_SENTENCE',
        imageUrl: seedAssetUrl('toeic/visuals/folders-cabinet.png'),
        ratingScale: '0-3',
        evaluationCriteria: ['grammar', 'relevance to picture'],
        sharedSectionTimeSeconds: 480,
        visualAssetRequired: true,
        sceneDescription:
          'A woman is placing folders into a cabinet in an office.',
        requiredWords: ['woman', 'cabinet'],
        prompt:
          'Write one sentence about the picture using both words or phrases.',
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 2,
        taskType: 'PICTURE_SENTENCE',
        imageUrl: seedAssetUrl('toeic/visuals/departure-board.png'),
        ratingScale: '0-3',
        evaluationCriteria: ['grammar', 'relevance to picture'],
        sharedSectionTimeSeconds: 480,
        visualAssetRequired: true,
        sceneDescription:
          'Two travelers are checking a departure board at a train station.',
        requiredWords: ['travelers', 'board'],
        prompt:
          'Write one sentence about the picture using both words or phrases.',
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 3,
        taskType: 'PICTURE_SENTENCE',
        imageUrl: seedAssetUrl('toeic/visuals/delivery-boxes.png'),
        ratingScale: '0-3',
        evaluationCriteria: ['grammar', 'relevance to picture'],
        sharedSectionTimeSeconds: 480,
        visualAssetRequired: true,
        sceneDescription:
          'A delivery worker is carrying several boxes into a store.',
        requiredWords: ['boxes', 'store'],
        prompt:
          'Write one sentence about the picture using both words or phrases.',
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 4,
        taskType: 'PICTURE_SENTENCE',
        imageUrl: seedAssetUrl('toeic/visuals/office-meeting.png'),
        ratingScale: '0-3',
        evaluationCriteria: ['grammar', 'relevance to picture'],
        sharedSectionTimeSeconds: 480,
        visualAssetRequired: true,
        sceneDescription:
          'Several employees are sitting around a table while a manager points at a chart.',
        requiredWords: ['meeting', 'chart'],
        prompt:
          'Write one sentence about the picture using both words or phrases.',
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 5,
        taskType: 'PICTURE_SENTENCE',
        imageUrl: seedAssetUrl('toeic/visuals/grocery-checkout.png'),
        ratingScale: '0-3',
        evaluationCriteria: ['grammar', 'relevance to picture'],
        sharedSectionTimeSeconds: 480,
        visualAssetRequired: true,
        sceneDescription:
          'A customer is paying for groceries while a cashier scans an item.',
        requiredWords: ['customer', 'while'],
        prompt:
          'Write one sentence about the picture using both words or phrases.',
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 6,
        taskType: 'WRITTEN_REQUEST',
        prompt:
          'From: Event Coordinator\nSubject: Volunteer Orientation\nThank you for volunteering at our community career fair next Saturday. Please reply with two pieces of information: the time you can arrive and the type of task you would prefer to help with. You may also ask one question about the event.',
        responseMinutes: 10,
        requirements: [
          'state arrival time',
          'state preferred task',
          'ask one relevant question',
        ],
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 7,
        taskType: 'WRITTEN_REQUEST',
        prompt:
          'From: Hotel Guest Services\nSubject: Your Recent Stay\nWe hope you enjoyed your visit. We would appreciate feedback about your room and our services. Please tell us one thing you liked, one problem you experienced, and one suggestion for improvement.',
        responseMinutes: 10,
        requirements: [
          'mention one positive point',
          'describe one problem',
          'give one suggestion',
        ],
      },
    },
    {
      type: 'WRITING',
      content: {
        section: 'WRITING',
        questionNumber: 8,
        taskType: 'OPINION_ESSAY',
        prompt:
          'Some employers provide professional training during working hours, while others expect employees to study on their own time. Which approach do you think is better? Explain your opinion with specific reasons and examples.',
        recommendedMinWords: 300,
        rubric: {
          organization: 5,
          development: 5,
          grammar: 5,
          vocabulary: 5,
        },
      },
    },
  ];
  const speakingWritingTaskCounts = toeicSpeakingWritingQuestions.reduce<
    Record<string, number>
  >((counts, question) => {
    const key = `${question.content.section}:${question.content.taskType}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const expectedSpeakingWritingTaskCounts: Record<string, number> = {
    'SPEAKING:READ_ALOUD': 2,
    'SPEAKING:DESCRIBE_PICTURE': 2,
    'SPEAKING:RESPOND_TO_QUESTION': 3,
    'SPEAKING:RESPOND_USING_INFORMATION': 3,
    'SPEAKING:EXPRESS_OPINION': 1,
    'WRITING:PICTURE_SENTENCE': 5,
    'WRITING:WRITTEN_REQUEST': 2,
    'WRITING:OPINION_ESSAY': 1,
  };
  if (toeicSpeakingWritingQuestions.length !== 19) {
    throw new Error(
      `TOEIC S&W seed invalid: expected 19 tasks, got ${toeicSpeakingWritingQuestions.length}.`,
    );
  }
  for (const [key, expectedCount] of Object.entries(
    expectedSpeakingWritingTaskCounts,
  )) {
    if ((speakingWritingTaskCounts[key] ?? 0) !== expectedCount) {
      throw new Error(
        `TOEIC S&W seed invalid: ${key} expected ${expectedCount}, got ${speakingWritingTaskCounts[key] ?? 0}.`,
      );
    }
  }
  for (
    let order = 1;
    order <= toeicSpeakingWritingQuestions.length;
    order += 1
  ) {
    const q = toeicSpeakingWritingQuestions[order - 1];
    await prisma.question.upsert({
      where: { id: questionId },
      update: {
        quizId: toeicSpeakingWritingQuiz.id,
        type: q.type,
        content: q.content,
        order,
      },
      create: {
        id: questionId,
        quizId: toeicSpeakingWritingQuiz.id,
        type: q.type,
        content: q.content,
        order,
      },
    });
    questionId += 1;
  }

  for (let index = 0; index < 4; index += 1) {
    const quizId = index + 1;
    const firstQuestion = await prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'asc' },
    });
    if (!firstQuestion) continue;
    const submissionId = 200 + index;
    await prisma.submission.upsert({
      where: { id: submissionId },
      update: {
        quizId,
        userId: students[index].id,
        score: 7.5 + index / 2,
        aiFeedback:
          'Seed demo: kết quả dùng để kiểm tra UI lịch sử; điểm thật trong sản phẩm phải do server/evaluator tính.',
      },
      create: {
        id: submissionId,
        quizId,
        userId: students[index].id,
        score: 7.5 + index / 2,
        aiFeedback:
          'Seed demo: kết quả dùng để kiểm tra UI lịch sử; điểm thật trong sản phẩm phải do server/evaluator tính.',
      },
    });
    const firstContent = firstQuestion.content as { correctIndex?: number };
    const seededSelectedIndex =
      typeof firstContent.correctIndex === 'number'
        ? firstContent.correctIndex
        : 0;
    await prisma.result.upsert({
      where: { id: submissionId },
      update: {
        submissionId,
        questionId: firstQuestion.id,
        answer: { selectedIndex: seededSelectedIndex },
        isCorrect: true,
        score: 1,
      },
      create: {
        id: submissionId,
        submissionId,
        questionId: firstQuestion.id,
        answer: { selectedIndex: seededSelectedIndex },
        isCorrect: true,
        score: 1,
      },
    });
  }

  const badges = [
    [
      1,
      'First Step',
      'Hoàn thành bài học đầu tiên',
      { type: 'LESSON', threshold: 1 },
    ],
    [
      2,
      'Seven Day Streak',
      'Duy trì streak 7 ngày',
      { type: 'STREAK', threshold: 7 },
    ],
    [3, 'Quiz Explorer', 'Hoàn thành 10 quiz', { type: 'QUIZ', threshold: 10 }],
    [
      4,
      'Speaking Brave',
      'Nộp bài speaking đầu tiên',
      { type: 'SPEAKING', threshold: 1 },
    ],
  ] as const;
  for (const [id, name, description, criteria] of badges)
    await prisma.badge.upsert({
      where: { id },
      update: { name, description, criteria },
      create: { id, name, description, criteria },
    });
  for (const student of students) {
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId: student.id, badgeId: 1 } },
      update: {},
      create: { userId: student.id, badgeId: 1 },
    });
    await prisma.pointHistory.upsert({
      where: { id: 1000 + student.id },
      update: {
        userId: student.id,
        points: 25,
        reason: 'Seed: hoàn thành bài học',
      },
      create: {
        id: 1000 + student.id,
        userId: student.id,
        points: 25,
        reason: 'Seed: hoàn thành bài học',
      },
    });
  }

  const speakingExercises = [
    {
      title: 'Read Aloud A1 — Daily Schedule',
      targetText:
        'The library opens at eight o’clock and closes at six in the evening.',
      difficulty: 'BEGINNER',
      category: 'GENERAL',
    },
    {
      title: 'Read Aloud A1 — Weather',
      targetText:
        'It will be sunny this morning, but light rain is expected after lunch.',
      difficulty: 'BEGINNER',
      category: 'GENERAL',
    },
    {
      title: 'Read Aloud A2 — Appointment',
      targetText:
        'Your appointment is scheduled for Thursday, September seventeenth, at two thirty in the afternoon.',
      difficulty: 'BEGINNER',
      category: 'GENERAL',
    },
    {
      title: 'Read Aloud A2 — Travel',
      targetText:
        'Passengers for Flight 318 should proceed to Gate 12 with their boarding passes ready.',
      difficulty: 'BEGINNER',
      category: 'TOEIC',
    },
    {
      title: 'Read Aloud A2 — Store Notice',
      targetText:
        'Customers may return unused items within thirty days if they have the original receipt.',
      difficulty: 'BEGINNER',
      category: 'GENERAL',
    },
    {
      title: 'Read Aloud B1 — Office Announcement',
      targetText:
        'The monthly staff meeting will begin at nine thirty in Conference Room B. Please bring the latest project update.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'Read Aloud B1 — Hotel Service',
      targetText:
        'Breakfast is served from six thirty until ten on the second floor, next to the business center.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'Read Aloud B1 — Delivery',
      targetText:
        'Because of severe weather, deliveries to the northern region may arrive one business day later than scheduled.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'Read Aloud B2 — Training',
      targetText:
        'Employees who wish to attend the leadership workshop should register online before Friday and obtain approval from their department manager.',
      difficulty: 'ADVANCED',
      category: 'TOEIC',
    },
    {
      title: 'Read Aloud B2 — Customer Policy',
      targetText:
        'To improve response times, customer requests received after five p.m. will be reviewed at the beginning of the next business day.',
      difficulty: 'ADVANCED',
      category: 'TOEIC',
    },
    {
      title: 'Pronunciation — Final Consonants',
      targetText:
        'Please send the signed contract to the client before the end of the week.',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Pronunciation — -ed Endings',
      targetText:
        'We reviewed the proposal, discussed the budget, and approved the revised schedule.',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Pronunciation — Word Stress',
      targetText:
        'The marketing department will present a recommendation during tomorrow’s conference.',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Pronunciation — Numbers & Dates',
      targetText:
        'The total is two hundred forty-eight dollars and sixty cents, payable by October twenty-first.',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Pronunciation — Linking',
      targetText:
        'Could you send me an updated copy of the agenda before our afternoon meeting?',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Question Response A2 — Weekend',
      targetText: 'What do you usually do on weekends?',
      difficulty: 'BEGINNER',
      category: 'GENERAL',
    },
    {
      title: 'Question Response A2 — Transport',
      targetText: 'How do you normally travel to school or work?',
      difficulty: 'BEGINNER',
      category: 'GENERAL',
    },
    {
      title: 'Question Response B1 — Study Habit',
      targetText: 'What is one habit that helps you learn English effectively?',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Question Response B1 — Meeting Preparation',
      targetText:
        'How do you prepare for an important meeting or presentation?',
      difficulty: 'INTERMEDIATE',
      category: 'BUSINESS',
    },
    {
      title: 'Question Response B2 — Customer Service',
      targetText:
        'What should a company do when a customer receives a damaged product?',
      difficulty: 'ADVANCED',
      category: 'BUSINESS',
    },
    {
      title: 'Opinion B1 — Online Learning',
      targetText:
        'Do you prefer learning online or in a classroom? Explain your choice.',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Opinion B1 — Public Transport',
      targetText:
        'Should cities invest more in public transportation? Give two reasons.',
      difficulty: 'INTERMEDIATE',
      category: 'GENERAL',
    },
    {
      title: 'Opinion B2 — Remote Work',
      targetText:
        'Should employees be allowed to work remotely several days each week? Support your opinion.',
      difficulty: 'ADVANCED',
      category: 'BUSINESS',
    },
    {
      title: 'Opinion B2 — Training',
      targetText:
        'Is professional training more effective during work hours or outside work hours? Explain.',
      difficulty: 'ADVANCED',
      category: 'BUSINESS',
    },
    {
      title: 'TOEIC Speaking — Read Aloud 1',
      targetText:
        'Welcome to the Riverside Conference Center. Registration desks are located directly across from the main entrance and will remain open until ten thirty.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'TOEIC Speaking — Read Aloud 2',
      targetText:
        'Please note that the east parking garage will be unavailable this weekend while maintenance crews replace the lighting system.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'TOEIC Speaking — Describe Office Scene',
      targetText:
        'Describe a modern office where three colleagues are discussing a document while another employee is working at a computer.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'TOEIC Speaking — Describe Station Scene',
      targetText:
        'Describe a train station where travelers are looking at a departure board and one person is carrying a large suitcase.',
      difficulty: 'INTERMEDIATE',
      category: 'TOEIC',
    },
    {
      title: 'TOEIC Speaking — Information Response',
      targetText:
        'A seminar schedule shows registration at 9:00, a presentation at 10:00, lunch at 12:30, and a workshop at 2:00. Explain the afternoon schedule.',
      difficulty: 'ADVANCED',
      category: 'TOEIC',
    },
    {
      title: 'TOEIC Speaking — Express Opinion',
      targetText:
        'Do you think companies should provide employees with free language training? Give reasons and examples.',
      difficulty: 'ADVANCED',
      category: 'TOEIC',
    },
  ];
  for (let index = 0; index < speakingExercises.length; index += 1) {
    const item = speakingExercises[index];
    await prisma.speakingExercise.upsert({
      where: { id: index + 1 },
      update: item,
      create: { id: index + 1, ...item },
    });
  }
  for (let index = 0; index < 3; index += 1) {
    await prisma.speakingSubmission.upsert({
      where: { id: 300 + index },
      update: {
        exerciseId: index + 1,
        userId: students[index].id,
        audioUrl: `/seed/audio/speaking-${index + 1}.webm`,
        overallScore: 7.5 + index * 0.5,
        aiFeedback: {
          pronunciation: 7.5 + index * 0.4,
          fluency: 7 + index * 0.5,
          advice:
            'Giữ tốc độ ổn định, nhấn trọng âm từ khóa và nối âm tự nhiên.',
        },
      },
      create: {
        id: 300 + index,
        exerciseId: index + 1,
        userId: students[index].id,
        audioUrl: `/seed/audio/speaking-${index + 1}.webm`,
        overallScore: 7.5 + index * 0.5,
        aiFeedback: {
          pronunciation: 7.5 + index * 0.4,
          fluency: 7 + index * 0.5,
          advice:
            'Giữ tốc độ ổn định, nhấn trọng âm từ khóa và nối âm tự nhiên.',
        },
      },
    });
  }

  const vocabTopics = [
    {
      title: 'Daily Routines & Time',
      categoryName: 'Tiếng Anh hằng ngày',
      isPro: false,
      words: [
        [
          'schedule',
          'noun',
          '/ˈskedʒ.uːl/',
          '/ˈʃedʒ.uːl/',
          'lịch trình',
          'My schedule is quite busy on Mondays.',
          'Lịch trình của tôi khá bận vào thứ Hai.',
        ],
        [
          'routine',
          'noun',
          '/ruːˈtiːn/',
          '/ruːˈtiːn/',
          'thói quen, nếp sinh hoạt',
          'Exercise is part of my morning routine.',
          'Tập thể dục là một phần thói quen buổi sáng của tôi.',
        ],
        [
          'appointment',
          'noun',
          '/əˈpɔɪnt.mənt/',
          '/əˈpɔɪnt.mənt/',
          'cuộc hẹn',
          'I have a dentist appointment at three.',
          'Tôi có lịch hẹn nha sĩ lúc ba giờ.',
        ],
        [
          'available',
          'adjective',
          '/əˈveɪ.lə.bəl/',
          '/əˈveɪ.lə.bəl/',
          'có sẵn, rảnh',
          'Are you available on Friday afternoon?',
          'Bạn có rảnh chiều thứ Sáu không?',
        ],
        [
          'usually',
          'adverb',
          '/ˈjuː.ʒu.ə.li/',
          '/ˈjuː.ʒu.ə.li/',
          'thường xuyên',
          'I usually take the bus to work.',
          'Tôi thường đi xe buýt đến chỗ làm.',
        ],
        [
          'prepare',
          'verb',
          '/prɪˈper/',
          '/prɪˈpeə/',
          'chuẩn bị',
          'She prepares lunch before leaving home.',
          'Cô ấy chuẩn bị bữa trưa trước khi rời nhà.',
        ],
        [
          'delay',
          'noun',
          '/dɪˈleɪ/',
          '/dɪˈleɪ/',
          'sự chậm trễ',
          'The train arrived after a short delay.',
          'Tàu đến sau một khoảng chậm trễ ngắn.',
        ],
        [
          'remind',
          'verb',
          '/rɪˈmaɪnd/',
          '/rɪˈmaɪnd/',
          'nhắc nhở',
          'Please remind me to call the bank.',
          'Hãy nhắc tôi gọi cho ngân hàng.',
        ],
        [
          'early',
          'adverb',
          '/ˈɝː.li/',
          '/ˈɜː.li/',
          'sớm',
          'We arrived ten minutes early.',
          'Chúng tôi đến sớm mười phút.',
        ],
        [
          'cancel',
          'verb',
          '/ˈkæn.səl/',
          '/ˈkæn.səl/',
          'hủy',
          'They canceled the outdoor event because of rain.',
          'Họ hủy sự kiện ngoài trời vì mưa.',
        ],
      ],
    },
    {
      title: 'Travel & Transportation',
      categoryName: 'Giao tiếp thực tế',
      isPro: false,
      words: [
        [
          'departure',
          'noun',
          '/dɪˈpɑːr.tʃɚ/',
          '/dɪˈpɑː.tʃə/',
          'sự khởi hành',
          'Check the departure time before leaving.',
          'Hãy kiểm tra giờ khởi hành trước khi đi.',
        ],
        [
          'arrival',
          'noun',
          '/əˈraɪ.vəl/',
          '/əˈraɪ.vəl/',
          'sự đến nơi',
          'Our expected arrival is 6:40 P.M.',
          'Giờ đến dự kiến là 6:40 tối.',
        ],
        [
          'passenger',
          'noun',
          '/ˈpæs.ən.dʒɚ/',
          '/ˈpæs.ən.dʒə/',
          'hành khách',
          'Passengers should keep their tickets ready.',
          'Hành khách nên chuẩn bị sẵn vé.',
        ],
        [
          'reservation',
          'noun',
          '/ˌrez.ɚˈveɪ.ʃən/',
          '/ˌrez.əˈveɪ.ʃən/',
          'sự đặt chỗ',
          'I made a hotel reservation for two nights.',
          'Tôi đã đặt khách sạn cho hai đêm.',
        ],
        [
          'luggage',
          'noun',
          '/ˈlʌɡ.ɪdʒ/',
          '/ˈlʌɡ.ɪdʒ/',
          'hành lý',
          'Your luggage can be stored at reception.',
          'Hành lý của bạn có thể được gửi ở lễ tân.',
        ],
        [
          'platform',
          'noun',
          '/ˈplæt.fɔːrm/',
          '/ˈplæt.fɔːm/',
          'sân ga',
          'The train leaves from platform seven.',
          'Tàu rời sân ga số bảy.',
        ],
        [
          'destination',
          'noun',
          '/ˌdes.təˈneɪ.ʃən/',
          '/ˌdes.tɪˈneɪ.ʃən/',
          'điểm đến',
          'Please check the destination on your ticket.',
          'Hãy kiểm tra điểm đến trên vé của bạn.',
        ],
        [
          'itinerary',
          'noun',
          '/aɪˈtɪn.ə.rer.i/',
          '/aɪˈtɪn.ə.rər.i/',
          'lịch trình chuyến đi',
          'The guide emailed us the final itinerary.',
          'Hướng dẫn viên đã gửi lịch trình cuối cùng qua email.',
        ],
        [
          'board',
          'verb',
          '/bɔːrd/',
          '/bɔːd/',
          'lên tàu, xe, máy bay',
          'Passengers may board the aircraft now.',
          'Hành khách có thể lên máy bay ngay bây giờ.',
        ],
        [
          'route',
          'noun',
          '/ruːt/',
          '/ruːt/',
          'tuyến đường',
          'This bus route stops near the museum.',
          'Tuyến xe buýt này dừng gần bảo tàng.',
        ],
      ],
    },
    {
      title: 'Office & Meetings',
      categoryName: '600 TỪ VỰNG TOEIC',
      isPro: false,
      words: [
        [
          'agenda',
          'noun',
          '/əˈdʒen.də/',
          '/əˈdʒen.də/',
          'chương trình họp',
          'I sent the meeting agenda this morning.',
          'Tôi đã gửi chương trình họp sáng nay.',
        ],
        [
          'conference',
          'noun',
          '/ˈkɑːn.fɚ.əns/',
          '/ˈkɒn.fər.əns/',
          'hội nghị',
          'The annual conference will be held in May.',
          'Hội nghị thường niên sẽ diễn ra vào tháng Năm.',
        ],
        [
          'colleague',
          'noun',
          '/ˈkɑː.liːɡ/',
          '/ˈkɒl.iːɡ/',
          'đồng nghiệp',
          'My colleague will lead the presentation.',
          'Đồng nghiệp của tôi sẽ dẫn phần thuyết trình.',
        ],
        [
          'deadline',
          'noun',
          '/ˈded.laɪn/',
          '/ˈded.laɪn/',
          'hạn chót',
          'We must meet the project deadline.',
          'Chúng tôi phải kịp hạn chót dự án.',
        ],
        [
          'proposal',
          'noun',
          '/prəˈpoʊ.zəl/',
          '/prəˈpəʊ.zəl/',
          'đề xuất',
          'The client approved our proposal.',
          'Khách hàng đã phê duyệt đề xuất của chúng tôi.',
        ],
        [
          'document',
          'noun',
          '/ˈdɑːk.jə.mənt/',
          '/ˈdɒk.jə.mənt/',
          'tài liệu',
          'Please attach the signed document.',
          'Vui lòng đính kèm tài liệu đã ký.',
        ],
        [
          'department',
          'noun',
          '/dɪˈpɑːrt.mənt/',
          '/dɪˈpɑːt.mənt/',
          'phòng ban',
          'She works in the finance department.',
          'Cô ấy làm việc ở phòng tài chính.',
        ],
        [
          'approve',
          'verb',
          '/əˈpruːv/',
          '/əˈpruːv/',
          'phê duyệt',
          'The director approved the revised budget.',
          'Giám đốc đã phê duyệt ngân sách sửa đổi.',
        ],
        [
          'attend',
          'verb',
          '/əˈtend/',
          '/əˈtend/',
          'tham dự',
          'More than fifty employees attended the workshop.',
          'Hơn năm mươi nhân viên đã tham dự hội thảo.',
        ],
        [
          'reschedule',
          'verb',
          '/ˌriːˈskedʒ.uːl/',
          '/ˌriːˈʃedʒ.uːl/',
          'đổi lịch',
          'Can we reschedule the meeting for Thursday?',
          'Chúng ta có thể đổi lịch họp sang thứ Năm không?',
        ],
      ],
    },
    {
      title: 'Customer Service & Retail',
      categoryName: '600 TỪ VỰNG TOEIC',
      isPro: false,
      words: [
        [
          'customer',
          'noun',
          '/ˈkʌs.tə.mɚ/',
          '/ˈkʌs.tə.mə/',
          'khách hàng',
          'The customer requested a refund.',
          'Khách hàng yêu cầu hoàn tiền.',
        ],
        [
          'refund',
          'noun',
          '/ˈriː.fʌnd/',
          '/ˈriː.fʌnd/',
          'tiền hoàn lại',
          'We issued a full refund yesterday.',
          'Chúng tôi đã hoàn đủ tiền hôm qua.',
        ],
        [
          'receipt',
          'noun',
          '/rɪˈsiːt/',
          '/rɪˈsiːt/',
          'hóa đơn, biên lai',
          'Keep your receipt in case you need a return.',
          'Hãy giữ biên lai phòng khi cần trả hàng.',
        ],
        [
          'discount',
          'noun',
          '/ˈdɪs.kaʊnt/',
          '/ˈdɪs.kaʊnt/',
          'giảm giá',
          'Members receive a ten-percent discount.',
          'Thành viên được giảm mười phần trăm.',
        ],
        [
          'replace',
          'verb',
          '/rɪˈpleɪs/',
          '/rɪˈpleɪs/',
          'thay thế',
          'We can replace the damaged item today.',
          'Chúng tôi có thể thay món hàng bị hỏng hôm nay.',
        ],
        [
          'complaint',
          'noun',
          '/kəmˈpleɪnt/',
          '/kəmˈpleɪnt/',
          'khiếu nại',
          'The manager responded to the complaint quickly.',
          'Quản lý phản hồi khiếu nại nhanh chóng.',
        ],
        [
          'purchase',
          'noun',
          '/ˈpɝː.tʃəs/',
          '/ˈpɜː.tʃəs/',
          'việc mua hàng',
          'Your purchase includes a one-year warranty.',
          'Sản phẩm bạn mua có bảo hành một năm.',
        ],
        [
          'stock',
          'noun',
          '/stɑːk/',
          '/stɒk/',
          'hàng tồn kho',
          'The blue model is currently out of stock.',
          'Mẫu màu xanh hiện đang hết hàng.',
        ],
        [
          'deliver',
          'verb',
          '/dɪˈlɪv.ɚ/',
          '/dɪˈlɪv.ə/',
          'giao hàng',
          'The company will deliver the chairs tomorrow.',
          'Công ty sẽ giao ghế vào ngày mai.',
        ],
        [
          'satisfaction',
          'noun',
          '/ˌsæt̬.ɪsˈfæk.ʃən/',
          '/ˌsæt.ɪsˈfæk.ʃən/',
          'sự hài lòng',
          'Customer satisfaction is our top priority.',
          'Sự hài lòng của khách hàng là ưu tiên hàng đầu.',
        ],
      ],
    },
    {
      title: 'Finance & Business',
      categoryName: '600 TỪ VỰNG TOEIC',
      isPro: true,
      words: [
        [
          'invoice',
          'noun',
          '/ˈɪn.vɔɪs/',
          '/ˈɪn.vɔɪs/',
          'hóa đơn thanh toán',
          'Please pay the invoice by Friday.',
          'Vui lòng thanh toán hóa đơn trước thứ Sáu.',
        ],
        [
          'budget',
          'noun',
          '/ˈbʌdʒ.ɪt/',
          '/ˈbʌdʒ.ɪt/',
          'ngân sách',
          'The project is within budget.',
          'Dự án đang trong phạm vi ngân sách.',
        ],
        [
          'revenue',
          'noun',
          '/ˈrev.ə.nuː/',
          '/ˈrev.ə.njuː/',
          'doanh thu',
          'Online sales increased our revenue.',
          'Bán hàng trực tuyến làm tăng doanh thu.',
        ],
        [
          'expense',
          'noun',
          '/ɪkˈspens/',
          '/ɪkˈspens/',
          'chi phí',
          'Travel expenses must be approved in advance.',
          'Chi phí đi lại phải được duyệt trước.',
        ],
        [
          'contract',
          'noun',
          '/ˈkɑːn.trækt/',
          '/ˈkɒn.trækt/',
          'hợp đồng',
          'Both companies signed the contract.',
          'Hai công ty đã ký hợp đồng.',
        ],
        [
          'negotiate',
          'verb',
          '/nɪˈɡoʊ.ʃi.eɪt/',
          '/nɪˈɡəʊ.ʃi.eɪt/',
          'đàm phán',
          'They negotiated a lower delivery fee.',
          'Họ đàm phán phí giao hàng thấp hơn.',
        ],
        [
          'forecast',
          'noun',
          '/ˈfɔːr.kæst/',
          '/ˈfɔː.kɑːst/',
          'dự báo',
          'The sales forecast looks positive.',
          'Dự báo doanh số có vẻ tích cực.',
        ],
        [
          'profit',
          'noun',
          '/ˈprɑː.fɪt/',
          '/ˈprɒf.ɪt/',
          'lợi nhuận',
          'The store reported a higher profit this quarter.',
          'Cửa hàng báo cáo lợi nhuận cao hơn quý này.',
        ],
        [
          'payment',
          'noun',
          '/ˈpeɪ.mənt/',
          '/ˈpeɪ.mənt/',
          'thanh toán',
          'We received your payment this morning.',
          'Chúng tôi đã nhận thanh toán của bạn sáng nay.',
        ],
        [
          'estimate',
          'noun',
          '/ˈes.tə.mət/',
          '/ˈes.tɪ.mət/',
          'bản ước tính',
          'The contractor provided a cost estimate.',
          'Nhà thầu đã cung cấp bản ước tính chi phí.',
        ],
      ],
    },
    {
      title: 'Technology & Projects',
      categoryName: 'Tiếng Anh công nghệ',
      isPro: true,
      words: [
        [
          'software',
          'noun',
          '/ˈsɔːft.wer/',
          '/ˈsɒft.weə/',
          'phần mềm',
          'The software update fixed several errors.',
          'Bản cập nhật phần mềm đã sửa nhiều lỗi.',
        ],
        [
          'database',
          'noun',
          '/ˈdeɪ.t̬ə.beɪs/',
          '/ˈdeɪ.tə.beɪs/',
          'cơ sở dữ liệu',
          'Customer records are stored in the database.',
          'Hồ sơ khách hàng được lưu trong cơ sở dữ liệu.',
        ],
        [
          'security',
          'noun',
          '/səˈkjʊr.ə.t̬i/',
          '/sɪˈkjʊə.rə.ti/',
          'bảo mật',
          'The company improved its network security.',
          'Công ty đã cải thiện bảo mật mạng.',
        ],
        [
          'upgrade',
          'verb',
          '/ʌpˈɡreɪd/',
          '/ʌpˈɡreɪd/',
          'nâng cấp',
          'We plan to upgrade the servers next month.',
          'Chúng tôi dự định nâng cấp máy chủ tháng tới.',
        ],
        [
          'install',
          'verb',
          '/ɪnˈstɔːl/',
          '/ɪnˈstɔːl/',
          'cài đặt',
          'The technician installed the new printer.',
          'Kỹ thuật viên đã cài đặt máy in mới.',
        ],
        [
          'backup',
          'noun',
          '/ˈbæk.ʌp/',
          '/ˈbæk.ʌp/',
          'bản sao lưu',
          'Create a backup before updating the system.',
          'Hãy tạo bản sao lưu trước khi cập nhật hệ thống.',
        ],
        [
          'feature',
          'noun',
          '/ˈfiː.tʃɚ/',
          '/ˈfiː.tʃə/',
          'tính năng',
          'Users requested a new search feature.',
          'Người dùng yêu cầu một tính năng tìm kiếm mới.',
        ],
        [
          'release',
          'noun',
          '/rɪˈliːs/',
          '/rɪˈliːs/',
          'bản phát hành',
          'The next software release is scheduled for June.',
          'Bản phát hành phần mềm tiếp theo dự kiến vào tháng Sáu.',
        ],
        [
          'milestone',
          'noun',
          '/ˈmaɪl.stoʊn/',
          '/ˈmaɪl.stəʊn/',
          'cột mốc',
          'The team reached an important project milestone.',
          'Nhóm đã đạt một cột mốc quan trọng của dự án.',
        ],
        [
          'reliable',
          'adjective',
          '/rɪˈlaɪ.ə.bəl/',
          '/rɪˈlaɪ.ə.bəl/',
          'đáng tin cậy',
          'We need a reliable internet connection.',
          'Chúng ta cần kết nối Internet đáng tin cậy.',
        ],
      ],
    },
    {
      title: 'Marketing & Sales',
      categoryName: '600 TỪ VỰNG TOEIC',
      isPro: true,
      words: [
        [
          'campaign',
          'noun',
          '/kæmˈpeɪn/',
          '/kæmˈpeɪn/',
          'chiến dịch',
          'The company launched a new advertising campaign.',
          'Công ty đã khởi động chiến dịch quảng cáo mới.',
        ],
        [
          'advertise',
          'verb',
          '/ˈæd.vɚ.taɪz/',
          '/ˈæd.və.taɪz/',
          'quảng cáo',
          'We advertise the product on social media.',
          'Chúng tôi quảng cáo sản phẩm trên mạng xã hội.',
        ],
        [
          'survey',
          'noun',
          '/ˈsɝː.veɪ/',
          '/ˈsɜː.veɪ/',
          'khảo sát',
          'The team conducted a customer survey.',
          'Nhóm đã thực hiện khảo sát khách hàng.',
        ],
        [
          'launch',
          'verb',
          '/lɔːntʃ/',
          '/lɔːntʃ/',
          'ra mắt',
          'They will launch the service next month.',
          'Họ sẽ ra mắt dịch vụ tháng tới.',
        ],
        [
          'target',
          'noun',
          '/ˈtɑːr.ɡɪt/',
          '/ˈtɑː.ɡɪt/',
          'mục tiêu',
          'Our sales target is five hundred units.',
          'Mục tiêu bán hàng là năm trăm sản phẩm.',
        ],
        [
          'consumer',
          'noun',
          '/kənˈsuː.mɚ/',
          '/kənˈsjuː.mə/',
          'người tiêu dùng',
          'The survey measures consumer preferences.',
          'Khảo sát đo lường sở thích người tiêu dùng.',
        ],
        [
          'promote',
          'verb',
          '/prəˈmoʊt/',
          '/prəˈməʊt/',
          'quảng bá',
          'The event will promote local businesses.',
          'Sự kiện sẽ quảng bá doanh nghiệp địa phương.',
        ],
        [
          'competitor',
          'noun',
          '/kəmˈpet̬.ə.t̬ɚ/',
          '/kəmˈpet.ɪ.tə/',
          'đối thủ cạnh tranh',
          'Our competitor reduced its prices.',
          'Đối thủ của chúng tôi đã giảm giá.',
        ],
        [
          'demand',
          'noun',
          '/dɪˈmænd/',
          '/dɪˈmɑːnd/',
          'nhu cầu',
          'Demand for the product increased rapidly.',
          'Nhu cầu sản phẩm tăng nhanh.',
        ],
        [
          'strategy',
          'noun',
          '/ˈstræt̬.ə.dʒi/',
          '/ˈstræt.ə.dʒi/',
          'chiến lược',
          'We need a clearer marketing strategy.',
          'Chúng ta cần chiến lược marketing rõ hơn.',
        ],
      ],
    },
    {
      title: 'Health, Learning & Well-being',
      categoryName: 'Tiếng Anh hằng ngày',
      isPro: false,
      words: [
        [
          'improve',
          'verb',
          '/ɪmˈpruːv/',
          '/ɪmˈpruːv/',
          'cải thiện',
          'Daily practice can improve your listening skills.',
          'Luyện tập hằng ngày có thể cải thiện kỹ năng nghe.',
        ],
        [
          'habit',
          'noun',
          '/ˈhæb.ɪt/',
          '/ˈhæb.ɪt/',
          'thói quen',
          'Reading every night is a useful habit.',
          'Đọc mỗi tối là một thói quen hữu ích.',
        ],
        [
          'concentrate',
          'verb',
          '/ˈkɑːn.sən.treɪt/',
          '/ˈkɒn.sən.treɪt/',
          'tập trung',
          'I concentrate better in a quiet room.',
          'Tôi tập trung tốt hơn trong phòng yên tĩnh.',
        ],
        [
          'balanced',
          'adjective',
          '/ˈbæl.ənst/',
          '/ˈbæl.ənst/',
          'cân bằng',
          'A balanced diet supports good health.',
          'Chế độ ăn cân bằng hỗ trợ sức khỏe tốt.',
        ],
        [
          'exercise',
          'noun',
          '/ˈek.sɚ.saɪz/',
          '/ˈek.sə.saɪz/',
          'việc tập thể dục',
          'Regular exercise can reduce stress.',
          'Tập thể dục đều đặn có thể giảm căng thẳng.',
        ],
        [
          'recover',
          'verb',
          '/rɪˈkʌv.ɚ/',
          '/rɪˈkʌv.ə/',
          'hồi phục',
          'He needs a few days to recover from the flu.',
          'Anh ấy cần vài ngày để hồi phục sau cúm.',
        ],
        [
          'focus',
          'noun',
          '/ˈfoʊ.kəs/',
          '/ˈfəʊ.kəs/',
          'sự tập trung',
          'Short breaks can improve focus.',
          'Nghỉ ngắn có thể cải thiện sự tập trung.',
        ],
        [
          'progress',
          'noun',
          '/ˈprɑː.ɡres/',
          '/ˈprəʊ.ɡres/',
          'tiến bộ',
          'You can track your progress every week.',
          'Bạn có thể theo dõi tiến bộ mỗi tuần.',
        ],
        [
          'review',
          'verb',
          '/rɪˈvjuː/',
          '/rɪˈvjuː/',
          'ôn tập, xem lại',
          'Review new words before going to bed.',
          'Hãy ôn từ mới trước khi đi ngủ.',
        ],
        [
          'goal',
          'noun',
          '/ɡoʊl/',
          '/ɡəʊl/',
          'mục tiêu',
          'My goal is to speak English more confidently.',
          'Mục tiêu của tôi là nói tiếng Anh tự tin hơn.',
        ],
      ],
    },
  ] as const;
  let vocabWordId = 1;
  for (let topicIndex = 0; topicIndex < vocabTopics.length; topicIndex += 1) {
    const definition = vocabTopics[topicIndex];
    const topic = await prisma.vocabTopic.upsert({
      where: { id: topicIndex + 1 },
      update: {
        title: definition.title,
        categoryName: definition.categoryName,
        totalWords: definition.words.length,
        isPro: definition.isPro,
      },
      create: {
        id: topicIndex + 1,
        title: definition.title,
        categoryName: definition.categoryName,
        totalWords: definition.words.length,
        isPro: definition.isPro,
      },
    });
    for (
      let wordIndex = 0;
      wordIndex < definition.words.length;
      wordIndex += 1
    ) {
      const [word, pos, ipaUs, ipaUk, meaning, exampleEn, exampleVi] =
        definition.words[wordIndex];
      const collocations = VOCAB_COLLOCATIONS[word] ?? [];
      await prisma.vocabWord.upsert({
        where: { id: vocabWordId },
        update: {
          topicId: topic.id,
          word,
          pos,
          ipaUs,
          ipaUk,
          meaning,
          exampleEn,
          exampleVi,
          collocations: collocations as Prisma.InputJsonValue,
          order: wordIndex + 1,
        },
        create: {
          id: vocabWordId,
          topicId: topic.id,
          word,
          pos,
          ipaUs,
          ipaUk,
          meaning,
          exampleEn,
          exampleVi,
          collocations: collocations as Prisma.InputJsonValue,
          order: wordIndex + 1,
        },
      });
      if (students[0] && wordIndex < 3)
        await prisma.userVocabWordProgress.upsert({
          where: {
            userId_wordId: { userId: students[0].id, wordId: vocabWordId },
          },
          update: { reviewCount: wordIndex + 1, isMastered: wordIndex === 0 },
          create: {
            userId: students[0].id,
            wordId: vocabWordId,
            reviewCount: wordIndex + 1,
            isMastered: wordIndex === 0,
          },
        });
      vocabWordId += 1;
    }
  }
  // Canonical lemmas used by the speaking text and dictionary popup. Keep
  // these IDs stable so repeated seeds remain idempotent and inflection
  // lookups such as "opens" can resolve to the stored lemma "open".
  const canonicalLookupWords = [
    {
      id: 1001,
      word: 'open',
      pos: 'verb',
      ipaUs: '/ˈoʊpən/',
      ipaUk: '/ˈəʊpən/',
      meaning: 'mở; khai mạc; mở cửa',
      exampleEn: 'Please open the window before the meeting starts.',
      exampleVi: 'Vui lòng mở cửa sổ trước khi cuộc họp bắt đầu.',
      collocations: [
        { phrase: 'open a meeting', meaningVi: 'mở đầu cuộc họp' },
        { phrase: 'open the door', meaningVi: 'mở cửa' },
      ],
    },
    {
      id: 1002,
      word: 'clock',
      pos: 'noun',
      ipaUs: '/klɑːk/',
      ipaUk: '/klɒk/',
      meaning: 'đồng hồ; thời gian trên đồng hồ',
      exampleEn: 'The meeting starts at nine o’clock.',
      exampleVi: 'Cuộc họp bắt đầu lúc chín giờ.',
      collocations: [
        { phrase: 'watch the clock', meaningVi: 'liên tục nhìn đồng hồ' },
        { phrase: 'around the clock', meaningVi: 'suốt ngày đêm' },
      ],
    },
  ] as const;
  for (const definition of canonicalLookupWords) {
    await prisma.vocabWord.upsert({
      where: { id: definition.id },
      update: {
        topicId: 1,
        word: definition.word,
        pos: definition.pos,
        ipaUs: definition.ipaUs,
        ipaUk: definition.ipaUk,
        meaning: definition.meaning,
        exampleEn: definition.exampleEn,
        exampleVi: definition.exampleVi,
        collocations: definition.collocations as Prisma.InputJsonValue,
      },
      create: {
        id: definition.id,
        topicId: 1,
        word: definition.word,
        pos: definition.pos,
        ipaUs: definition.ipaUs,
        ipaUk: definition.ipaUk,
        meaning: definition.meaning,
        exampleEn: definition.exampleEn,
        exampleVi: definition.exampleVi,
        collocations: definition.collocations as Prisma.InputJsonValue,
      },
    });
  }
  // Replace the old numbered placeholder words from the development seed.
  await prisma.vocabWord.deleteMany({
    where: { id: { gte: vocabWordId, lte: 72 } },
  });
  await prisma.vocabTopic.deleteMany({
    where: { id: { gt: vocabTopics.length, lte: 6 } },
  });

  const grammarTopics = [
    {
      title: 'Present Simple & Adverbs of Frequency',
      level: 'BEGINNER',
      description: 'Thói quen, sự thật và lịch trình cố định.',
      keyFormula: 'S + V(s/es); do/does; always/usually/often/sometimes/never',
      questions: [
        [
          'The reception desk ______ at 8 A.M. every weekday.',
          ['opening', 'opened', 'open', 'opens'],
          3,
          'Chủ ngữ số ít và thói quen dùng hiện tại đơn: opens.',
        ],
        [
          'We ______ check the inventory before placing a new order.',
          ['yesterday', 'ago', 'usually', 'last'],
          2,
          'Usually là trạng từ tần suất phù hợp với thói quen.',
        ],
        [
          '______ your manager work from home on Fridays?',
          ['Does', 'Did', 'Do', 'Is'],
          0,
          'Chủ ngữ số ít ở câu hỏi hiện tại đơn dùng Does.',
        ],
        [
          'My colleagues ______ lunch in the cafeteria most days.',
          ['had', 'having', 'have', 'has'],
          2,
          'Chủ ngữ số nhiều dùng have.',
        ],
        [
          'The train to the airport ______ every thirty minutes.',
          ['left', 'leaving', 'leave', 'leaves'],
          3,
          'Lịch trình cố định dùng hiện tại đơn: leaves.',
        ],
      ],
    },
    {
      title: 'Past Simple & Time Expressions',
      level: 'BEGINNER',
      description: 'Hành động đã kết thúc trong quá khứ.',
      keyFormula: 'S + V2/V-ed; did + V; yesterday/last/ago',
      questions: [
        [
          'The technician ______ the printer yesterday afternoon.',
          ['repaired', 'repairs', 'repair', 'repairing'],
          0,
          'Yesterday yêu cầu quá khứ đơn: repaired.',
        ],
        [
          'Did you ______ the customer this morning?',
          ['calling', 'call', 'calls', 'called'],
          1,
          'Sau Did dùng động từ nguyên mẫu.',
        ],
        [
          'We ______ the conference in Hanoi last year.',
          ['attending', 'attends', 'attended', 'attend'],
          2,
          'Last year là mốc quá khứ hoàn tất.',
        ],
        [
          'The store ______ early because of the storm.',
          ['closed', 'has close', 'is closing', 'closes'],
          0,
          'Sự kiện đã xảy ra dùng closed.',
        ],
        [
          'She ______ the final report two hours ago.',
          ['sends', 'has send', 'sent', 'send'],
          2,
          'Ago đi với quá khứ đơn: sent.',
        ],
      ],
    },
    {
      title: 'Present Perfect',
      level: 'INTERMEDIATE',
      description: 'Kinh nghiệm, kết quả hiện tại và khoảng thời gian kéo dài.',
      keyFormula: 'have/has + V3; since/for/already/yet',
      questions: [
        [
          'We have worked with this supplier ______ 2022.',
          ['from', 'during', 'since', 'for'],
          2,
          'Since đi với mốc bắt đầu.',
        ],
        [
          'The team has ______ completed the first phase.',
          ['last', 'yet', 'ago', 'already'],
          3,
          'Already thường dùng trong câu khẳng định hiện tại hoàn thành.',
        ],
        [
          'Have you received the invoice ______?',
          ['yet', 'since', 'ago', 'for'],
          0,
          'Yet thường ở cuối câu hỏi/phủ định.',
        ],
        [
          'Ms. Lee ______ three client meetings this week.',
          ['has attended', 'attended yesterday', 'is attend', 'attend'],
          0,
          "Khoảng thời gian 'this week' chưa kết thúc nên hiện tại hoàn thành phù hợp.",
        ],
        [
          'They have lived here ______ five years.',
          ['from', 'during', 'for', 'since'],
          2,
          'For đi với khoảng thời gian.',
        ],
      ],
    },
    {
      title: 'Future Forms',
      level: 'BEGINNER',
      description: 'Kế hoạch, dự đoán và lịch tương lai.',
      keyFormula:
        'will + V; be going to + V; present continuous for arrangements',
      questions: [
        [
          'I ______ send you the revised file this afternoon.',
          ['have', 'did', 'will', 'was'],
          2,
          'Will + V diễn tả quyết định/lời hứa tương lai.',
        ],
        [
          'We are going to ______ a new branch next year.',
          ['opens', 'open', 'opened', 'opening'],
          1,
          'Sau going to dùng động từ nguyên mẫu.',
        ],
        [
          'The sales team ______ the client at 10 tomorrow morning.',
          ['is meeting', 'met', 'meeting', 'has meet'],
          0,
          'Hiện tại tiếp diễn dùng cho sắp xếp đã có kế hoạch.',
        ],
        [
          'I think demand ______ increase next quarter.',
          ['did', 'was', 'will', 'has'],
          2,
          'Dự đoán tương lai dùng will.',
        ],
        [
          'They ______ to Singapore next Monday; the tickets are booked.',
          ['fly yesterday', 'have flown', 'are flying', 'flew'],
          2,
          'Kế hoạch đã sắp xếp dùng hiện tại tiếp diễn.',
        ],
      ],
    },
    {
      title: 'Parts of Speech',
      level: 'INTERMEDIATE',
      description: 'Chọn đúng danh từ, động từ, tính từ, trạng từ trong câu.',
      keyFormula: 'Adj + N; V + Adv; be + Adj',
      questions: [
        [
          'The new booking system is extremely ______.',
          ['reliably', 'rely', 'reliability', 'reliable'],
          3,
          'Sau be và extremely cần tính từ: reliable.',
        ],
        [
          'Customer ______ remains our highest priority.',
          ['satisfied', 'satisfaction', 'satisfy', 'satisfactory'],
          1,
          'Cần danh từ làm chủ ngữ: satisfaction.',
        ],
        [
          'Please review the figures ______ before the meeting.',
          ['care', 'carefully', 'carefulness', 'careful'],
          1,
          'Trạng từ carefully bổ nghĩa cho review.',
        ],
        [
          'The company announced a major ______ of its service network.',
          ['expanded', 'expansive', 'expand', 'expansion'],
          3,
          'Sau mạo từ/tính từ cần danh từ expansion.',
        ],
        [
          'The new app allows users to work more ______.',
          ['efficient', 'efficiencies', 'efficiency', 'efficiently'],
          3,
          'Trạng từ efficiently bổ nghĩa cho work.',
        ],
      ],
    },
    {
      title: 'Modals & Polite Requests',
      level: 'INTERMEDIATE',
      description: 'Khả năng, nghĩa vụ, lời khuyên và yêu cầu lịch sự.',
      keyFormula: 'can/could/may/might/should/must + V',
      questions: [
        [
          '______ you please send me the updated agenda?',
          ['Could', 'Did', 'Are', 'Have'],
          0,
          'Could you please… là yêu cầu lịch sự.',
        ],
        [
          'Employees ______ wear their ID badges inside the building.',
          ['might', 'would', 'must', 'could have'],
          2,
          'Must diễn tả nghĩa vụ bắt buộc.',
        ],
        [
          'You ______ back up the file before installing the update.',
          ['should', 'would yesterday', 'must to', 'can to'],
          0,
          'Should diễn tả lời khuyên.',
        ],
        [
          'Visitors ______ not enter the laboratory without permission.',
          ['doing', 'may', 'are', 'have'],
          1,
          'May not diễn tả không được phép.',
        ],
        [
          'I ______ be able to join the call after 3 P.M.',
          ['might', 'did', 'must to', 'am'],
          0,
          'Might + V diễn tả khả năng chưa chắc chắn.',
        ],
      ],
    },
    {
      title: 'Passive Voice',
      level: 'INTERMEDIATE',
      description: 'Nhấn mạnh đối tượng nhận hành động hoặc quy trình.',
      keyFormula: 'be + V3; modal + be + V3',
      questions: [
        [
          'The annual report ______ by the finance team yesterday.',
          ['is preparing', 'has prepare', 'prepared', 'was prepared'],
          3,
          'Quá khứ bị động: was prepared.',
        ],
        [
          'All applications must ______ online.',
          ['be submit', 'be submitted', 'submit', 'submitted'],
          1,
          'Bị động sau modal: must be submitted.',
        ],
        [
          'The elevators ______ every six months.',
          ['are inspected', 'inspect', 'inspected by', 'are inspecting'],
          0,
          'Quy trình định kỳ dùng hiện tại bị động.',
        ],
        [
          'A confirmation email will ______ within 24 hours.',
          ['sent', 'be sending', 'send', 'be sent'],
          3,
          'Tương lai bị động: will be sent.',
        ],
        [
          'The meeting room ______ for another group at the moment.',
          ['used', 'is being used', 'has use', 'uses'],
          1,
          'Hành động đang diễn ra ở bị động: is being used.',
        ],
      ],
    },
    {
      title: 'Comparatives & Quantifiers',
      level: 'INTERMEDIATE',
      description: 'So sánh và diễn tả số lượng trong ngữ cảnh thực tế.',
      keyFormula: '-er/more; fewer/less; many/much',
      questions: [
        [
          'This model is ______ than the previous one.',
          [
            'efficiency',
            'most efficient',
            'more efficiently',
            'more efficient',
          ],
          3,
          'So sánh hơn của tính từ dài: more efficient.',
        ],
        [
          'We received ______ complaints this month than last month.',
          ['little', 'less', 'much', 'fewer'],
          3,
          'Complaints đếm được số nhiều dùng fewer.',
        ],
        [
          'There is ______ traffic on Sundays.',
          ['several', 'many', 'fewer', 'less'],
          3,
          'Traffic không đếm được dùng less.',
        ],
        [
          'The premium plan offers ______ storage than the basic plan.',
          ['fewer', 'few', 'many', 'more'],
          3,
          'Storage không đếm được; so sánh tăng dùng more.',
        ],
        [
          'Which route is the ______ one to the airport?',
          ['most fastly', 'faster', 'more fast', 'fastest'],
          3,
          'So sánh nhất dùng fastest.',
        ],
      ],
    },
    {
      title: 'Conditionals',
      level: 'ADVANCED',
      description: 'Điều kiện thật, giả định hiện tại và giả định quá khứ.',
      keyFormula:
        'If + present, will; If + past, would; If + had V3, would have V3',
      questions: [
        [
          'If the client approves the design, we ______ production next week.',
          ['start yesterday', 'started', 'will start', 'would started'],
          2,
          'Điều kiện loại 1: if + hiện tại, will + V.',
        ],
        [
          'If I ______ more time, I would take an advanced writing course.',
          ['had', 'will have', 'have', 'having'],
          0,
          'Điều kiện loại 2 dùng quá khứ đơn ở mệnh đề if.',
        ],
        [
          'If the shipment had arrived earlier, we ______ the deadline.',
          ['would have met', 'would meet yesterday', 'met', 'will meet'],
          0,
          'Điều kiện loại 3: would have + V3.',
        ],
        [
          'Unless you ______ the form, we cannot process the request.',
          ['signing', 'sign', 'will signed', 'signed yesterday'],
          1,
          'Unless + hiện tại đơn cho điều kiện thật.',
        ],
        [
          'If prices ______ again, customers may choose another supplier.',
          ['will increases', 'increase', 'increasing', 'increased yesterday'],
          1,
          'Mệnh đề if loại 1 dùng hiện tại đơn.',
        ],
      ],
    },
    {
      title: 'Relative Clauses',
      level: 'ADVANCED',
      description: 'Bổ nghĩa danh từ bằng who/which/that/where/whose.',
      keyFormula: 'N + who/which/that + clause',
      questions: [
        [
          'The applicant ______ called yesterday has accepted the offer.',
          ['where', 'who', 'which', 'whose office'],
          1,
          'Who thay cho người và làm chủ ngữ.',
        ],
        [
          'The laptop ______ I ordered arrived this morning.',
          ['where', 'when', 'that', 'who'],
          2,
          'That/which có thể thay vật.',
        ],
        [
          'This is the branch ______ the training will take place.',
          ['whose', 'where', 'which person', 'who'],
          1,
          'Where dùng cho địa điểm.',
        ],
        [
          'The manager ______ team won the award thanked everyone.',
          ['whose', 'who is', 'which', 'where'],
          0,
          'Whose diễn tả sở hữu.',
        ],
        [
          'The document, ______ was revised yesterday, is ready for approval.',
          ['whose', 'where', 'which', 'who'],
          2,
          'Mệnh đề không xác định cho vật dùng which.',
        ],
      ],
    },
    {
      title: 'Gerunds & Infinitives',
      level: 'ADVANCED',
      description: 'Mẫu động từ thường gặp trong công việc và TOEIC Part 5.',
      keyFormula: 'enjoy/avoid + V-ing; decide/plan/agree + to V',
      questions: [
        [
          'The company plans ______ two new stores next year.',
          ['open to', 'opened', 'opening after plans', 'to open'],
          3,
          'Plan + to infinitive.',
        ],
        [
          'Please avoid ______ confidential files by email.',
          ['sent', 'sending', 'to sent', 'sendings'],
          1,
          'Avoid + V-ing.',
        ],
        [
          'She agreed ______ the presentation on Friday.',
          ['gave to', 'to give', 'giving after agreed', 'give'],
          1,
          'Agree + to V.',
        ],
        [
          'We finished ______ the budget before lunch.',
          ['reviewed to', 'to reviewed', 'review', 'reviewing'],
          3,
          'Finish + V-ing.',
        ],
        [
          'They decided ______ the launch until next month.',
          [
            'postpone to',
            'postponing after decided',
            'postponed',
            'to postpone',
          ],
          3,
          'Decide + to V.',
        ],
      ],
    },
    {
      title: 'Connectors & Coherence',
      level: 'ADVANCED',
      description: 'Liên kết nguyên nhân, tương phản, kết quả và bổ sung.',
      keyFormula: 'although/however/because/therefore/in addition',
      questions: [
        [
          '______ the weather was poor, the event attracted many visitors.',
          ['Because of', 'Although', 'In addition to', 'Therefore'],
          1,
          'Although + mệnh đề diễn tả tương phản.',
        ],
        [
          'The supplier reduced its price; ______, we decided to renew the contract.',
          ['therefore', 'meanwhile because', 'unless', 'although'],
          0,
          'Therefore diễn tả kết quả.',
        ],
        [
          'The office is small. ______, it is located near the station.',
          ['So that', 'However', 'Because', 'Unless'],
          1,
          'However nối hai ý tương phản.',
        ],
        [
          'Sales increased ______ the new advertising campaign was effective.',
          ['because', 'despite', 'however', 'although'],
          0,
          'Because + mệnh đề nguyên nhân.',
        ],
        [
          'The workshop covers negotiation skills. ______, it includes a session on presentation techniques.',
          ['Because of', 'Unless', 'In addition', 'Although'],
          2,
          'In addition bổ sung thông tin.',
        ],
      ],
    },
  ] as const;
  let grammarQuestionId = 1;
  for (let topicIndex = 0; topicIndex < grammarTopics.length; topicIndex += 1) {
    const topic = await prisma.grammarTopic.upsert({
      where: { id: topicIndex + 1 },
      update: {
        title: grammarTopics[topicIndex].title,
        level: grammarTopics[topicIndex].level,
        description: grammarTopics[topicIndex].description,
        keyFormula: grammarTopics[topicIndex].keyFormula,
        order: topicIndex + 1,
      },
      create: {
        id: topicIndex + 1,
        title: grammarTopics[topicIndex].title,
        level: grammarTopics[topicIndex].level,
        description: grammarTopics[topicIndex].description,
        keyFormula: grammarTopics[topicIndex].keyFormula,
        order: topicIndex + 1,
      },
    });
    for (
      let questionIndex = 0;
      questionIndex < grammarTopics[topicIndex].questions.length;
      questionIndex += 1
    ) {
      const [question, options, correctIndex, explanation] =
        grammarTopics[topicIndex].questions[questionIndex];
      await prisma.grammarQuestion.upsert({
        where: { id: grammarQuestionId },
        update: {
          topicId: topic.id,
          question,
          options,
          correctIndex,
          explanation,
          order: questionIndex + 1,
        },
        create: {
          id: grammarQuestionId,
          topicId: topic.id,
          question,
          options,
          correctIndex,
          explanation,
          order: questionIndex + 1,
        },
      });
      grammarQuestionId += 1;
    }
  }
  // The prior seed created generic five-question sets. Remove only its unused IDs.
  await prisma.grammarQuestion.deleteMany({
    where: { id: { gte: grammarQuestionId, lte: 30 } },
  });
  for (let index = 0; index < 3; index += 1) {
    const seededGrammarAnswers = Object.fromEntries(
      grammarTopics[index].questions.map((question, questionIndex) => [
        String(questionIndex + 1),
        question[2],
      ]),
    );
    await prisma.grammarAttempt.upsert({
      where: { id: 400 + index },
      update: {
        userId: students[index].id,
        topicId: index + 1,
        score: 100,
        answers: seededGrammarAnswers,
      },
      create: {
        id: 400 + index,
        userId: students[index].id,
        topicId: index + 1,
        score: 100,
        answers: seededGrammarAnswers,
      },
    });
    await prisma.userGrammarReward.upsert({
      where: {
        userId_topicId: { userId: students[index].id, topicId: index + 1 },
      },
      update: {},
      create: { userId: students[index].id, topicId: index + 1 },
    });
  }

  const toeicExam = await prisma.toeicExamSet.upsert({
    where: { id: 1 },
    update: {
      title: 'TOEIC Listening & Reading — Đề thi chuẩn 01',
      description:
        'Đề thi thử nguyên bản theo cấu trúc TOEIC Listening & Reading hiện hành: 100 câu Listening (45 phút) + 100 câu Reading (75 phút), Part 1–7. Nội dung do BreadTrans biên soạn, không phải câu hỏi chính thức của ETS.',
      type: ExamType.FULL_TEST,
      difficulty: 'medium',
      createdBy: admin.id,
    },
    create: {
      id: 1,
      title: 'TOEIC Listening & Reading — Đề thi chuẩn 01',
      description:
        'Đề thi thử nguyên bản theo cấu trúc TOEIC Listening & Reading hiện hành: 100 câu Listening (45 phút) + 100 câu Reading (75 phút), Part 1–7. Nội dung do BreadTrans biên soạn, không phải câu hỏi chính thức của ETS.',
      type: ExamType.FULL_TEST,
      difficulty: 'medium',
      createdBy: admin.id,
    },
  });

  // Rebuild only the seeded full mock. Question distribution: P1=6, P2=25, P3=39, P4=30, P5=30, P6=16, P7=54.
  await prisma.toeicQuestionGroup.deleteMany({
    where: { examId: toeicExam.id },
  });
  const toeicFullMockGroups = [
    {
      part: 1,
      passageText:
        'PHOTO SCENE: A woman is arranging folders on shelves in an office archive.',
      imageUrl: seedAssetUrl('toeic/visuals/folders-cabinet.png'),
      audioUrl: null,
      questions: [
        {
          questionNumber: 1,
          text: 'Choose the sentence that best describes the photograph.',
          options: [
            'A woman is opening a window.',
            'Several people are moving desks.',
            'Some folders are being thrown away.',
            'A woman is organizing files on a shelf.',
          ],
          correctIndex: 3,
          explanation:
            'The scene shows one woman arranging folders on shelves.',
        },
      ],
    },
    {
      part: 1,
      passageText:
        'PHOTO SCENE: Two construction workers are wearing helmets and looking at a building plan beside a partially completed wall.',
      imageUrl: seedAssetUrl('toeic/visuals/construction-plan.png'),
      audioUrl: null,
      questions: [
        {
          questionNumber: 2,
          text: 'Choose the sentence that best describes the photograph.',
          options: [
            'A wall is being painted by a customer.',
            'The helmets are lying on the ground.',
            'The workers are planting trees.',
            'The workers are reviewing a plan.',
          ],
          correctIndex: 3,
          explanation: 'The workers are looking at a building plan.',
        },
      ],
    },
    {
      part: 1,
      passageText:
        'PHOTO SCENE: Several bicycles are parked in a rack outside a glass office building.',
      imageUrl: seedAssetUrl('toeic/visuals/bicycle-rack.png'),
      audioUrl: null,
      questions: [
        {
          questionNumber: 3,
          text: 'Choose the sentence that best describes the photograph.',
          options: [
            'People are riding bicycles through an office.',
            'Some bicycles have been parked outside a building.',
            'A rack is being carried across the street.',
            'The building is under construction.',
          ],
          correctIndex: 1,
          explanation:
            'The bicycles are stationary in a rack outside the building.',
        },
      ],
    },
    {
      part: 1,
      passageText:
        'PHOTO SCENE: A waiter is placing a plate on a table while two customers are seated in a restaurant.',
      imageUrl: seedAssetUrl('toeic/visuals/restaurant-service.png'),
      audioUrl: null,
      questions: [
        {
          questionNumber: 4,
          text: 'Choose the sentence that best describes the photograph.',
          options: [
            'A waiter is serving food at a table.',
            'A customer is standing behind the waiter.',
            'The restaurant tables are being removed.',
            'The customers are washing dishes.',
          ],
          correctIndex: 0,
          explanation: 'The waiter is placing food on the customers’ table.',
        },
      ],
    },
    {
      part: 1,
      passageText:
        'PHOTO SCENE: A man is standing on a ladder and replacing a ceiling light in a hallway.',
      imageUrl: seedAssetUrl('toeic/visuals/ceiling-light.png'),
      audioUrl: null,
      questions: [
        {
          questionNumber: 5,
          text: 'Choose the sentence that best describes the photograph.',
          options: [
            'Several lights are being packed into boxes.',
            'A man is working on a light fixture.',
            'A man is carrying a ladder outdoors.',
            'The hallway floor is being cleaned.',
          ],
          correctIndex: 1,
          explanation:
            'The man is using a ladder to work on the ceiling light.',
        },
      ],
    },
    {
      part: 1,
      passageText:
        'PHOTO SCENE: Travelers are standing in front of an airport departure board with suitcases beside them.',
      imageUrl: seedAssetUrl('toeic/visuals/departure-board.png'),
      audioUrl: null,
      questions: [
        {
          questionNumber: 6,
          text: 'Choose the sentence that best describes the photograph.',
          options: [
            'Travelers are checking flight information.',
            'Suitcases are being loaded into a car.',
            'The departure board has been taken down.',
            'Passengers are collecting food from a counter.',
          ],
          correctIndex: 0,
          explanation: 'The travelers are looking at the departure board.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: When will the new printer be delivered?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 7,
          text: 'Choose the best response.',
          options: [
            'Sometime Thursday afternoon.',
            'Yes, it prints in color.',
            'On the second floor.',
          ],
          correctIndex: 0,
          explanation:
            "The first response answers a 'when' question with a time.",
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Who is leading the client presentation?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 8,
          text: 'Choose the best response.',
          options: [
            'In Conference Room C.',
            'About forty minutes.',
            'Maria from the sales team.',
          ],
          correctIndex: 2,
          explanation: 'The question asks for a person.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Could you send me the updated price list?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 9,
          text: 'Choose the best response.',
          options: [
            'Sure, I’ll email it this morning.',
            'Near the front entrance.',
            'The prices increased last year.',
          ],
          correctIndex: 0,
          explanation: 'The first choice directly accepts the request.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Why was the workshop postponed?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 10,
          text: 'Choose the best response.',
          options: [
            'Until next Tuesday.',
            'The instructor became ill.',
            'At the training center.',
          ],
          correctIndex: 1,
          explanation: 'The question asks for a reason.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Where should I leave these packages?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 11,
          text: 'Choose the best response.',
          options: [
            'Three large boxes.',
            'Beside the reception desk.',
            'They arrived yesterday.',
          ],
          correctIndex: 1,
          explanation: 'The question asks for a location.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Haven’t you submitted the travel form yet?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 12,
          text: 'Choose the best response.',
          options: [
            'Not yet—I’m waiting for one receipt.',
            'At the airport counter.',
            'The trip was very useful.',
          ],
          correctIndex: 0,
          explanation:
            'The first response appropriately answers a negative yes/no question.',
        },
      ],
    },
    {
      part: 2,
      passageText:
        'AUDIO PROMPT: How often does the maintenance team inspect the elevators?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 13,
          text: 'Choose the best response.',
          options: [
            'For about an hour.',
            'They use the service elevator.',
            'Every six months.',
          ],
          correctIndex: 2,
          explanation: 'The question asks about frequency.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Would you like tea or coffee?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 14,
          text: 'Choose the best response.',
          options: [
            'Yes, I liked it.',
            'At the café downstairs.',
            'Coffee, please.',
          ],
          correctIndex: 2,
          explanation: 'The question offers two choices.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Which report should I review first?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 15,
          text: 'Choose the best response.',
          options: [
            'About fifteen pages.',
            'I reviewed it yesterday.',
            'The quarterly sales report.',
          ],
          correctIndex: 2,
          explanation: 'The question asks which report.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Can we move the meeting to Friday?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 16,
          text: 'Choose the best response.',
          options: [
            'Friday afternoon works for me.',
            'I moved the chairs already.',
            'The meeting lasted an hour.',
          ],
          correctIndex: 0,
          explanation:
            'The first response addresses the proposed schedule change.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: How did you hear about this position?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 17,
          text: 'Choose the best response.',
          options: [
            'It is a full-time position.',
            'I saw the posting on the company website.',
            'The interview room is upstairs.',
          ],
          correctIndex: 1,
          explanation: 'The question asks for the source of information.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: What time does the cafeteria close?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 18,
          text: 'Choose the best response.',
          options: [
            'The soup is very good.',
            'Next to the lobby.',
            'At seven on weekdays.',
          ],
          correctIndex: 2,
          explanation: 'The response gives a closing time.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Why don’t we take the earlier train?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 19,
          text: 'Choose the best response.',
          options: [
            'The station is downtown.',
            'I bought two tickets.',
            'Good idea—it will give us more time.',
          ],
          correctIndex: 2,
          explanation: 'The first response reacts naturally to a suggestion.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Whose laptop is this?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 20,
          text: 'Choose the best response.',
          options: [
            'It is a new model.',
            'On the meeting table.',
            'I think it belongs to Daniel.',
          ],
          correctIndex: 2,
          explanation: 'Whose asks about ownership.',
        },
      ],
    },
    {
      part: 2,
      passageText:
        'AUDIO PROMPT: Do you know whether the invoice has been paid?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 21,
          text: 'Choose the best response.',
          options: [
            'Yes, accounting confirmed it this morning.',
            'The invoice has three pages.',
            'Please use the side entrance.',
          ],
          correctIndex: 0,
          explanation:
            'The first response answers the payment-status question.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: What should we include in the proposal?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 22,
          text: 'Choose the best response.',
          options: [
            'At least five people attended.',
            'It was proposed last month.',
            'A budget estimate and a timeline.',
          ],
          correctIndex: 2,
          explanation: 'The first response identifies content to include.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Didn’t the supplier call you back?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 23,
          text: 'Choose the best response.',
          options: [
            'No, I’m still waiting for a response.',
            'The supplier is in Osaka.',
            'I called from my office.',
          ],
          correctIndex: 0,
          explanation:
            'The first response directly addresses whether a callback occurred.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Where can visitors get a temporary badge?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 24,
          text: 'Choose the best response.',
          options: [
            'Visitors arrived early.',
            'At the security desk in the lobby.',
            'The badge is blue.',
          ],
          correctIndex: 1,
          explanation: 'The question asks where to obtain a badge.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: How many people registered for the seminar?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 25,
          text: 'Choose the best response.',
          options: [
            'It starts at nine.',
            'They registered online.',
            'Just over eighty.',
          ],
          correctIndex: 2,
          explanation: 'The question asks for a quantity.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Would you mind closing the window?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 26,
          text: 'Choose the best response.',
          options: [
            'Not at all—I’ll close it now.',
            'The office is on the fifth floor.',
            'The window was replaced last year.',
          ],
          correctIndex: 0,
          explanation: 'The first response accepts the polite request.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: When did Ms. Park join the company?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 27,
          text: 'Choose the best response.',
          options: [
            'About three years ago.',
            'She works in marketing.',
            'Yes, she joined the meeting.',
          ],
          correctIndex: 0,
          explanation: 'The question asks for a past time.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Why is the parking lot so full today?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 28,
          text: 'Choose the best response.',
          options: [
            'I drove to work.',
            'There’s a conference in the main hall.',
            'Parking is free after six.',
          ],
          correctIndex: 1,
          explanation: 'The response gives a reason.',
        },
      ],
    },
    {
      part: 2,
      passageText:
        'AUDIO PROMPT: Could I borrow your charger for a few minutes?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 29,
          text: 'Choose the best response.',
          options: [
            'The battery lasts eight hours.',
            'Of course—it’s in my desk drawer.',
            'My phone is fully charged.',
          ],
          correctIndex: 1,
          explanation: 'The response agrees and provides helpful information.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Who should approve this expense request?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 30,
          text: 'Choose the best response.',
          options: [
            'Before the end of the month.',
            'Your department manager.',
            'It costs less than expected.',
          ],
          correctIndex: 1,
          explanation: 'The question asks which person should approve it.',
        },
      ],
    },
    {
      part: 2,
      passageText: 'AUDIO PROMPT: Why don’t you take a short break?',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 31,
          text: 'Choose the best response.',
          options: [
            'That’s a good idea. I’ve been working for hours.',
            'The break room is being renovated.',
            'I took the documents upstairs.',
          ],
          correctIndex: 0,
          explanation: 'The first response naturally accepts the suggestion.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: The client moved tomorrow’s meeting from ten to eleven thirty. W: That works, but Conference Room A is booked then. M: I’ll reserve Room C instead.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 32,
          text: 'What changed about the meeting?',
          options: ['The time', 'The date', 'The topic', 'The client'],
          correctIndex: 0,
          explanation: 'The meeting moved from 10:00 to 11:30.',
        },
        {
          questionNumber: 33,
          text: 'What problem does the woman mention?',
          options: [
            'Room A is unavailable',
            'The report is unfinished',
            'The office is closed',
            'The client canceled',
          ],
          correctIndex: 0,
          explanation: 'She says Room A is booked.',
        },
        {
          questionNumber: 34,
          text: 'What will the man probably do?',
          options: [
            'Print a new contract',
            'Cancel the meeting',
            'Reserve Room C',
            'Call a taxi',
          ],
          correctIndex: 2,
          explanation: 'He says he will reserve Room C.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'W: I can’t access the shared budget file. M: I forgot to update the permissions after moving it to the new folder. W: Could you send me the new link once it’s fixed? M: Sure.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 35,
          text: 'What problem does the woman have?',
          options: [
            'She cannot attend a meeting',
            'She forgot the budget total',
            'She lost her laptop',
            'She cannot access a file',
          ],
          correctIndex: 3,
          explanation: 'She cannot access the shared budget file.',
        },
        {
          questionNumber: 36,
          text: 'What did the man forget to do?',
          options: [
            'Update file permissions',
            'Call a supplier',
            'Book a meeting room',
            'Pay an invoice',
          ],
          correctIndex: 0,
          explanation: 'He says he forgot to update permissions.',
        },
        {
          questionNumber: 37,
          text: 'What does the woman request?',
          options: [
            'A new computer',
            'A printed budget',
            'A password reset by phone',
            'A new link',
          ],
          correctIndex: 3,
          explanation: 'She asks him to send the new link.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: Has the supplier confirmed Friday’s delivery? W: Yes, but only 60 chairs will arrive Friday. The remaining 40 will come Monday. M: Then I’ll tell the event team to use the chairs we already have in storage.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 38,
          text: 'What are the speakers discussing?',
          options: [
            'A hotel reservation',
            'A furniture delivery',
            'A training schedule',
            'A software license',
          ],
          correctIndex: 1,
          explanation: 'They discuss delivery of chairs.',
        },
        {
          questionNumber: 39,
          text: 'How many chairs will arrive Monday?',
          options: ['20', '100', '60', '40'],
          correctIndex: 3,
          explanation: 'The woman says the remaining 40 will come Monday.',
        },
        {
          questionNumber: 40,
          text: 'What will the man do?',
          options: [
            'Order 100 more chairs',
            'Use chairs from storage',
            'Move the event to Monday',
            'Cancel the event',
          ],
          correctIndex: 1,
          explanation: 'He plans to use existing chairs from storage.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'W: I’m calling about my order. The tracking page says it was delivered, but I haven’t received it. M: I’m sorry about that. Let me check the delivery photo and contact the courier. W: Thank you. I’ll stay by my phone.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 41,
          text: 'Why is the woman calling?',
          options: [
            'She needs a refund for a class',
            'She wants store hours',
            'A package is missing',
            'She wants to place an order',
          ],
          correctIndex: 2,
          explanation:
            'The tracking says delivered, but she has not received it.',
        },
        {
          questionNumber: 42,
          text: 'What will the man do first?',
          options: [
            'Close the customer account',
            'Send a replacement immediately',
            'Change the order quantity',
            'Check delivery information',
          ],
          correctIndex: 3,
          explanation:
            'He says he will check the delivery photo and contact the courier.',
        },
        {
          questionNumber: 43,
          text: 'What does the woman imply?',
          options: [
            'She expects a follow-up call',
            'She is traveling today',
            'She found the package',
            'She will visit the store',
          ],
          correctIndex: 0,
          explanation:
            'She says she will stay by her phone, implying she expects follow-up.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: Are you attending the software workshop next week? W: I wanted to, but Tuesday is fully booked. There are still seats on Thursday. M: Thursday works for me too. Let’s ask our manager before we register.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 44,
          text: 'Why can’t the woman attend Tuesday?',
          options: [
            'The workshop was canceled',
            'It is fully booked',
            'Her manager refused',
            'She is on vacation',
          ],
          correctIndex: 1,
          explanation: 'She says Tuesday is fully booked.',
        },
        {
          questionNumber: 45,
          text: 'What do the speakers plan to do?',
          options: [
            'Request manager approval',
            'Travel on Tuesday',
            'Cancel their registration',
            'Create a new workshop',
          ],
          correctIndex: 0,
          explanation: 'They will ask their manager before registering.',
        },
        {
          questionNumber: 46,
          text: 'What is suggested about Thursday?',
          options: [
            'Seats are available',
            'The instructor is different',
            'The office is closed',
            'It costs more',
          ],
          correctIndex: 0,
          explanation: 'The woman states seats are still available Thursday.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'W: The hotel sent the final invoice, but breakfast was charged twice. M: I’ll call the billing desk. Do you still have the receipt from checkout? W: Yes, I scanned it and saved it with the travel documents.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 47,
          text: 'What error was found?',
          options: [
            'The room rate was missing',
            'A flight was added',
            'The hotel name was wrong',
            'Breakfast was charged twice',
          ],
          correctIndex: 3,
          explanation: 'The woman says breakfast was charged twice.',
        },
        {
          questionNumber: 48,
          text: 'What does the man plan to do?',
          options: [
            'Call the billing desk',
            'Ask for a new receipt from the airline',
            'Book another hotel',
            'Submit the invoice unchanged',
          ],
          correctIndex: 0,
          explanation: 'He says he will call billing.',
        },
        {
          questionNumber: 49,
          text: 'What does the woman have?',
          options: [
            'A new invoice',
            'A scanned receipt',
            'A breakfast voucher',
            'A hotel key',
          ],
          correctIndex: 1,
          explanation: 'She saved a scanned receipt.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: We need a larger room for Friday’s product demonstration. W: The auditorium is free after one, but the projector there is being repaired. M: I can bring the portable projector from our department.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 50,
          text: 'What do the speakers need?',
          options: [
            'A catering service',
            'A larger room',
            'More customers',
            'A new product',
          ],
          correctIndex: 1,
          explanation: 'The man says they need a larger room.',
        },
        {
          questionNumber: 51,
          text: 'What problem does the woman mention?',
          options: [
            'The event starts before noon',
            'The auditorium is occupied all day',
            'The product is unavailable',
            'The auditorium projector is being repaired',
          ],
          correctIndex: 3,
          explanation: 'The projector is under repair.',
        },
        {
          questionNumber: 52,
          text: 'How does the man propose solving the problem?',
          options: [
            'Bring a portable projector',
            'Cancel the event',
            'Rent a different building',
            'Move the demonstration online',
          ],
          correctIndex: 0,
          explanation: 'He offers to bring a portable projector.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'W: Have you finished the monthly sales charts? M: Almost. I’m waiting for the online-store figures. W: Those were uploaded this morning. Check the folder called September Final. M: Great, then I can finish before lunch.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 53,
          text: 'What is the man preparing?',
          options: [
            'Sales charts',
            'Travel receipts',
            'Job applications',
            'Training materials',
          ],
          correctIndex: 0,
          explanation: 'The woman asks about monthly sales charts.',
        },
        {
          questionNumber: 54,
          text: 'What information was the man waiting for?',
          options: [
            'Employee schedules',
            'Online-store figures',
            'Customer names',
            'Shipping costs',
          ],
          correctIndex: 1,
          explanation: 'He says he was waiting for online-store figures.',
        },
        {
          questionNumber: 55,
          text: 'What will the man probably do next?',
          options: [
            'Call the online store',
            'Check the September Final folder',
            'Upload a job posting',
            'Go to lunch immediately',
          ],
          correctIndex: 1,
          explanation: 'He now knows where the figures are stored.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: The café downstairs is closed for renovation. W: I saw that. There’s a food truck outside the east entrance today. M: Perfect. I only have twenty minutes before my next call.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 56,
          text: 'What is closed?',
          options: [
            'A conference room',
            'The downstairs café',
            'The east entrance',
            'The parking garage',
          ],
          correctIndex: 1,
          explanation: 'The café is closed for renovation.',
        },
        {
          questionNumber: 57,
          text: 'What does the woman suggest indirectly?',
          options: [
            'Skipping lunch',
            'Canceling a call',
            'Buying food from the truck',
            'Ordering office furniture',
          ],
          correctIndex: 2,
          explanation: 'She mentions a food truck as an alternative.',
        },
        {
          questionNumber: 58,
          text: 'Why is the man in a hurry?',
          options: [
            'He has a call soon',
            'He has a train to catch',
            'The food truck is leaving',
            'The building is closing',
          ],
          correctIndex: 0,
          explanation: 'He has twenty minutes before his next call.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'W: I’d like to exchange this jacket. M: Of course. Do you need a different size or color? W: A smaller size, if possible. M: Let me check our stock in the back.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 59,
          text: 'What does the woman want to do?',
          options: [
            'Order online',
            'Return a gift card',
            'Exchange a jacket',
            'Buy shoes',
          ],
          correctIndex: 2,
          explanation: 'She asks to exchange the jacket.',
        },
        {
          questionNumber: 60,
          text: 'What does she want changed?',
          options: ['The price', 'The color', 'The brand', 'The size'],
          correctIndex: 3,
          explanation: 'She asks for a smaller size.',
        },
        {
          questionNumber: 61,
          text: 'What will the man do?',
          options: [
            'Issue a refund immediately',
            'Close the store',
            'Call a tailor',
            'Check inventory',
          ],
          correctIndex: 3,
          explanation: 'He says he will check stock.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: The interview candidate arrived early. W: Great. I’m finishing another call. Could you ask her to complete the visitor form while she waits? M: Sure, and I’ll offer her some water.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 62,
          text: 'Who has arrived?',
          options: [
            'A job candidate',
            'A customer',
            'A delivery driver',
            'A technician',
          ],
          correctIndex: 0,
          explanation: 'They refer to an interview candidate.',
        },
        {
          questionNumber: 63,
          text: 'Why can’t the woman meet her immediately?',
          options: [
            'She is on another call',
            'The room is unavailable',
            'She is out of the office',
            'The candidate is late',
          ],
          correctIndex: 0,
          explanation: 'The woman is finishing another call.',
        },
        {
          questionNumber: 64,
          text: 'What will the man ask the visitor to do?',
          options: [
            'Review a contract',
            'Make a presentation',
            'Complete a form',
            'Call the receptionist',
          ],
          correctIndex: 2,
          explanation: 'He will ask her to complete the visitor form.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'W: The marketing team wants feedback on these two poster designs. M: I prefer the second one because the event date is easier to see. W: I agree, but we should make the website address larger too.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 65,
          text: 'What are the speakers reviewing?',
          options: [
            'Poster designs',
            'Website contracts',
            'Job applications',
            'Sales reports',
          ],
          correctIndex: 0,
          explanation: 'They discuss two poster designs.',
        },
        {
          questionNumber: 66,
          text: 'Why does the man prefer the second design?',
          options: [
            'The website address is larger',
            'It has fewer colors',
            'It is cheaper',
            'The date is clearer',
          ],
          correctIndex: 3,
          explanation: 'He says the event date is easier to see.',
        },
        {
          questionNumber: 67,
          text: 'What change does the woman suggest?',
          options: [
            'Remove the event date',
            'Print fewer posters',
            'Change the event location',
            'Increase the website-address size',
          ],
          correctIndex: 3,
          explanation: 'She says the website address should be larger.',
        },
      ],
    },
    {
      part: 3,
      passageText:
        'M: I booked the 3:15 train, but the client just asked whether we can stay until four. W: There’s a 5:30 train with plenty of seats. M: Okay, I’ll change my ticket and extend the meeting.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 68,
          text: 'What problem does the man have?',
          options: [
            'His train leaves before the client wants the meeting to end',
            'The client cannot attend',
            'His ticket was canceled',
            'There are no later trains',
          ],
          correctIndex: 0,
          explanation:
            'The original train conflicts with the requested meeting time.',
        },
        {
          questionNumber: 69,
          text: 'What information does the woman provide?',
          options: [
            'The station is closed',
            'The client has left',
            'A later train is available',
            'The 3:15 train is delayed',
          ],
          correctIndex: 2,
          explanation: 'She says a 5:30 train has plenty of seats.',
        },
        {
          questionNumber: 70,
          text: 'What will the man do?',
          options: [
            'Change his ticket',
            'Book a hotel',
            'Ask the client to travel',
            'End the meeting at three',
          ],
          correctIndex: 0,
          explanation: 'He says he will change the ticket.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Attention shoppers. The store will close at seven this evening for a scheduled electrical inspection. Customers with items on hold should collect them before six thirty. Regular hours will resume tomorrow morning at nine.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 71,
          text: 'Why will the store close early?',
          options: [
            'For a holiday',
            'For an electrical inspection',
            'For inventory delivery',
            'For a staff party',
          ],
          correctIndex: 1,
          explanation:
            'The announcement cites a scheduled electrical inspection.',
        },
        {
          questionNumber: 72,
          text: 'What should customers do before 6:30?',
          options: [
            'Apply for membership',
            'Return purchases',
            'Use the parking garage',
            'Collect held items',
          ],
          correctIndex: 3,
          explanation: 'Items on hold should be collected before 6:30.',
        },
        {
          questionNumber: 73,
          text: 'When will regular hours resume?',
          options: [
            'Tomorrow at 9 A.M.',
            'Tonight at 7 P.M.',
            'Next week',
            'Tomorrow at 6:30 A.M.',
          ],
          correctIndex: 0,
          explanation: 'The store resumes regular hours at nine tomorrow.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Hello, this is Daniel from Northside Dental Clinic calling for Ms. Lewis. I’m confirming your appointment for Tuesday at 2:45 P.M. If you need to change the time, please call us before noon on Monday so we can offer the appointment to another patient.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 74,
          text: 'Why is Daniel calling?',
          options: [
            'To hire a receptionist',
            'To collect a payment',
            'To advertise a service',
            'To confirm an appointment',
          ],
          correctIndex: 3,
          explanation: 'He explicitly says he is confirming an appointment.',
        },
        {
          questionNumber: 75,
          text: 'When is the appointment?',
          options: [
            'Tuesday at noon',
            'Tuesday at 2:45 P.M.',
            'Monday at noon',
            'Monday at 2:45 P.M.',
          ],
          correctIndex: 1,
          explanation: 'The stated appointment time is Tuesday at 2:45.',
        },
        {
          questionNumber: 76,
          text: 'What should Ms. Lewis do to change the time?',
          options: [
            'Call before noon Monday',
            'Visit the clinic today',
            'Contact another patient',
            'Send a letter Tuesday',
          ],
          correctIndex: 0,
          explanation: 'She must call before noon Monday.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Welcome to the City History Museum. Guided tours begin every hour from ten until four. Today, the second-floor photography gallery is closed while a new exhibition is installed. The café and gift shop remain open as usual on the ground floor.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 77,
          text: 'What is the talk mainly about?',
          options: [
            'A photography competition',
            'A city bus tour',
            'Visitor information at a museum',
            'A café menu',
          ],
          correctIndex: 2,
          explanation: 'The announcement gives museum visitor information.',
        },
        {
          questionNumber: 78,
          text: 'What is closed today?',
          options: [
            'The entire museum',
            'The gift shop',
            'The café',
            'The photography gallery',
          ],
          correctIndex: 3,
          explanation: 'The second-floor photography gallery is closed.',
        },
        {
          questionNumber: 79,
          text: 'Where are the café and gift shop?',
          options: [
            'On the ground floor',
            'On the second floor',
            'Near the parking garage',
            'Outside the museum',
          ],
          correctIndex: 0,
          explanation: 'They are on the ground floor.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Good morning, everyone. Before today’s safety training begins, please sign the attendance sheet at the front of the room. The first session will cover emergency exits, followed by a short break at ten thirty. The equipment demonstration will take place after the break.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 80,
          text: 'What are listeners asked to do first?',
          options: [
            'Take a break',
            'Inspect equipment',
            'Leave the room',
            'Sign an attendance sheet',
          ],
          correctIndex: 3,
          explanation: 'They are asked to sign before training begins.',
        },
        {
          questionNumber: 81,
          text: 'What will the first session cover?',
          options: [
            'Travel safety',
            'Emergency exits',
            'Equipment purchasing',
            'Customer service',
          ],
          correctIndex: 1,
          explanation: 'The first session covers emergency exits.',
        },
        {
          questionNumber: 82,
          text: 'What happens after the break?',
          options: [
            'A building tour',
            'Lunch',
            'An equipment demonstration',
            'Registration',
          ],
          correctIndex: 2,
          explanation: 'The equipment demonstration follows the break.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Due to road construction on Pine Street, Bus 42 will use Oak Avenue between Central Station and City Hall through Friday. The bus will not stop at Pine Street Library during this period. Passengers for the library should get off at Market Square and walk two blocks east.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 83,
          text: 'Why is Bus 42 changing its route?',
          options: [
            'Bad weather',
            'A holiday parade',
            'Road construction',
            'Vehicle repairs',
          ],
          correctIndex: 2,
          explanation: 'The announcement states road construction.',
        },
        {
          questionNumber: 84,
          text: 'Which stop will not be served?',
          options: [
            'City Hall',
            'Central Station',
            'Market Square',
            'Pine Street Library',
          ],
          correctIndex: 3,
          explanation: 'The bus will not stop at the library.',
        },
        {
          questionNumber: 85,
          text: 'What should library passengers do?',
          options: [
            'Get off at Market Square',
            'Walk from Central Station',
            'Take a train',
            'Wait until Friday',
          ],
          correctIndex: 0,
          explanation: 'They should get off at Market Square and walk east.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'This month, our company is introducing a new online expense system. Starting Monday, employees should upload receipts directly through the finance portal instead of emailing them. A short video tutorial is available on the staff website, and the finance team will hold two question-and-answer sessions next week.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 86,
          text: 'What change is being introduced?',
          options: [
            'A new office location',
            'A new salary schedule',
            'A new expense system',
            'A new travel policy',
          ],
          correctIndex: 2,
          explanation: 'The company is introducing an online expense system.',
        },
        {
          questionNumber: 87,
          text: 'What should employees stop doing?',
          options: [
            'Emailing receipts',
            'Using the finance portal',
            'Keeping receipts',
            'Watching tutorials',
          ],
          correctIndex: 0,
          explanation: 'They should upload receipts rather than email them.',
        },
        {
          questionNumber: 88,
          text: 'What support will be available?',
          options: [
            'Free travel',
            'New computers for everyone',
            'Private accounting lessons',
            'A tutorial and Q&A sessions',
          ],
          correctIndex: 3,
          explanation:
            'The talk mentions a video tutorial and two Q&A sessions.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Thank you for choosing Harbor Hotel. Breakfast is served on the first floor from six thirty to ten each morning. Guests who need to leave before six thirty can request a takeaway breakfast at reception by nine P.M. the previous evening. Checkout time is eleven A.M.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 89,
          text: 'Where is breakfast served?',
          options: [
            'On the roof',
            'On the first floor',
            'In guest rooms only',
            'At reception',
          ],
          correctIndex: 1,
          explanation: 'Breakfast is served on the first floor.',
        },
        {
          questionNumber: 90,
          text: 'What should early-departing guests do?',
          options: [
            'Call the restaurant after 6:30',
            'Request takeaway breakfast by 9 P.M.',
            'Check out after noon',
            'Pay an extra room fee',
          ],
          correctIndex: 1,
          explanation:
            'They can request takeaway breakfast at reception by 9 P.M. the previous evening.',
        },
        {
          questionNumber: 91,
          text: 'What time is checkout?',
          options: ['6:30 A.M.', '9 P.M.', '10 A.M.', '11 A.M.'],
          correctIndex: 3,
          explanation: 'Checkout is at eleven A.M.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'The Lakeside Business Expo opens this Friday at the Convention Center. Online registration closes Thursday at noon, but visitors may still register at the entrance for a slightly higher fee. Parking is limited, so organizers recommend using the subway, which stops directly across from the center.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 92,
          text: 'When does online registration close?',
          options: [
            'Friday morning',
            'Thursday at noon',
            'Friday at noon',
            'Thursday evening',
          ],
          correctIndex: 1,
          explanation: 'Online registration closes Thursday at noon.',
        },
        {
          questionNumber: 93,
          text: 'What is true about registering at the entrance?',
          options: [
            'It requires a parking permit',
            'It costs slightly more',
            'It is free',
            'It is not allowed',
          ],
          correctIndex: 1,
          explanation: 'Door registration is available for a higher fee.',
        },
        {
          questionNumber: 94,
          text: 'Why is public transportation recommended?',
          options: [
            'The center has moved',
            'Roads are closed',
            'The subway is free',
            'Parking is limited',
          ],
          correctIndex: 3,
          explanation:
            'Organizers recommend the subway because parking is limited.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Hi, team. I’ve reviewed the first draft of the customer survey. The questions are clear, but the survey is currently too long. Please reduce it from twenty-five questions to about fifteen and add one optional comment box at the end. I’d like the revised version by Wednesday afternoon.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 95,
          text: 'What is the speaker discussing?',
          options: [
            'A sales contract',
            'A customer survey',
            'An employee schedule',
            'A training video',
          ],
          correctIndex: 1,
          explanation: 'The speaker reviewed a customer survey draft.',
        },
        {
          questionNumber: 96,
          text: 'What change is requested?',
          options: [
            'Increase it to 30 questions',
            'Reduce the number of questions',
            'Translate it immediately',
            'Remove all comment fields',
          ],
          correctIndex: 1,
          explanation: 'The speaker asks to reduce 25 questions to about 15.',
        },
        {
          questionNumber: 97,
          text: 'When is the revision wanted?',
          options: [
            'Next month',
            'Today at noon',
            'Wednesday afternoon',
            'Thursday morning',
          ],
          correctIndex: 2,
          explanation: 'The deadline is Wednesday afternoon.',
        },
      ],
    },
    {
      part: 4,
      passageText:
        'Passengers traveling on Flight 605 to Seoul: boarding will begin shortly at Gate 18. Because the flight is full, passengers with large carry-on bags may check them at the gate free of charge. Families traveling with young children will be invited to board first.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 98,
          text: 'Where will passengers board?',
          options: [
            'The ticket counter',
            'Gate 18',
            'The baggage hall',
            'Gate 605',
          ],
          correctIndex: 1,
          explanation: 'Boarding is at Gate 18.',
        },
        {
          questionNumber: 99,
          text: 'Why may passengers check large carry-on bags?',
          options: [
            'The flight is full',
            'The bags are damaged',
            'Security is closed',
            'The airline changed airports',
          ],
          correctIndex: 0,
          explanation: 'The announcement says the flight is full.',
        },
        {
          questionNumber: 100,
          text: 'Who will board first?',
          options: [
            'People in Gate 18',
            'Passengers with large bags',
            'Business travelers',
            'Families with young children',
          ],
          correctIndex: 3,
          explanation:
            'Families with young children receive priority boarding.',
        },
      ],
    },
    {
      part: 5,
      passageText: 'PART 5 — INCOMPLETE SENTENCES',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 101,
          text: 'The conference room is available _____ 3 P.M. today.',
          options: ['during', 'among', 'until', 'beside'],
          correctIndex: 2,
          explanation: 'Until indicates the ending time.',
        },
        {
          questionNumber: 102,
          text: 'Ms. Garcia will _____ the final budget before it is submitted.',
          options: ['review', 'reviewed', 'reviewing', 'reviews'],
          correctIndex: 0,
          explanation: 'After will, use the base verb.',
        },
        {
          questionNumber: 103,
          text: 'The new software is more _____ than the previous version.',
          options: ['reliability', 'reliably', 'reliable', 'rely'],
          correctIndex: 2,
          explanation:
            "A comparative construction with 'more' requires an adjective.",
        },
        {
          questionNumber: 104,
          text: 'Employees must submit travel receipts _____ ten business days.',
          options: ['despite', 'within', 'along', 'between'],
          correctIndex: 1,
          explanation: 'Within means before a period ends.',
        },
        {
          questionNumber: 105,
          text: 'The store hired additional staff _____ customer demand had increased.',
          options: ['unless', 'despite', 'although', 'because'],
          correctIndex: 3,
          explanation: 'Because introduces the reason.',
        },
        {
          questionNumber: 106,
          text: 'All visitors are required _____ a badge while inside the building.',
          options: ['wore', 'wear', 'to wear', 'wearing'],
          correctIndex: 2,
          explanation: 'Be required to + verb is the correct structure.',
        },
        {
          questionNumber: 107,
          text: 'Our sales team performed very _____ during the product launch.',
          options: ['goodness', 'well', 'good', 'betterly'],
          correctIndex: 1,
          explanation: 'Well is the adverb modifying performed.',
        },
        {
          questionNumber: 108,
          text: 'The supplier has worked with us _____ more than five years.',
          options: ['from', 'at', 'for', 'since'],
          correctIndex: 2,
          explanation: 'For is used with a duration.',
        },
        {
          questionNumber: 109,
          text: 'Please contact the help desk if you experience any technical _____.',
          options: [
            'difficult',
            'difficulty to',
            'difficulties',
            'difficultly',
          ],
          correctIndex: 2,
          explanation: "The noun plural fits after 'any technical'.",
        },
        {
          questionNumber: 110,
          text: 'The manager asked whether the report could be completed _____ Friday.',
          options: ['from', 'during', 'since', 'by'],
          correctIndex: 3,
          explanation: 'By Friday expresses a deadline.',
        },
        {
          questionNumber: 111,
          text: 'The office renovation was completed ahead _____ schedule.',
          options: ['of', 'with', 'from', 'at'],
          correctIndex: 0,
          explanation: "The fixed expression is 'ahead of schedule'.",
        },
        {
          questionNumber: 112,
          text: 'Customers who join the loyalty program receive _____ discounts.',
          options: ['additional', 'additionally', 'add', 'addition'],
          correctIndex: 0,
          explanation: 'An adjective modifies discounts.',
        },
        {
          questionNumber: 113,
          text: 'The company plans _____ its distribution network next year.',
          options: [
            'expanding after plans',
            'expanded',
            'expand to',
            'to expand',
          ],
          correctIndex: 3,
          explanation: 'Plan is followed by to-infinitive.',
        },
        {
          questionNumber: 114,
          text: 'Neither the director nor the assistants _____ available this morning.',
          options: ['was', 'are', 'is', 'be'],
          correctIndex: 1,
          explanation:
            'The verb agrees with the nearest plural subject, assistants.',
        },
        {
          questionNumber: 115,
          text: 'The brochure provides _____ information about the warranty.',
          options: ['detailing', 'details', 'detail', 'detailed'],
          correctIndex: 3,
          explanation: 'An adjective modifies information.',
        },
        {
          questionNumber: 116,
          text: 'The shipment was delayed _____ severe weather at the port.',
          options: ['because of', 'although', 'however', 'unless'],
          correctIndex: 0,
          explanation: 'Because of is followed by a noun phrase.',
        },
        {
          questionNumber: 117,
          text: 'We recommend _____ your reservation at least two weeks in advance.',
          options: ['to made', 'make to', 'made', 'making'],
          correctIndex: 3,
          explanation:
            'Recommend is commonly followed by a gerund in this structure.',
        },
        {
          questionNumber: 118,
          text: 'The applicant has _____ experience in customer service.',
          options: ['extend', 'extensively', 'extensive', 'extension'],
          correctIndex: 2,
          explanation: 'An adjective modifies experience.',
        },
        {
          questionNumber: 119,
          text: 'The training session was postponed _____ the instructor became ill.',
          options: ['because', 'despite', 'therefore of', 'however'],
          correctIndex: 0,
          explanation: 'Because introduces a clause giving the reason.',
        },
        {
          questionNumber: 120,
          text: 'Please make sure all forms are completely _____ before submission.',
          options: ['filled out', 'fills', 'filling', 'fill out'],
          correctIndex: 0,
          explanation: "The passive/resultative phrase is 'are filled out'.",
        },
        {
          questionNumber: 121,
          text: 'The new branch is conveniently _____ near the subway station.',
          options: ['location', 'locating', 'locate', 'located'],
          correctIndex: 3,
          explanation: 'The passive adjective form is located.',
        },
        {
          questionNumber: 122,
          text: 'Sales increased _____ 12 percent during the second quarter.',
          options: ['by', 'at', 'for', 'with'],
          correctIndex: 0,
          explanation: 'Increase by expresses the amount of change.',
        },
        {
          questionNumber: 123,
          text: 'The committee will meet again _____ a final decision is needed.',
          options: ['during', 'despite', 'because of', 'if'],
          correctIndex: 3,
          explanation: 'If introduces a condition.',
        },
        {
          questionNumber: 124,
          text: 'The technician will call you as soon as the repair _____ complete.',
          options: ['will be', 'has', 'being', 'is'],
          correctIndex: 3,
          explanation:
            "In a time clause after 'as soon as', use present simple for future meaning.",
        },
        {
          questionNumber: 125,
          text: 'We were pleased with the speed _____ which the issue was resolved.',
          options: ['on', 'from', 'at', 'to'],
          correctIndex: 2,
          explanation: "The idiomatic phrase is 'the speed at which'.",
        },
        {
          questionNumber: 126,
          text: 'The marketing campaign was designed to attract _____ customers.',
          options: ['potential', 'potentiate', 'potentially', 'potentiality'],
          correctIndex: 0,
          explanation: 'An adjective modifies customers.',
        },
        {
          questionNumber: 127,
          text: 'Please notify reception _____ your guest arrives.',
          options: ['when', 'than', 'because of', 'despite'],
          correctIndex: 0,
          explanation: 'When introduces the time clause.',
        },
        {
          questionNumber: 128,
          text: 'The company offers flexible hours in _____ to improve staff retention.',
          options: ['order', 'addition of', 'spite', 'case'],
          correctIndex: 0,
          explanation: "The fixed purpose phrase is 'in order to'.",
        },
        {
          questionNumber: 129,
          text: 'The proposal contains several ideas, one of _____ could reduce operating costs.',
          options: ['which', 'when', 'where', 'who'],
          correctIndex: 0,
          explanation: "Which refers to ideas after 'one of'.",
        },
        {
          questionNumber: 130,
          text: 'Applicants should provide two references _____ can confirm their work experience.',
          options: ['whose company', 'who', 'which place', 'where'],
          correctIndex: 1,
          explanation: 'Who refers to people who can confirm experience.',
        },
      ],
    },
    {
      part: 6,
      passageText:
        'EMAIL\nTo: All Employees\nSubject: Updated Visitor Procedure\nBeginning Monday, all visitors must check in at the main lobby before entering office areas. Reception staff will issue a temporary badge that must remain visible throughout the visit. Employees who are expecting guests should notify reception in advance. This change is intended to improve building security without causing unnecessary delays.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 131,
          text: 'What must visitors do first?',
          options: [
            'Leave identification at home',
            'Check in at the main lobby',
            'Call the finance team',
            'Go directly to an office',
          ],
          correctIndex: 1,
          explanation:
            'The email says all visitors must check in at the main lobby.',
        },
        {
          questionNumber: 132,
          text: 'What will reception staff provide?',
          options: [
            'A temporary badge',
            'A company laptop',
            'A parking refund',
            'A lunch voucher',
          ],
          correctIndex: 0,
          explanation: 'Reception will issue a temporary badge.',
        },
        {
          questionNumber: 133,
          text: 'What are employees asked to do?',
          options: [
            'Notify reception about expected guests',
            'Meet visitors outside the building',
            'Print badges themselves',
            'Cancel Monday meetings',
          ],
          correctIndex: 0,
          explanation:
            'Employees expecting guests should notify reception in advance.',
        },
        {
          questionNumber: 134,
          text: 'Why is the procedure changing?',
          options: [
            'To shorten lunch breaks',
            'To reduce office rent',
            'To improve building security',
            'To promote a new product',
          ],
          correctIndex: 2,
          explanation: 'The last sentence states the security purpose.',
        },
      ],
    },
    {
      part: 6,
      passageText:
        'NOTICE\nThe Riverside Branch will be closed this Saturday while the air-conditioning system is replaced. Online banking and mobile services will operate normally. Customers who need in-person assistance may visit our Central Avenue branch, which will be open from 9 A.M. to 1 P.M. The Riverside Branch will reopen Monday at its regular time.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 135,
          text: 'Why will the Riverside Branch close?',
          options: [
            'For a bank merger',
            'For equipment replacement',
            'For a public holiday',
            'For employee training',
          ],
          correctIndex: 1,
          explanation: 'The air-conditioning system is being replaced.',
        },
        {
          questionNumber: 136,
          text: 'Which service will continue normally?',
          options: [
            'Saturday appointments at Riverside',
            'In-person service at Riverside',
            'Mobile banking',
            'Cashier service at Riverside',
          ],
          correctIndex: 2,
          explanation: 'Online and mobile services remain normal.',
        },
        {
          questionNumber: 137,
          text: 'Where can customers get in-person help Saturday?',
          options: [
            'Riverside Branch',
            'Central Avenue branch',
            'An airport kiosk',
            'The head office only',
          ],
          correctIndex: 1,
          explanation: 'The notice directs customers to Central Avenue.',
        },
        {
          questionNumber: 138,
          text: 'When will Riverside reopen?',
          options: ['Monday', 'Sunday', 'Next month', 'Saturday afternoon'],
          correctIndex: 0,
          explanation: 'The final sentence says Monday.',
        },
      ],
    },
    {
      part: 6,
      passageText:
        'MEMO\nThe product-development team will begin user testing for the new mobile application next week. Twenty volunteers from different departments have agreed to participate. Each session will last approximately forty-five minutes and will include several common tasks, followed by a short interview. The research team will use the feedback to identify usability problems before the public release.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 139,
          text: 'What will begin next week?',
          options: [
            'A sales conference',
            'User testing',
            'A public product launch',
            'Employee interviews for jobs',
          ],
          correctIndex: 1,
          explanation: 'The memo announces user testing.',
        },
        {
          questionNumber: 140,
          text: 'Who will participate?',
          options: [
            'External consultants only',
            'Only customers',
            'Volunteers from different departments',
            'All company employees',
          ],
          correctIndex: 2,
          explanation:
            'Twenty volunteers from various departments will participate.',
        },
        {
          questionNumber: 141,
          text: 'What happens after the common tasks?',
          options: [
            'A lunch break',
            'A written exam',
            'A short interview',
            'A product purchase',
          ],
          correctIndex: 2,
          explanation:
            'Each session includes tasks followed by a short interview.',
        },
        {
          questionNumber: 142,
          text: 'How will the feedback be used?',
          options: [
            'To select a new office',
            'To calculate salaries',
            'To identify usability problems',
            'To advertise the product immediately',
          ],
          correctIndex: 2,
          explanation:
            'Feedback will identify usability issues before release.',
        },
      ],
    },
    {
      part: 6,
      passageText:
        'EMAIL\nDear Conference Participants,\nThank you for registering for the Regional Business Forum. The opening session will begin at 9:30 A.M. in Hall 2, thirty minutes later than originally scheduled. Registration desks will still open at 8:30 A.M. Coffee and light refreshments will be available in the lobby. An updated program is attached to this email.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 143,
          text: 'What has changed?',
          options: [
            'The opening-session time',
            'The registration location',
            'The registration fee',
            'The conference date',
          ],
          correctIndex: 0,
          explanation: 'The opening session is thirty minutes later.',
        },
        {
          questionNumber: 144,
          text: 'When do registration desks open?',
          options: ['8:30 A.M.', '10:00 A.M.', '9:30 A.M.', '9:00 A.M.'],
          correctIndex: 0,
          explanation: 'The email says desks still open at 8:30.',
        },
        {
          questionNumber: 145,
          text: 'Where are refreshments available?',
          options: [
            'Outside the building',
            'In Hall 2 only',
            'At the registration desk',
            'In the lobby',
          ],
          correctIndex: 3,
          explanation: 'Coffee and refreshments are in the lobby.',
        },
        {
          questionNumber: 146,
          text: 'What is attached to the email?',
          options: [
            'A job application',
            'A hotel invoice',
            'A parking ticket',
            'An updated program',
          ],
          correctIndex: 3,
          explanation:
            'The email explicitly says an updated program is attached.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'EMAIL\nFrom: Nina Wong\nTo: Project Team\nSubject: Thursday Review\nPlease upload your final slide revisions to the shared folder by 4 P.M. Wednesday. I will combine the files that evening so that we can use Thursday morning only for rehearsal. If your section includes a video, send me the original file rather than a streaming link because the conference center’s internet connection may be unreliable.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 147,
          text: 'What is the email mainly about?',
          options: [
            'Preparing for a presentation',
            'Ordering new equipment',
            'Planning a vacation',
            'Hiring a project manager',
          ],
          correctIndex: 0,
          explanation: 'The email coordinates slide revisions and rehearsal.',
        },
        {
          questionNumber: 148,
          text: 'When should final revisions be uploaded?',
          options: [
            'By 4 P.M. Wednesday',
            'Before Friday noon',
            'Thursday evening',
            'After the rehearsal',
          ],
          correctIndex: 0,
          explanation: 'The deadline is 4 P.M. Wednesday.',
        },
        {
          questionNumber: 149,
          text: 'Why does Nina request original video files?',
          options: [
            'Streaming links are expensive',
            'The videos are too short',
            'The conference center has no screens',
            'Internet access may be unreliable',
          ],
          correctIndex: 3,
          explanation: 'She mentions unreliable internet.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'NOTICE\nParking Garage Maintenance\nLevels 3 and 4 of the West Garage will be closed from Monday, November 2 through Wednesday, November 4 for resurfacing. Levels 1 and 2 will remain open, but spaces will be limited. Employees are encouraged to use public transportation or the East Garage during this period.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 150,
          text: 'What is being announced?',
          options: [
            'An office relocation',
            'Partial garage closure',
            'Free parking',
            'A new bus route',
          ],
          correctIndex: 1,
          explanation: 'The notice announces closure of garage levels.',
        },
        {
          questionNumber: 151,
          text: 'Which levels remain open?',
          options: [
            'All levels',
            'Levels 3 and 4',
            'Only Level 4',
            'Levels 1 and 2',
          ],
          correctIndex: 3,
          explanation: 'Levels 1 and 2 remain open.',
        },
        {
          questionNumber: 152,
          text: 'What are employees encouraged to do?',
          options: [
            'Move their cars to Level 4',
            'Work only at night',
            'Use alternative transportation or parking',
            'Cancel meetings',
          ],
          correctIndex: 2,
          explanation: 'The notice recommends transit or the East Garage.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'ADVERTISEMENT\nBrightDesk Standing Desk\nAdjust height electronically with the touch of a button. The desk includes two memory settings, a cable-management tray, and a five-year warranty. Orders placed before October 15 receive free standard delivery. Assembly service is available for an additional fee.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 153,
          text: 'What feature does the desk have?',
          options: [
            'Electronic height adjustment',
            'Free assembly',
            'Built-in speakers',
            'A ten-year warranty',
          ],
          correctIndex: 0,
          explanation: 'The desk adjusts electronically.',
        },
        {
          questionNumber: 154,
          text: 'What is free for qualifying orders?',
          options: [
            'Assembly',
            'Extended warranty',
            'An extra chair',
            'Standard delivery',
          ],
          correctIndex: 3,
          explanation: 'Orders before October 15 get free standard delivery.',
        },
        {
          questionNumber: 155,
          text: 'What requires an additional fee?',
          options: [
            'The warranty',
            'Memory settings',
            'Assembly service',
            'Cable management',
          ],
          correctIndex: 2,
          explanation: 'Assembly is available for an extra fee.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'MEMO\nTo: Customer Support Staff\nStarting next month, weekend support hours will extend from 8 A.M.–2 P.M. to 8 A.M.–5 P.M. on Saturdays. Sunday hours will remain unchanged. Supervisors will contact employees this week to update weekend schedules. The change follows customer feedback requesting more afternoon support.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 156,
          text: 'What will change next month?',
          options: [
            'Sunday support hours',
            'Customer-feedback system',
            'Saturday support hours',
            'Office location',
          ],
          correctIndex: 2,
          explanation: 'Saturday hours extend to 5 P.M.',
        },
        {
          questionNumber: 157,
          text: 'Who will contact employees?',
          options: [
            'Customers',
            'Supervisors',
            'Delivery drivers',
            'Accountants',
          ],
          correctIndex: 1,
          explanation: 'Supervisors will update schedules.',
        },
        {
          questionNumber: 158,
          text: 'Why are hours being extended?',
          options: [
            'Sunday service was canceled',
            'Customers requested more afternoon support',
            'The office moved',
            'A new law requires it',
          ],
          correctIndex: 1,
          explanation: 'The memo cites customer feedback.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'EMAIL\nDear Mr. Patel,\nYour order #8042 has been packed and will leave our warehouse this afternoon. Standard delivery to your area normally takes two business days, so the package should arrive by Thursday. Once the courier scans the parcel, you will receive a separate email with a tracking link.\nRegards,\nNorthline Supplies',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 159,
          text: 'What is the purpose of the email?',
          options: [
            'To request payment',
            'To confirm a return',
            'To update a customer about an order',
            'To advertise a product',
          ],
          correctIndex: 2,
          explanation: 'The email gives shipping status.',
        },
        {
          questionNumber: 160,
          text: 'When should the package arrive?',
          options: [
            'This afternoon',
            'Next Monday',
            'By Thursday',
            'In one week',
          ],
          correctIndex: 2,
          explanation:
            'Two business days means by Thursday according to the email.',
        },
        {
          questionNumber: 161,
          text: 'What will happen after the courier scans the parcel?',
          options: [
            'A refund will be issued',
            'The order will be canceled',
            'The warehouse will call',
            'A tracking link will be emailed',
          ],
          correctIndex: 3,
          explanation: 'A separate email with tracking will be sent.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'NOTICE\nCommunity Learning Center — Room Change\nThe Wednesday evening Business English workshop will be held in Room 204 instead of Room 118 this week. The starting time remains 6:30 P.M. Participants should bring the worksheet sent by email on Monday. Anyone who did not receive the worksheet can pick up a printed copy at reception before class.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 162,
          text: 'What has changed about the workshop?',
          options: [
            'Its room',
            'Its instructor',
            'Its starting time',
            'Its day',
          ],
          correctIndex: 0,
          explanation:
            'The notice says the workshop will be in Room 204 instead of Room 118.',
        },
        {
          questionNumber: 163,
          text: 'What should a participant do if the worksheet email did not arrive?',
          options: [
            'Arrive at Room 118',
            'Attend a different workshop',
            'Call the instructor after class',
            'Get a printed copy at reception',
          ],
          correctIndex: 3,
          explanation:
            'The notice instructs participants without the email to collect a printed copy at reception.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'ARTICLE\nLocal Library Opens Digital Skills Lab\nThe Central Library has opened a new lab where residents can attend free workshops on spreadsheet basics, online safety, and digital design. Classes are limited to twelve participants so instructors can provide individual assistance. Registration is required and opens two weeks before each workshop. Library members may also use the lab computers when classes are not in session.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 164,
          text: 'What is the article mainly about?',
          options: [
            'A paid software course',
            'A new digital-skills facility',
            'A library relocation',
            'A book sale',
          ],
          correctIndex: 1,
          explanation: 'The article describes the new lab.',
        },
        {
          questionNumber: 165,
          text: 'Why are classes limited to twelve participants?',
          options: [
            'Because only twelve library members exist',
            'Because workshops last twelve minutes',
            'To allow individual assistance',
            'To reduce registration time',
          ],
          correctIndex: 2,
          explanation: 'The article explicitly states this reason.',
        },
        {
          questionNumber: 166,
          text: 'When can members use lab computers independently?',
          options: [
            'Only on weekends',
            'Only during workshops',
            'When classes are not in session',
            'Before becoming members',
          ],
          correctIndex: 2,
          explanation: 'Members may use them when classes are not in session.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'SCHEDULE\nCommunity Business Center — Wednesday\n9:00–10:00 Starting a Small Business — Room 1\n10:30–11:30 Social Media Basics — Room 3\n12:00–1:00 Lunch Break\n1:30–2:30 Managing Business Costs — Room 2\n3:00–4:30 Networking Workshop — Room 1',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 167,
          text: 'Where is Social Media Basics held?',
          options: ['Room 3', 'Lobby', 'Room 1', 'Room 2'],
          correctIndex: 0,
          explanation: 'The schedule lists Room 3.',
        },
        {
          questionNumber: 168,
          text: 'Which session lasts the longest?',
          options: [
            'Managing Business Costs',
            'Social Media Basics',
            'Networking Workshop',
            'Starting a Small Business',
          ],
          correctIndex: 2,
          explanation: 'Networking runs 90 minutes; the others run 60.',
        },
        {
          questionNumber: 169,
          text: 'What begins at 1:30?',
          options: [
            'Networking Workshop',
            'Lunch Break',
            'Managing Business Costs',
            'Social Media Basics',
          ],
          correctIndex: 2,
          explanation: 'The 1:30 session is Managing Business Costs.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'EMAIL\nFrom: Facilities Team\nSubject: Water Service Interruption\nWater service on floors 6–10 will be unavailable from 7 P.M. to 10 P.M. Friday while a valve is replaced. Employees working late should use restrooms on floors 2–5 during this period. Drinking-water dispensers on all floors will remain available because they use a separate supply.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 170,
          text: 'What will be unavailable?',
          options: [
            'Water service on floors 6–10',
            'All elevators',
            'Drinking-water dispensers',
            'The entire building',
          ],
          correctIndex: 0,
          explanation: 'Water service on floors 6–10 is affected.',
        },
        {
          questionNumber: 171,
          text: 'What should employees working late do?',
          options: [
            'Leave before 5 P.M.',
            'Bring tools',
            'Turn off dispensers',
            'Use restrooms on floors 2–5',
          ],
          correctIndex: 3,
          explanation: 'The email directs them to floors 2–5.',
        },
        {
          questionNumber: 172,
          text: 'Why will dispensers remain available?',
          options: [
            'They are only on floor 1',
            'They use a separate supply',
            'They were replaced recently',
            'The repair ends early',
          ],
          correctIndex: 1,
          explanation: 'The email states they have a separate supply.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'REVIEW\nI recently stayed at the Ocean View Hotel for a three-day conference. The room was clean and quiet, and the front-desk staff handled my early check-in efficiently. The hotel is a ten-minute walk from the convention center, which was convenient. However, the breakfast area became crowded after 8 A.M., so I recommend arriving early if you are in a hurry.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 173,
          text: 'Why did the writer stay at the hotel?',
          options: [
            'To attend a conference',
            'To apply for a job',
            'To visit family',
            'To repair the hotel',
          ],
          correctIndex: 0,
          explanation: 'The writer states it was for a three-day conference.',
        },
        {
          questionNumber: 174,
          text: 'What did the writer like?',
          options: [
            'The long distance to the convention center',
            'The late breakfast',
            'The clean, quiet room and efficient staff',
            'The crowded dining area',
          ],
          correctIndex: 2,
          explanation: 'These positive features are explicitly mentioned.',
        },
        {
          questionNumber: 175,
          text: 'What advice does the writer give?',
          options: [
            'Stay only one night',
            'Avoid the front desk',
            'Take a taxi to the convention center',
            'Eat breakfast early',
          ],
          correctIndex: 3,
          explanation: 'The writer recommends arriving early for breakfast.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'DOCUMENT 1 — EMAIL\nFrom: Carla Ruiz\nTo: Office Team\nSubject: Volunteer Day\nOur company volunteer day is Saturday, June 12 at Riverside Park. Please arrive by 8:30 A.M. We will clean walking paths in the morning and plant flowers after lunch. Gloves and tools will be provided.\n\nDOCUMENT 2 — WEATHER ALERT\nSaturday: Light rain before 10 A.M., then cloudy and dry for the rest of the day. Temperature 18–23°C.\n\nDOCUMENT 3 — MESSAGE\nCarla: Because of the early rain forecast, we will meet at the covered picnic area near the north entrance instead of the open field. The start time is unchanged.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 176,
          text: 'What is the purpose of Carla’s email?',
          options: [
            'To give volunteer-event details',
            'To cancel a company event',
            'To sell gardening tools',
            'To recruit new employees',
          ],
          correctIndex: 0,
          explanation: 'The email provides details for volunteer day.',
        },
        {
          questionNumber: 177,
          text: 'What activity is planned after lunch?',
          options: [
            'Planting flowers',
            'Cleaning walking paths',
            'Driving to another park',
            'Holding a meeting',
          ],
          correctIndex: 0,
          explanation: 'Flower planting is scheduled after lunch.',
        },
        {
          questionNumber: 178,
          text: 'Why was the meeting point changed?',
          options: [
            'The event time changed',
            'Tools are unavailable',
            'Rain is expected early',
            'The park is closed',
          ],
          correctIndex: 2,
          explanation: 'The message responds to the early rain forecast.',
        },
        {
          questionNumber: 179,
          text: 'What has NOT changed?',
          options: [
            'The start time',
            'The meeting location',
            'The covered-area plan',
            'The weather forecast',
          ],
          correctIndex: 0,
          explanation: 'Carla explicitly says the start time is unchanged.',
        },
        {
          questionNumber: 180,
          text: 'What will be provided?',
          options: [
            'Transportation',
            'Breakfast',
            'Gloves and tools',
            'Raincoats',
          ],
          correctIndex: 2,
          explanation:
            'The original email says gloves and tools will be provided.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'DOCUMENT 1 — INVOICE\nMetro Office Supply\nOrder: 60 black folders @ $4 = $240\nDelivery: $20\nTotal: $260\nDelivery date: August 4\n\nDOCUMENT 2 — EMAIL\nDear Ms. Evans, We are temporarily out of black folders. We can deliver blue folders on August 4 at the same price, or black folders on August 8. Please let us know your preference by tomorrow at noon.\n\nDOCUMENT 3 — REPLY\nPlease send the blue folders on August 4. We need them for a training session on August 5, so waiting until the 8th will not work. Thank you.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 181,
          text: 'What was originally ordered?',
          options: [
            '20 binders',
            '40 black folders',
            '60 blue folders',
            '60 black folders',
          ],
          correctIndex: 3,
          explanation: 'The invoice lists 60 black folders.',
        },
        {
          questionNumber: 182,
          text: 'Why did the supplier contact Ms. Evans?',
          options: [
            'The price increased',
            'The order was unpaid',
            'The requested color is unavailable',
            'The address was missing',
          ],
          correctIndex: 2,
          explanation: 'Black folders are temporarily out of stock.',
        },
        {
          questionNumber: 183,
          text: 'What does Ms. Evans choose?',
          options: [
            'Black folders on August 8',
            'Blue folders on August 4',
            'Cancel the order',
            'Reduce the quantity',
          ],
          correctIndex: 1,
          explanation: 'Her reply asks for blue folders on August 4.',
        },
        {
          questionNumber: 184,
          text: 'Why is August 4 important?',
          options: [
            'The office closes August 4',
            'Payment is due August 4',
            'The price changes August 5',
            'The folders are needed for an August 5 training',
          ],
          correctIndex: 3,
          explanation: 'She needs them before the August 5 training.',
        },
        {
          questionNumber: 185,
          text: 'How much is delivery on the invoice?',
          options: ['$240', '$260', '$4', '$20'],
          correctIndex: 3,
          explanation: 'Delivery is listed as $20.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'DOCUMENT 1 — JOB POSTING\nOperations Coordinator\nResponsibilities: schedule deliveries, maintain inventory records, communicate with suppliers. Requirements: two years of administrative experience, strong spreadsheet skills, clear written communication.\n\nDOCUMENT 2 — APPLICATION NOTE\nI have worked for three years as an office administrator at a logistics company. I coordinate weekly deliveries and update inventory spreadsheets. I am available for an interview any afternoon next week except Tuesday. — Jordan Lee\n\nDOCUMENT 3 — HR EMAIL\nJordan, thank you for applying. We would like to invite you to an interview next Thursday at 2 P.M. The interview will be held in our downtown office and should take about 45 minutes.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 186,
          text: 'What is one responsibility of the position?',
          options: [
            'Repairing vehicles',
            'Designing advertisements',
            'Scheduling deliveries',
            'Teaching classes',
          ],
          correctIndex: 2,
          explanation: 'Scheduling deliveries is listed.',
        },
        {
          questionNumber: 187,
          text: 'Why is Jordan likely qualified?',
          options: [
            'Jordan is a software developer',
            'Jordan has no office experience',
            'Jordan can interview only Tuesday',
            'Jordan has relevant logistics administration experience',
          ],
          correctIndex: 3,
          explanation: 'Jordan’s background matches several requirements.',
        },
        {
          questionNumber: 188,
          text: 'When is Jordan invited to interview?',
          options: [
            'Next Tuesday at 2 P.M.',
            'Friday at noon',
            'This Thursday morning',
            'Next Thursday at 2 P.M.',
          ],
          correctIndex: 3,
          explanation: 'The HR email specifies next Thursday at 2.',
        },
        {
          questionNumber: 189,
          text: 'How long should the interview take?',
          options: [
            'All afternoon',
            'About 45 minutes',
            '15 minutes',
            'About 2 hours',
          ],
          correctIndex: 1,
          explanation: 'The HR email says about 45 minutes.',
        },
        {
          questionNumber: 190,
          text: 'Which requirement is supported by Jordan’s note?',
          options: [
            'Spreadsheet skills',
            'Graphic design certification',
            'Vehicle maintenance',
            'Foreign-language teaching',
          ],
          correctIndex: 0,
          explanation: 'Jordan updates inventory spreadsheets.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'DOCUMENT 1 — EVENT PROGRAM\nGreen Business Forum — October 8\n9:00 Opening Keynote — Hall A\n10:30 Sustainable Packaging — Hall B\n12:00 Lunch — Garden Room\n1:30 Energy-Saving Offices — Hall A\n3:00 Supplier Panel — Hall B\n\nDOCUMENT 2 — MESSAGE\nHi Priya, I can attend only in the afternoon. I’m especially interested in reducing electricity use in our new office, but I also need to meet one of our packaging suppliers who is speaking on the final panel. Could we meet for coffee during lunch another day instead? — Marco\n\nDOCUMENT 3 — SPEAKER LIST\nSupplier Panel: H. Tanaka — EcoBox; M. Lewis — North Paper; R. Singh — PackRight',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 191,
          text: 'Which session most directly matches Marco’s office interest?',
          options: [
            'Energy-Saving Offices',
            'Lunch',
            'Opening Keynote',
            'Sustainable Packaging',
          ],
          correctIndex: 0,
          explanation: 'He wants to reduce electricity use in the office.',
        },
        {
          questionNumber: 192,
          text: 'Why can’t Marco meet Priya at lunch?',
          options: [
            'The Garden Room is closed',
            'Lunch was canceled',
            'Priya is a speaker',
            'He can attend only in the afternoon',
          ],
          correctIndex: 3,
          explanation: 'He says he can attend only in the afternoon.',
        },
        {
          questionNumber: 193,
          text: 'Which session will Marco probably also attend?',
          options: [
            'Supplier Panel',
            'Opening Keynote',
            'Sustainable Packaging',
            'Lunch',
          ],
          correctIndex: 0,
          explanation:
            'He needs to meet a supplier speaking on the final panel.',
        },
        {
          questionNumber: 194,
          text: 'Where is the 1:30 session?',
          options: ['Lobby', 'Hall A', 'Garden Room', 'Hall B'],
          correctIndex: 1,
          explanation: 'The program lists Hall A.',
        },
        {
          questionNumber: 195,
          text: 'Who represents EcoBox?',
          options: ['H. Tanaka', 'Marco', 'R. Singh', 'M. Lewis'],
          correctIndex: 0,
          explanation: 'The speaker list pairs H. Tanaka with EcoBox.',
        },
      ],
    },
    {
      part: 7,
      passageText:
        'DOCUMENT 1 — SERVICE NOTICE\nCloudDesk will perform server maintenance from 11 P.M. Saturday to 2 A.M. Sunday. During this time, users may be unable to upload new files, but existing files can still be viewed.\n\nDOCUMENT 2 — CUSTOMER EMAIL\nOur design team has a deadline Sunday morning and plans to upload final artwork around midnight Saturday. Will the maintenance affect us? If so, is there another way to submit files?\n\nDOCUMENT 3 — SUPPORT REPLY\nYes, uploads may be unavailable during the maintenance window. We recommend uploading the artwork before 11 P.M. Saturday. If that is not possible, email the files to urgent@clouddesk.example and our support team will attach them to your project once maintenance ends.',
      imageUrl: null,
      audioUrl: null,
      questions: [
        {
          questionNumber: 196,
          text: 'What service may be unavailable during maintenance?',
          options: [
            'Viewing existing files',
            'Uploading new files',
            'Logging into email',
            'Reading project names',
          ],
          correctIndex: 1,
          explanation: 'The notice says uploads may be unavailable.',
        },
        {
          questionNumber: 197,
          text: 'Why is the customer concerned?',
          options: [
            'They cannot view files now',
            'Existing files were deleted',
            'The team plans to upload during the maintenance window',
            'The deadline is next month',
          ],
          correctIndex: 2,
          explanation: 'Their planned midnight upload overlaps maintenance.',
        },
        {
          questionNumber: 198,
          text: 'What does support recommend first?',
          options: [
            'Call the design team',
            'Delete the project',
            'Upload before 11 P.M. Saturday',
            'Wait until Monday',
          ],
          correctIndex: 2,
          explanation: 'The reply recommends uploading before maintenance.',
        },
        {
          questionNumber: 199,
          text: 'What alternative is offered?',
          options: [
            'Mail a USB drive',
            'Email the files to support',
            'Use a different company',
            'Upload during maintenance repeatedly',
          ],
          correctIndex: 1,
          explanation: 'Support provides an urgent email address.',
        },
        {
          questionNumber: 200,
          text: 'When does maintenance end?',
          options: [
            '2 A.M. Sunday',
            '11 P.M. Sunday',
            'Sunday morning at 11',
            'Midnight Saturday',
          ],
          correctIndex: 0,
          explanation: 'The notice states 2 A.M. Sunday.',
        },
      ],
    },
  ];
  // Normalize Part 6 into the TOEIC text-completion format before validation.
  const standardizedPart6 = [
    {
      passageText:
        'EMAIL\nTo: All Employees\nSubject: Updated Visitor Procedure\nBeginning Monday, all visitors [131] _____ at the main lobby before entering office areas. Reception staff will issue a temporary badge, which must remain [132] _____ throughout the visit. Employees who are expecting guests should notify reception [133] _____ advance. [134] _____.',
      questions: [
        {
          questionNumber: 131,
          text: 'Choose the best option for blank [131].',
          options: [
            'checking in',
            'must check in',
            'checked in',
            'to checking in',
          ],
          correctIndex: 1,
          explanation: 'The modal must expresses the required procedure.',
        },
        {
          questionNumber: 132,
          text: 'Choose the best option for blank [132].',
          options: ['visibility', 'visibly', 'visible', 'vision'],
          correctIndex: 2,
          explanation: 'Remain takes the adjective visible.',
        },
        {
          questionNumber: 133,
          text: 'Choose the best option for blank [133].',
          options: ['in', 'on', 'at', 'with'],
          correctIndex: 0,
          explanation: 'In advance is the fixed expression.',
        },
        {
          questionNumber: 134,
          text: 'Choose the sentence that best completes blank [134].',
          options: [
            'The cafeteria menu is also updated every Monday.',
            'Several departments moved to another building last year.',
            'Visitors may purchase office supplies at reception.',
            'These steps are intended to improve building security without causing unnecessary delays.',
          ],
          correctIndex: 3,
          explanation:
            'The final sentence states the purpose of the procedure.',
        },
      ],
    },
    {
      passageText:
        'NOTICE\nThe Riverside Branch [135] _____ closed this Saturday while the air-conditioning system is replaced. Online banking and mobile services will operate [136] _____. Customers who need in-person assistance [137] _____ our Central Avenue branch, which will be open from 9 A.M. to 1 P.M. [138] _____.',
      questions: [
        {
          questionNumber: 135,
          text: 'Choose the best option for blank [135].',
          options: ['has', 'being', 'will be', 'was been'],
          correctIndex: 2,
          explanation: 'Will be closed announces a future closure.',
        },
        {
          questionNumber: 136,
          text: 'Choose the best option for blank [136].',
          options: ['normal', 'normally', 'normality', 'normalize'],
          correctIndex: 1,
          explanation: 'Normally is the adverb modifying operate.',
        },
        {
          questionNumber: 137,
          text: 'Choose the best option for blank [137].',
          options: ['visiting', 'visited', 'are visit', 'may visit'],
          correctIndex: 3,
          explanation: 'May visit expresses the available alternative.',
        },
        {
          questionNumber: 138,
          text: 'Choose the sentence that best completes blank [138].',
          options: [
            'The Riverside Branch will reopen Monday at its regular time.',
            'Customers should apply for new credit cards before Friday.',
            'The Central Avenue branch was built twenty years ago.',
            'Online banking requires a different password on weekends.',
          ],
          correctIndex: 0,
          explanation: 'The reopening sentence logically closes the notice.',
        },
      ],
    },
    {
      passageText:
        'MEMO\nThe product-development team [139] _____ user testing for the new mobile application next week. Twenty volunteers from different departments [140] _____ to participate. Each session will last approximately forty-five minutes and will include several common tasks, [141] _____ by a short interview. [142] _____.',
      questions: [
        {
          questionNumber: 139,
          text: 'Choose the best option for blank [139].',
          options: ['will begin', 'began', 'has begun yesterday', 'beginning'],
          correctIndex: 0,
          explanation: 'Next week signals the future tense.',
        },
        {
          questionNumber: 140,
          text: 'Choose the best option for blank [140].',
          options: ['has agreeing', 'agree', 'have agreed', 'was agreed'],
          correctIndex: 2,
          explanation: 'The plural subject takes have agreed.',
        },
        {
          questionNumber: 141,
          text: 'Choose the best option for blank [141].',
          options: ['following', 'followed', 'follows', 'to follow'],
          correctIndex: 1,
          explanation: 'Followed by is the correct reduced passive phrase.',
        },
        {
          questionNumber: 142,
          text: 'Choose the sentence that best completes blank [142].',
          options: [
            'The company cafeteria will introduce a new menu next month.',
            'All volunteers must purchase the application before testing it.',
            'The interviews will be used to recruit new full-time employees.',
            'The research team will use the feedback to identify usability problems before the public release.',
          ],
          correctIndex: 3,
          explanation:
            'The final sentence explains the purpose of the feedback.',
        },
      ],
    },
    {
      passageText:
        'EMAIL\nDear Conference Participants,\nThank you for [143] _____ for the Regional Business Forum. The opening session [144] _____ at 9:30 A.M. in Hall 2, thirty minutes later than originally scheduled. Registration desks [145] _____ open at 8:30 A.M., and coffee and light refreshments will be available in the lobby. [146] _____.',
      questions: [
        {
          questionNumber: 143,
          text: 'Choose the best option for blank [143].',
          options: ['register', 'registering', 'registered', 'registration'],
          correctIndex: 1,
          explanation: 'Thank you for is followed by a gerund.',
        },
        {
          questionNumber: 144,
          text: 'Choose the best option for blank [144].',
          options: ['begin', 'has beginning', 'was begin', 'will begin'],
          correctIndex: 3,
          explanation: 'Will begin announces the scheduled event.',
        },
        {
          questionNumber: 145,
          text: 'Choose the best option for blank [145].',
          options: ['will still', 'still were', 'have still', 'still being'],
          correctIndex: 0,
          explanation:
            'Will still open indicates the unchanged registration time.',
        },
        {
          questionNumber: 146,
          text: 'Choose the sentence that best completes blank [146].',
          options: [
            'The forum was canceled because no one registered.',
            'The lobby is unavailable for the entire day.',
            'Please review the updated program attached to this email before you arrive.',
            'Participants should send their hotel invoices to the speaker.',
          ],
          correctIndex: 2,
          explanation:
            'The attached-program sentence naturally closes the email.',
        },
      ],
    },
  ];
  let standardizedPart6Index = 0;
  for (const group of toeicFullMockGroups) {
    if (group.part !== 6) continue;
    const replacement = standardizedPart6[standardizedPart6Index++];
    group.passageText = replacement.passageText;
    group.questions = replacement.questions;
  }
  // Keep the seeded L&R paper aligned with the current 200-question TOEIC structure.
  const expectedToeicPartQuestionCounts: Record<number, number> = {
    1: 6,
    2: 25,
    3: 39,
    4: 30,
    5: 30,
    6: 16,
    7: 54,
  };
  const expectedToeicPartGroupCounts: Record<number, number> = {
    1: 6,
    2: 25,
    3: 13,
    4: 10,
    5: 1,
    6: 4,
    7: 15,
  };
  const allToeicQuestions = toeicFullMockGroups.flatMap((group) =>
    group.questions.map((question) => ({ ...question, part: group.part })),
  );
  if (allToeicQuestions.length !== 200) {
    throw new Error(
      `TOEIC seed invalid: expected 200 L&R questions, got ${allToeicQuestions.length}.`,
    );
  }
  const questionNumbers = allToeicQuestions.map(
    (question) => question.questionNumber,
  );
  if (
    new Set(questionNumbers).size !== 200 ||
    questionNumbers.some((number) => number < 1 || number > 200)
  ) {
    throw new Error(
      'TOEIC seed invalid: question numbers must cover 1-200 exactly.',
    );
  }
  for (let part = 1; part <= 7; part += 1) {
    const groups = toeicFullMockGroups.filter((group) => group.part === part);
    const questionCount = groups.reduce(
      (sum, group) => sum + group.questions.length,
      0,
    );
    if (groups.length !== expectedToeicPartGroupCounts[part]) {
      throw new Error(
        `TOEIC seed invalid: Part ${part} expected ${expectedToeicPartGroupCounts[part]} groups, got ${groups.length}.`,
      );
    }
    if (questionCount !== expectedToeicPartQuestionCounts[part]) {
      throw new Error(
        `TOEIC seed invalid: Part ${part} expected ${expectedToeicPartQuestionCounts[part]} questions, got ${questionCount}.`,
      );
    }
  }
  if (
    allToeicQuestions.some(
      (question) =>
        question.correctIndex < 0 ||
        question.correctIndex >= question.options.length ||
        (question.part === 2
          ? question.options.length !== 3
          : question.options.length !== 4),
    )
  ) {
    throw new Error(
      'TOEIC seed invalid: answer options or correctIndex do not match the part format.',
    );
  }
  const part3Groups = toeicFullMockGroups.filter((group) => group.part === 3);
  const part4Groups = toeicFullMockGroups.filter((group) => group.part === 4);
  const part6Groups = toeicFullMockGroups.filter((group) => group.part === 6);
  const part7Groups = toeicFullMockGroups.filter((group) => group.part === 7);
  if (
    part3Groups.some((group) => group.questions.length !== 3) ||
    part4Groups.some((group) => group.questions.length !== 3) ||
    part6Groups.some(
      (group) =>
        group.questions.length !== 4 || !group.passageText?.includes('_____'),
    )
  ) {
    throw new Error(
      'TOEIC seed invalid: Part 3/4/6 group structure is inconsistent.',
    );
  }
  const part7SingleGroups = part7Groups.filter(
    (group) => !group.passageText?.startsWith('DOCUMENT 1'),
  );
  const part7MultipleGroups = part7Groups.filter((group) =>
    group.passageText?.startsWith('DOCUMENT 1'),
  );
  const part7SingleQuestions = part7SingleGroups.reduce(
    (sum, group) => sum + group.questions.length,
    0,
  );
  const part7MultipleQuestions = part7MultipleGroups.reduce(
    (sum, group) => sum + group.questions.length,
    0,
  );
  if (
    part7SingleGroups.length !== 10 ||
    part7SingleQuestions !== 29 ||
    part7MultipleGroups.length !== 5 ||
    part7MultipleQuestions !== 25
  ) {
    throw new Error(
      `TOEIC seed invalid: Part 7 expected 10 single texts/29 questions and 5 multiple-passage sets/25 questions; got ${part7SingleGroups.length}/${part7SingleQuestions} and ${part7MultipleGroups.length}/${part7MultipleQuestions}.`,
    );
  }
  let toeicGroupId = 1;
  for (const groupData of toeicFullMockGroups) {
    const group = await prisma.toeicQuestionGroup.create({
      data: {
        id: toeicGroupId,
        examId: toeicExam.id,
        part: groupData.part,
        passageText: groupData.passageText,
        imageUrl: groupData.imageUrl ?? undefined,
        audioUrl: groupData.audioUrl ?? undefined,
        groupOrder: toeicGroupId,
      },
    });
    for (const item of groupData.questions) {
      await prisma.toeicQuestion.create({
        data: {
          id: item.questionNumber,
          groupId: group.id,
          questionNumber: item.questionNumber,
          text: item.text,
          options: item.options,
          correctIndex: item.correctIndex,
          explanation: item.explanation,
        },
      });
    }
    toeicGroupId += 1;
  }

  const toeicPartPractice = await prisma.toeicExamSet.upsert({
    where: { id: 2 },
    update: {
      title: 'TOEIC Practice by Part — Part 1–7',
      description:
        'Ngân hàng luyện theo Part dùng các nhóm đại diện từ đề thi chuẩn để luyện dạng bài.',
      type: ExamType.PRACTICE_BY_PART,
      difficulty: 'medium',
      createdBy: admin.id,
    },
    create: {
      id: 2,
      title: 'TOEIC Practice by Part — Part 1–7',
      description:
        'Ngân hàng luyện theo Part dùng các nhóm đại diện từ đề thi chuẩn để luyện dạng bài.',
      type: ExamType.PRACTICE_BY_PART,
      difficulty: 'medium',
      createdBy: admin.id,
    },
  });
  await prisma.toeicQuestionGroup.deleteMany({
    where: { examId: toeicPartPractice.id },
  });
  const representativeGroups = [
    toeicFullMockGroups.find((g) => g.part === 1)!,
    toeicFullMockGroups.find((g) => g.part === 2)!,
    toeicFullMockGroups.find((g) => g.part === 3)!,
    toeicFullMockGroups.find((g) => g.part === 4)!,
    toeicFullMockGroups.find((g) => g.part === 5)!,
    toeicFullMockGroups.find((g) => g.part === 6)!,
    toeicFullMockGroups.find((g) => g.part === 7)!,
  ];
  let practiceGroupId = 1001;
  let practiceQuestionId = 1001;
  for (const sourceGroup of representativeGroups) {
    const group = await prisma.toeicQuestionGroup.create({
      data: {
        id: practiceGroupId,
        examId: toeicPartPractice.id,
        part: sourceGroup.part,
        passageText: sourceGroup.passageText,
        groupOrder: sourceGroup.part,
      },
    });
    const sourceQuestions =
      sourceGroup.part === 5
        ? sourceGroup.questions.slice(0, 10)
        : sourceGroup.questions;
    for (const item of sourceQuestions) {
      await prisma.toeicQuestion.create({
        data: {
          id: practiceQuestionId,
          groupId: group.id,
          questionNumber: practiceQuestionId,
          text: item.text,
          options: item.options,
          correctIndex: item.correctIndex,
          explanation: item.explanation,
        },
      });
      practiceQuestionId += 1;
    }
    practiceGroupId += 1;
  }

  // Seed one internally consistent completed L&R attempt. A perfect raw response can safely use
  // the official maximum section scales (495 + 495 = 990); we intentionally avoid inventing
  // non-perfect raw-to-scaled conversions because TOEIC operational forms are equated.
  await prisma.toeicAttempt.deleteMany({
    where: {
      examId: toeicExam.id,
      userId: { in: students.slice(0, 4).map((student) => student.id) },
    },
  });
  const perfectToeicAttempt = await prisma.toeicAttempt.create({
    data: {
      userId: students[0].id,
      examId: toeicExam.id,
      mode: AttemptMode.FULL_TEST,
      listeningScore: 495,
      readingScore: 495,
      totalScore: 990,
      submittedAt: new Date('2026-09-08T10:00:00.000Z'),
      timeRemaining: 0,
    },
  });
  await prisma.toeicAttemptAnswer.createMany({
    data: toeicFullMockGroups.flatMap((group) =>
      group.questions.map((question) => ({
        attemptId: perfectToeicAttempt.id,
        questionId: question.questionNumber,
        selectedIndex: question.correctIndex,
      })),
    ),
  });

  // TOEIC catalog quizzes for /quizzes/toeic-papers
  await prisma.quiz.upsert({
    where: { id: 21 },
    update: {
      title: 'TOEIC 2 kỹ năng — Đề thi chuẩn Listening & Reading 01',
      description:
        'Đề thi thử TOEIC 2 kỹ năng Listening (100 câu / 45 phút) và Reading (100 câu / 75 phút) chuẩn cấu trúc 200 câu.',
      type: QuizType.TOEIC,
      courseId: courses[2].id,
      timeLimit: 120,
      bilingualContent: {
        examFormat: 'TWO_SKILL',
        skillLabel: '2 kỹ năng',
        examSetId: toeicExam.id,
        durationMinutes: 120,
        listeningMinutes: 45,
        readingMinutes: 75,
        listeningQuestions: 100,
        readingQuestions: 100,
        totalQuestions: 200,
        sections: ['LISTENING', 'READING'],
        note: 'Đề thi chuẩn TOEIC Listening & Reading 200 câu từ ToeicExamSet 01.',
      },
    },
    create: {
      id: 21,
      title: 'TOEIC 2 kỹ năng — Đề thi chuẩn Listening & Reading 01',
      description:
        'Đề thi thử TOEIC 2 kỹ năng Listening (100 câu / 45 phút) và Reading (100 câu / 75 phút) chuẩn cấu trúc 200 câu.',
      type: QuizType.TOEIC,
      courseId: courses[2].id,
      timeLimit: 120,
      bilingualContent: {
        examFormat: 'TWO_SKILL',
        skillLabel: '2 kỹ năng',
        examSetId: toeicExam.id,
        durationMinutes: 120,
        listeningMinutes: 45,
        readingMinutes: 75,
        listeningQuestions: 100,
        readingQuestions: 100,
        totalQuestions: 200,
        sections: ['LISTENING', 'READING'],
        note: 'Đề thi chuẩn TOEIC Listening & Reading 200 câu từ ToeicExamSet 01.',
      },
    },
  });

  await prisma.quiz.upsert({
    where: { id: 22 },
    update: {
      title: 'TOEIC 4 kỹ năng — Full Skills Comprehensive Bundle 01',
      description:
        'Gói đề thi tổng hợp TOEIC 4 kỹ năng: Listening & Reading (200 câu) kết hợp Speaking (11 câu) & Writing (8 câu).',
      type: QuizType.TOEIC,
      courseId: courses[5].id,
      timeLimit: 200,
      bilingualContent: {
        examFormat: 'FOUR_SKILL',
        skillLabel: '4 kỹ năng',
        isBundle: true,
        listeningReadingExamSetId: toeicExam.id,
        speakingWritingQuizId: toeicSpeakingWritingQuiz.id,
        durationMinutes: 200,
        totalQuestions: 219,
        listeningQuestions: 100,
        readingQuestions: 100,
        speakingQuestions: 11,
        writingQuestions: 8,
        sections: ['LISTENING', 'READING', 'SPEAKING', 'WRITING'],
        note: 'Gói đề thi tổng hợp TOEIC 4 kỹ năng liên kết ToeicExamSet 01 (L&R 200 câu) và Quiz 20 (Speaking & Writing 19 câu).',
      },
    },
    create: {
      id: 22,
      title: 'TOEIC 4 kỹ năng — Full Skills Comprehensive Bundle 01',
      description:
        'Gói đề thi tổng hợp TOEIC 4 kỹ năng: Listening & Reading (200 câu) kết hợp Speaking (11 câu) & Writing (8 câu).',
      type: QuizType.TOEIC,
      courseId: courses[5].id,
      timeLimit: 200,
      bilingualContent: {
        examFormat: 'FOUR_SKILL',
        skillLabel: '4 kỹ năng',
        isBundle: true,
        listeningReadingExamSetId: toeicExam.id,
        speakingWritingQuizId: toeicSpeakingWritingQuiz.id,
        durationMinutes: 200,
        totalQuestions: 219,
        listeningQuestions: 100,
        readingQuestions: 100,
        speakingQuestions: 11,
        writingQuestions: 8,
        sections: ['LISTENING', 'READING', 'SPEAKING', 'WRITING'],
        note: 'Gói đề thi tổng hợp TOEIC 4 kỹ năng liên kết ToeicExamSet 01 (L&R 200 câu) và Quiz 20 (Speaking & Writing 19 câu).',
      },
    },
  });

  // 4-skill TOEIC in BreadTrans is modeled as the L&R full mock above plus the 11-question Speaking / 8-question Writing generic Quiz seeded earlier.

  const quests: Array<[string, string, string, number, number, number]> = [
    ['Học 10 từ vựng', 'Học từ mới trong Flashcard', 'LEARN_VOCAB', 10, 15, 5],
    [
      'Làm 1 bài luyện nghe',
      'Hoàn thành một bài nghe',
      'COMPLETE_QUIZ',
      1,
      20,
      8,
    ],
    [
      'Luyện Speaking',
      'Nộp một bài nói để nhận phản hồi',
      'DO_SPEAKING',
      1,
      25,
      10,
    ],
    ['Hoàn thành bài học', 'Xem xong một lesson', 'COMPLETE_LESSON', 1, 20, 8],
  ];
  for (let index = 0; index < quests.length; index += 1) {
    const quest = await prisma.dailyQuest.upsert({
      where: { id: index + 1 },
      update: {
        title: quests[index][0],
        description: quests[index][1],
        type: quests[index][2],
        targetValue: quests[index][3],
        rewardXP: quests[index][4],
        rewardBanh: quests[index][5],
      },
      create: {
        id: index + 1,
        title: quests[index][0],
        description: quests[index][1],
        type: quests[index][2],
        targetValue: quests[index][3],
        rewardXP: quests[index][4],
        rewardBanh: quests[index][5],
      },
    });
    await prisma.userQuestProgress.upsert({
      where: {
        userId_questId_dateKey: {
          userId: students[0].id,
          questId: quest.id,
          dateKey: '2026-09-08',
        },
      },
      update: { currentValue: index === 0 ? 6 : 0 },
      create: {
        userId: students[0].id,
        questId: quest.id,
        dateKey: '2026-09-08',
        currentValue: index === 0 ? 6 : 0,
      },
    });
  }

  interface SeedMarketProduct {
    id: number;
    slug: string;
    name: string;
    description: string;
    category: string;
    rarity: string;
    price: number;
    imageUrl: string;
    stock: number;
    order: number;
  }

  const marketProducts: SeedMarketProduct[] = [
    {
      id: 1,
      slug: 'badge-star',
      name: 'Huy hiệu Ngôi Sao',
      description:
        'Huy hiệu Ngôi Sao danh giá dành cho học viên tích cực hoàn thành bài học.',
      category: 'BADGE',
      rarity: 'COMMON',
      price: 100,
      imageUrl: '/images/market/badge-star.svg',
      stock: 100,
      order: 1,
    },
    {
      id: 2,
      slug: 'frame-orange',
      name: 'Khung avatar Cam',
      description:
        'Khung avatar viền Cam năng động thể hiện phong cách BreadTrans.',
      category: 'AVATAR_FRAME',
      rarity: 'RARE',
      price: 180,
      imageUrl: '/images/market/frame-orange.svg',
      stock: 100,
      order: 2,
    },
    {
      id: 3,
      slug: 'streak-freeze',
      name: 'Vé bảo vệ chuỗi học (Streak Freeze)',
      description:
        'Tự động bảo vệ chuỗi ngày học liên tục nếu bạn bận rộn bỏ lỡ 1 ngày.',
      category: 'BOOST',
      rarity: 'RARE',
      price: 250,
      imageUrl: '/images/market/streak-freeze.svg',
      stock: 100,
      order: 3,
    },
    {
      id: 4,
      slug: 'pet-bun',
      name: 'Pet Bun đồng hành',
      description:
        'Thú cưng Bun phiên bản đặc biệt tăng thêm động lực học mỗi ngày.',
      category: 'BOOST',
      rarity: 'EPIC',
      price: 500,
      imageUrl: '/images/market/pet-bun.svg',
      stock: 100,
      order: 4,
    },
    {
      id: 5,
      slug: 'double-bread',
      name: 'Thẻ nhân đôi Bánh Mì (24h Boost)',
      description:
        'Nhận gấp đôi số lượng Bánh Mì thưởng khi luyện tập và làm bài kiểm tra.',
      category: 'BOOST',
      rarity: 'EPIC',
      price: 200,
      imageUrl: '/images/market/double-bread.svg',
      stock: 100,
      order: 5,
    },
    {
      id: 6,
      slug: 'badge-master',
      name: 'Huy hiệu Bậc Thầy Từ Vựng',
      description:
        'Huy hiệu vinh danh học viên chuyên cần vượt mốc học 100 từ vựng.',
      category: 'BADGE',
      rarity: 'COMMON',
      price: 150,
      imageUrl: '/images/market/badge-master.svg',
      stock: 100,
      order: 6,
    },
    {
      id: 7,
      slug: 'frame-crown',
      name: 'Khung avatar Vương Miện Quán Quân',
      description:
        'Khung avatar hoàng kim thể hiện vị thế dẫn đầu bảng xếp hạng.',
      category: 'AVATAR_FRAME',
      rarity: 'LEGENDARY',
      price: 450,
      imageUrl: '/images/market/frame-crown.svg',
      stock: 50,
      order: 7,
    },
    {
      id: 8,
      slug: 'frame-cyber',
      name: 'Khung avatar Cyber Tech',
      description:
        'Khung avatar phong cách công nghệ sắc sảo dành cho học viên hiện đại.',
      category: 'AVATAR_FRAME',
      rarity: 'RARE',
      price: 350,
      imageUrl: '/images/market/frame-cyber.svg',
      stock: 60,
      order: 8,
    },
    {
      id: 9,
      slug: 'gift-notebook',
      name: 'Sổ tay từ vựng BreadTrans',
      description:
        'Sổ tay ghi chú từ vựng bìa cứng chất lượng cao gửi về tận nhà.',
      category: 'PHYSICAL',
      rarity: 'EPIC',
      price: 1200,
      imageUrl: '/images/market/gift-notebook.svg',
      stock: 30,
      order: 9,
    },
    {
      id: 10,
      slug: 'gift-voucher',
      name: 'Voucher đồ uống Phúc Long 30K',
      description:
        'Đổi mã E-Voucher thưởng đồ uống Phúc Long xua tan căng thẳng sau giờ học.',
      category: 'PHYSICAL',
      rarity: 'LEGENDARY',
      price: 2000,
      imageUrl: '/images/market/gift-voucher.svg',
      stock: 20,
      order: 10,
    },
    {
      id: 11,
      slug: 'gift-bottle',
      name: 'Bình giữ nhiệt BreadTrans 500ml',
      description:
        'Bình giữ nhiệt inox 304 cao cấp giữ nhiệt 12 giờ gửi quà tận nhà.',
      category: 'PHYSICAL',
      rarity: 'EPIC',
      price: 3500,
      imageUrl: '/images/market/gift-bottle.svg',
      stock: 15,
      order: 11,
    },
    {
      id: 12,
      slug: 'gift-plush',
      name: 'Gấu bông Bánh Mì linh vật',
      description:
        'Gấu bông linh vật BreadTrans siêu êm ái độc quyền gửi về tận nơi.',
      category: 'PHYSICAL',
      rarity: 'LEGENDARY',
      price: 4500,
      imageUrl: '/images/market/gift-plush.svg',
      stock: 10,
      order: 12,
    },
  ];

  for (const product of marketProducts) {
    await prisma.marketProduct.upsert({
      where: { id: product.id },
      update: {
        slug: product.slug,
        name: product.name,
        description: product.description,
        category: product.category,
        rarity: product.rarity,
        price: product.price,
        imageUrl: product.imageUrl,
        stock: product.stock,
        order: product.order,
        isActive: true,
      },
      create: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        category: product.category,
        rarity: product.rarity,
        price: product.price,
        imageUrl: product.imageUrl,
        stock: product.stock,
        order: product.order,
        isActive: true,
      },
    });
  }
  await prisma.currencyTransaction.upsert({
    where: { id: 600 },
    update: {
      studentId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      userId: students[0].id,
      userName: 'student1@breadtrans.com',
      userRole: 'STUDENT',
      amount: 25,
      reason: 'Hoàn thành bài học',
      type: 'add',
    },
    create: {
      id: 600,
      studentId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      userId: students[0].id,
      userName: 'student1@breadtrans.com',
      userRole: 'STUDENT',
      amount: 25,
      reason: 'Hoàn thành bài học',
      type: 'add',
    },
  });
  await prisma.marketOrder.upsert({
    where: { id: 601 },
    update: {
      userId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      items: [{ productId: 1, quantity: 1 }],
      totalK: 0,
      totalBanh: 100,
      status: 'approved',
      currencyTxId: 600,
    },
    create: {
      id: 601,
      userId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      items: [{ productId: 1, quantity: 1 }],
      totalK: 0,
      totalBanh: 100,
      status: 'approved',
      currencyTxId: 600,
      paidAtCheckout: true,
      balanceAtCheckout: 125,
    },
  });
  await prisma.gameBattle.upsert({
    where: { roomId: 'seed-room-1' },
    update: {
      gameId: 'vocab-duel',
      p1Id: students[0].id,
      p2Id: students[1].id,
      stake: 10,
      status: 'settled',
      winnerRole: 'p1',
      winnerUserId: students[0].id,
      settledWinnerRole: 'p1',
      settledAt: new Date(),
    },
    create: {
      roomId: 'seed-room-1',
      gameId: 'vocab-duel',
      p1Id: students[0].id,
      p2Id: students[1].id,
      stake: 10,
      status: 'settled',
      winnerRole: 'p1',
      winnerUserId: students[0].id,
      settledWinnerRole: 'p1',
      settledAt: new Date(),
      escrowedAt: new Date(),
    },
  });

  await prisma.gameSettings.upsert({
    where: { gameId: 'flappy-bird' },
    update: { config: { enabled: true, rewardPerPoint: 1 } },
    create: {
      gameId: 'flappy-bird',
      config: { enabled: true, rewardPerPoint: 1 },
    },
  });
  await prisma.gameSettings.upsert({
    where: { gameId: 'shell-game' },
    update: { config: { enabled: true, maxReward: 50 } },
    create: { gameId: 'shell-game', config: { enabled: true, maxReward: 50 } },
  });
  for (let index = 0; index < 4; index += 1) {
    await prisma.gamePlay.upsert({
      where: { playToken: `seed-play-${index + 1}` },
      update: {
        userId: students[index].id,
        gameId: 'flappy-bird',
        status: 'finished',
        reward: 10 + index,
      },
      create: {
        playToken: `seed-play-${index + 1}`,
        userId: students[index].id,
        gameId: 'flappy-bird',
        status: 'finished',
        reward: 10 + index,
        result: { score: 100 + index * 25 },
      },
    });
  }

  for (const student of students.slice(0, 4)) {
    await prisma.watchTracking.upsert({
      where: { userId: student.id },
      update: {
        items: {
          '/seed/toeic-foundation-lesson-1.mp4': {
            played: 0.35,
            completed: false,
          },
        },
      },
      create: {
        userId: student.id,
        items: {
          '/seed/toeic-foundation-lesson-1.mp4': {
            played: 0.35,
            completed: false,
          },
        },
      },
    });
    await prisma.userBookProgress.upsert({
      where: {
        userId_bookId: { userId: student.id, bookId: 'toeic-foundation' },
      },
      update: {
        completedLessons: [1, 2],
        lessons: {
          '1': { progress: 1 },
          '2': { progress: 1 },
          '3': { progress: 0.35 },
        },
      },
      create: {
        userId: student.id,
        bookId: 'toeic-foundation',
        completedLessons: [1, 2],
        lessons: {
          '1': { progress: 1 },
          '2': { progress: 1 },
          '3': { progress: 0.35 },
        },
      },
    });
    await prisma.aiUsage.upsert({
      where: { userId_weekKey: { userId: student.id, weekKey: '2026-W37' } },
      update: { count: 2 },
      create: { userId: student.id, weekKey: '2026-W37', count: 2 },
    });
  }
  // Runtime-only Speaking retry and PushSubscription records are intentionally not seeded.
  // They require real R2 audio / browser push credentials and should be created by real user activity.
  await prisma.contentTopic.upsert({
    where: { topicId: 'seed-movie-school' },
    update: {
      category: 'movie',
      title: 'School Conversations',
      order: 1,
      exercises: [
        {
          id: 1,
          question: 'What is the speaker preparing for?',
          options: [
            'A presentation',
            'A holiday',
            'A football match',
            'A birthday party',
          ],
          correctIndex: 0,
          explanation:
            'The listening passage describes preparation for a presentation.',
        },
        {
          id: 2,
          question: 'Choose the best meaning of “practice every day”.',
          options: [
            'Luyện tập hằng ngày',
            'Đi học muộn',
            'Mua một cuốn sách',
            'Gọi điện cho bạn',
          ],
          correctIndex: 0,
          explanation: 'Practice every day means luyện tập hằng ngày.',
        },
      ],
    },
    create: {
      topicId: 'seed-movie-school',
      category: 'movie',
      title: 'School Conversations',
      order: 1,
      exercises: [
        {
          id: 1,
          question: 'What is the speaker preparing for?',
          options: [
            'A presentation',
            'A holiday',
            'A football match',
            'A birthday party',
          ],
          correctIndex: 0,
          explanation:
            'The listening passage describes preparation for a presentation.',
        },
        {
          id: 2,
          question: 'Choose the best meaning of “practice every day”.',
          options: [
            'Luyện tập hằng ngày',
            'Đi học muộn',
            'Mua một cuốn sách',
            'Gọi điện cho bạn',
          ],
          correctIndex: 0,
          explanation: 'Practice every day means luyện tập hằng ngày.',
        },
      ],
    },
  });
  await prisma.contentTopic.upsert({
    where: { topicId: 'seed-music-daily' },
    update: {
      category: 'music',
      title: 'Daily English Songs',
      order: 2,
      exercises: [
        {
          id: 1,
          question:
            'Which word best completes: “I listen to music ___ the bus.”',
          options: ['on', 'at', 'by', 'from'],
          correctIndex: 0,
          explanation: 'We say on the bus.',
        },
        {
          id: 2,
          question: 'What does “catchy tune” mean?',
          options: [
            'Giai điệu dễ nhớ',
            'Một bài kiểm tra khó',
            'Âm thanh rất nhỏ',
            'Một cây đàn mới',
          ],
          correctIndex: 0,
          explanation: 'Catchy describes a tune that is easy to remember.',
        },
      ],
    },
    create: {
      topicId: 'seed-music-daily',
      category: 'music',
      title: 'Daily English Songs',
      order: 2,
      exercises: [
        {
          id: 1,
          question:
            'Which word best completes: “I listen to music ___ the bus.”',
          options: ['on', 'at', 'by', 'from'],
          correctIndex: 0,
          explanation: 'We say on the bus.',
        },
        {
          id: 2,
          question: 'What does “catchy tune” mean?',
          options: [
            'Giai điệu dễ nhớ',
            'Một bài kiểm tra khó',
            'Âm thanh rất nhỏ',
            'Một cây đàn mới',
          ],
          correctIndex: 0,
          explanation: 'Catchy describes a tune that is easy to remember.',
        },
      ],
    },
  });

  const diagnostic = await prisma.diagnosticAssessment.upsert({
    where: { id: 1 },
    update: {
      title: 'Kiểm tra trình độ đầu vào',
      description:
        'Bài sàng lọc 20 câu đánh giá Listening, Reading và kiến thức nền hỗ trợ Speaking/Writing, Grammar/Vocabulary để gợi ý điểm bắt đầu. Phần Speaking/Writing thực hành phải được đánh giá ở bài luyện chuyên biệt.',
      isActive: true,
    },
    create: {
      id: 1,
      title: 'Kiểm tra trình độ đầu vào',
      description:
        'Bài sàng lọc 20 câu đánh giá Listening, Reading và kiến thức nền hỗ trợ Speaking/Writing, Grammar/Vocabulary để gợi ý điểm bắt đầu. Phần Speaking/Writing thực hành phải được đánh giá ở bài luyện chuyên biệt.',
      isActive: true,
    },
  });
  const diagnosticQuestions = [
    {
      skill: 'Listening',
      question:
        'You hear: “The museum tour begins at eleven near the main entrance.” Where should visitors meet?',
      options: [
        'At noon',
        'At the train station',
        'Near the main entrance',
        'At the café',
      ],
      correctIndex: 2,
      explanation: 'The announcement gives the meeting point directly.',
    },
    {
      skill: 'Listening',
      question:
        'You hear: “I’ll send the revised proposal after the director signs it.” What must happen first?',
      options: [
        'The meeting must end',
        'The client must call',
        'The director must sign',
        'The proposal must be printed',
      ],
      correctIndex: 2,
      explanation: 'The proposal is sent after the director signs.',
    },
    {
      skill: 'Listening',
      question:
        'You hear: “The 8:10 train has been delayed by twenty minutes.” What is the new departure time?',
      options: ['8:30', '8:10', '8:50', '8:20'],
      correctIndex: 0,
      explanation: '8:10 plus twenty minutes is 8:30.',
    },
    {
      skill: 'Listening',
      question:
        'You hear: “Would you mind reserving a conference room for Friday afternoon?” What is requested?',
      options: [
        'A room reservation',
        'A payment',
        'A report review',
        'A flight booking',
      ],
      correctIndex: 0,
      explanation: 'The speaker asks for a conference room reservation.',
    },
    {
      skill: 'Reading',
      question:
        'NOTICE: The gym will close at 7 P.M. today for equipment inspection. When will it close?',
      options: ['7 P.M.', '8 P.M.', 'Tomorrow', '6 P.M.'],
      correctIndex: 0,
      explanation: 'The notice states 7 P.M.',
    },
    {
      skill: 'Reading',
      question: 'Employees should submit travel requests _____ Friday.',
      options: ['during', 'since', 'by', 'among'],
      correctIndex: 2,
      explanation: 'By Friday gives a deadline.',
    },
    {
      skill: 'Reading',
      question:
        'The company expanded its delivery service because customer demand had increased. Why did it expand the service?',
      options: [
        'Costs fell',
        'Demand increased',
        'Employees requested leave',
        'A branch closed',
      ],
      correctIndex: 1,
      explanation: 'The sentence gives increased demand as the reason.',
    },
    {
      skill: 'Reading',
      question: 'The new policy applies to all employees ______ work remotely.',
      options: ['when', 'who', 'which', 'where'],
      correctIndex: 1,
      explanation: 'Who introduces a relative clause describing employees.',
    },
    {
      skill: 'Grammar',
      question: 'She usually ______ the first bus to work.',
      options: ['took', 'taking', 'take', 'takes'],
      correctIndex: 3,
      explanation: 'Present simple third-person singular uses takes.',
    },
    {
      skill: 'Grammar',
      question: 'The invoice ______ yesterday afternoon.',
      options: ['sent by itself', 'is send', 'was sent', 'has sending'],
      correctIndex: 2,
      explanation: 'Past passive is was sent.',
    },
    {
      skill: 'Grammar',
      question: 'If the client agrees, we ______ the contract tomorrow.',
      options: ['signing', 'signed', 'would signed', 'will sign'],
      correctIndex: 3,
      explanation: 'First conditional uses will + verb.',
    },
    {
      skill: 'Grammar',
      question: 'We have worked here ______ 2021.',
      options: ['since', 'during', 'from', 'for'],
      correctIndex: 0,
      explanation: 'Since is used with a starting point.',
    },
    {
      skill: 'Vocabulary',
      question: 'What does “deadline” mean?',
      options: [
        'The latest time something must be completed',
        'A train platform',
        'A company discount',
        'A customer complaint',
      ],
      correctIndex: 0,
      explanation:
        'Deadline means the final time by which a task must be completed.',
    },
    {
      skill: 'Vocabulary',
      question: 'Choose the closest meaning of “reliable”.',
      options: ['temporary', 'expensive', 'dependable', 'crowded'],
      correctIndex: 2,
      explanation: 'Reliable means dependable or trustworthy.',
    },
    {
      skill: 'Vocabulary',
      question:
        'Which word best completes: “The customer requested a full _____ for the damaged item.”',
      options: ['platform', 'agenda', 'survey', 'refund'],
      correctIndex: 3,
      explanation: 'Refund is money returned after a purchase.',
    },
    {
      skill: 'Vocabulary',
      question: 'Which word is related to money a business earns from sales?',
      options: ['revenue', 'luggage', 'destination', 'routine'],
      correctIndex: 0,
      explanation: 'Revenue is income from business activities.',
    },
    {
      skill: 'Speaking',
      question:
        'Choose the most natural reply: “Could you send the report before 5 P.M.?”',
      options: [
        'Report five.',
        'I sending yesterday.',
        'Certainly. I’ll send it this afternoon.',
        'Before is report.',
      ],
      correctIndex: 2,
      explanation: 'The first response is complete, polite, and relevant.',
    },
    {
      skill: 'Speaking',
      question: 'Which response gives a clear opinion?',
      options: [
        'Training material pace.',
        'I prefer because.',
        'Online training yes.',
        'I prefer online training because I can review the material at my own pace.',
      ],
      correctIndex: 3,
      explanation: 'A clear opinion includes a position and supporting reason.',
    },
    {
      skill: 'Writing',
      question: 'Choose the best opening for a professional email.',
      options: [
        'Dear Ms. Chen,',
        'What’s up client?',
        'Hey you!',
        'To person maybe,',
      ],
      correctIndex: 0,
      explanation: 'Dear + name is an appropriate professional opening.',
    },
    {
      skill: 'Writing',
      question: 'Choose the clearest sentence.',
      options: [
        'Information need any please.',
        'Please let me know if you need any additional information.',
        'Please let know me information.',
        'You need additional if.',
      ],
      correctIndex: 1,
      explanation: 'The first sentence is grammatical and professional.',
    },
  ];
  for (const [index, item] of diagnosticQuestions.entries()) {
    await prisma.diagnosticQuestion.upsert({
      where: { id: index + 1 },
      update: {
        assessmentId: diagnostic.id,
        skill: item.skill,
        question: item.question,
        options: item.options,
        correctIndex: item.correctIndex,
        explanation: item.explanation,
        order: index + 1,
      },
      create: {
        id: index + 1,
        assessmentId: diagnostic.id,
        skill: item.skill,
        question: item.question,
        options: item.options,
        correctIndex: item.correctIndex,
        explanation: item.explanation,
        order: index + 1,
      },
    });
  }

  console.log(
    `Seed complete: 1 admin, ${students.length} students, ${courses.length} courses, ${offerings.length} offerings, ${lessonId - 1} lessons, ${assignmentId - 1} assignments, vocabulary/grammar/TOEIC/gamification data.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
