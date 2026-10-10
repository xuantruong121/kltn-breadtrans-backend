export type CourseLearningProfile = {
  introduction: string;
  objectives: string[];
  studyGuidance: string;
  mediaLabel: string;
  coverImage: string;
};

const profiles: Record<number, CourseLearningProfile> = {
  1: {
    introduction:
      'Khóa học xây nền tảng tiếng Anh A1–A2 qua những tình huống gần gũi: âm và chữ, giới thiệu bản thân, lịch sinh hoạt, thời gian, mua sắm, chỉ đường và tin nhắn ngắn. Mỗi bài đi từ một ý nhỏ, có ví dụ dễ bắt chước rồi mới chuyển sang luyện nghe, nói, đọc hoặc viết. Đây là lộ trình phù hợp khi bạn muốn xây phản xạ cơ bản chắc chắn thay vì học rời từng mẹo.',
    objectives: [
      'Nhận diện âm và cách viết của từ quen thuộc.',
      'Giới thiệu bản thân, nói về lịch sinh hoạt và nhu cầu hằng ngày.',
      'Đọc hiểu tin nhắn ngắn và viết câu trả lời đơn giản.',
    ],
    studyGuidance:
      'Học lần lượt từng bài. Đọc phần giải thích, tự nói lại ví dụ, sau đó mới mở bài luyện tập. Hoạt động bắt buộc quyết định tiến độ; hoạt động tùy chọn dùng để ôn thêm.',
    mediaLabel: 'Minh họa nền tảng giao tiếp hằng ngày',
    coverImage: '/images/courses/course-1-foundations.svg',
  },
  2: {
    introduction:
      'Lộ trình B1 phát triển bốn kỹ năng trong bối cảnh công việc và giao tiếp thực tế. Bạn học cách nắm ý chính, tìm chi tiết, phản hồi rõ ràng, đọc email, viết đoạn văn và kết nối thông tin giữa các kỹ năng. Nội dung tăng dần từ nhiệm vụ đơn đến dự án bốn kỹ năng để việc luyện tập có mạch liên tục.',
    objectives: [
      'Nắm ý chính và chi tiết trong hội thoại công việc.',
      'Trả lời, mô tả và giải thích ý tưởng với cấu trúc rõ ràng.',
      'Đọc email và viết thông điệp chuyên nghiệp ở mức B1.',
    ],
    studyGuidance:
      'Mỗi lesson nên được hoàn thành theo thứ tự: lý thuyết, ví dụ, hướng dẫn rồi hoạt động bắt buộc. Hãy xem hoạt động tùy chọn như phần củng cố, không cần làm để mở bài kế tiếp.',
    mediaLabel: 'Minh họa giao tiếp nơi làm việc',
    coverImage: '/images/courses/course-2-four-skills.svg',
  },
  3: {
    introduction:
      'Khóa TOEIC 450–650 tập trung vào chiến lược nghe và đọc có thể áp dụng ngay. Các lesson đi qua Part 1 đến Part 7, giúp bạn nhận diện dạng câu hỏi, chọn bằng chứng trong bài và kiểm soát thời gian trước khi làm đề tổng hợp. Phần hướng dẫn giải thích cách suy luận, không thay thế nội dung đề thi.',
    objectives: [
      'Nhận diện yêu cầu của từng Part TOEIC Listening và Reading.',
      'Tìm từ khóa, bằng chứng và mối quan hệ thông tin trong văn bản.',
      'Làm một mốc đề tổng hợp với chiến lược thời gian phù hợp.',
    ],
    studyGuidance:
      'Đọc chiến lược trước khi vào đề. Sau mỗi hoạt động, xem lại lý do chọn đáp án và ghi lại lỗi lặp lại; chỉ chuyển lesson khi đã hoàn thành bước bắt buộc.',
    mediaLabel: 'Minh họa chiến lược TOEIC Listening & Reading',
    coverImage: '/images/courses/course-3-toeic-foundation.svg',
  },
  4: {
    introduction:
      'Lộ trình TOEIC 650–850+ dành cho người đã có nền tảng và cần xử lý suy luận, hội thoại nhiều người, bài nói dài và các bẫy ngữ pháp nâng cao. Mỗi lesson nhấn mạnh cách liên kết bằng chứng, nhận biết thái độ và duy trì độ chính xác khi áp lực thời gian tăng.',
    objectives: [
      'Suy luận mục đích, thái độ và hàm ý trong bài nghe khó.',
      'Theo dõi nhiều người nói và thông tin liên kết trong văn bản dài.',
      'Kiểm soát bẫy Part 5–7 và đánh giá tiến bộ qua đề mốc.',
    ],
    studyGuidance:
      'Ôn lại ví dụ và chiến lược trước mỗi đề. Ghi chú lý do sai, luyện lại phần yếu rồi mới mở bước tiếp theo; hoạt động tùy chọn dùng cho thử thách nâng cao.',
    mediaLabel: 'Minh họa TOEIC nâng cao và suy luận',
    coverImage: '/images/courses/course-4-toeic-advanced.svg',
  },
  5: {
    introduction:
      'Khóa TOEIC Speaking & Writing chia nhỏ từng dạng nhiệm vụ: đọc to, mô tả tranh, trả lời câu hỏi, dùng thông tin, nêu quan điểm và viết câu, email, bài luận. Phần theory giúp bạn hiểu tiêu chí, bố cục và cách phát triển ý trước khi ghi âm hoặc nộp bài.',
    objectives: [
      'Nói rõ âm, nhịp và ý chính trong các nhiệm vụ Speaking.',
      'Tổ chức câu, email và bài luận theo yêu cầu TOEIC Writing.',
      'Tự kiểm tra độ đầy đủ, liên kết và tính chính xác trước khi nộp.',
    ],
    studyGuidance:
      'Đọc mẫu và tiêu chí trước khi luyện. Hoàn thành bài bắt buộc, xem lại nhận xét rồi sửa một điểm cụ thể ở lần luyện sau.',
    mediaLabel: 'Minh họa phòng luyện Speaking & Writing',
    coverImage: '/images/courses/course-5-speaking-writing.svg',
  },
  6: {
    introduction:
      'Khóa 4 kỹ năng tổng hợp mô phỏng một lộ trình học và làm việc trong môi trường công sở. Bạn bắt đầu bằng chẩn đoán, luyện sâu từng kỹ năng, chuyển sang tình huống tích hợp và kết thúc bằng capstone để nhìn thấy tiến bộ toàn diện.',
    objectives: [
      'Xác định điểm mạnh và khoảng trống ở cả bốn kỹ năng.',
      'Chuyển chiến lược nghe, đọc, nói và viết vào cùng một tình huống.',
      'Hoàn thành mốc capstone và lập kế hoạch ôn tiếp theo.',
    ],
    studyGuidance:
      'Theo roadmap từ chẩn đoán đến capstone. Lý thuyết và hướng dẫn của từng lesson là bước chuẩn bị bắt buộc; hãy dùng hoạt động tùy chọn để bù kỹ năng còn yếu.',
    mediaLabel: 'Minh họa lộ trình bốn kỹ năng',
    coverImage: '/images/courses/course-6-four-skills-mastery.svg',
  },
  7: {
    introduction:
      'Business English B1–B2 dùng các tình huống giới thiệu, họp, gọi điện, chăm sóc khách hàng, email, báo cáo, thuyết trình và giải quyết vấn đề. Mục tiêu là giúp bạn chọn cách diễn đạt chuyên nghiệp, lịch sự và có cấu trúc trong công việc hằng ngày.',
    objectives: [
      'Điều phối cuộc họp, lịch hẹn và cuộc gọi bằng ngôn ngữ rõ ràng.',
      'Đọc báo cáo và email để tìm thông tin phục vụ quyết định.',
      'Viết và trình bày giải pháp có lý do, dữ liệu và bước hành động.',
    ],
    studyGuidance:
      'Đọc tình huống và cụm diễn đạt trước khi luyện. Làm hoạt động bắt buộc theo thứ tự; sau khi nhận kết quả, quay lại lesson để ghi chú cách dùng trong thực tế.',
    mediaLabel: 'Minh họa giao tiếp kinh doanh',
    coverImage: '/images/courses/course-7-business-english.svg',
  },
  8: {
    introduction:
      'Grammar & Vocabulary Builder hệ thống lại các điểm ngữ pháp và từ vựng có tần suất cao trong câu thực tế. Từ thì, loại từ, động từ khuyết thiếu đến câu bị động, điều kiện và mệnh đề quan hệ, mỗi lesson đều có công thức ngắn, ví dụ và bài kiểm tra áp dụng.',
    objectives: [
      'Chọn cấu trúc ngữ pháp phù hợp với thời gian và ý nghĩa.',
      'Nhận diện vai trò từ, liên kết câu và dạng bị động.',
      'Dùng ngữ cảnh, collocation và word form để chọn từ chính xác.',
    ],
    studyGuidance:
      'Đọc công thức, tự đặt một ví dụ và làm hoạt động ngay sau lesson. Khi sai, quay lại phần giải thích thay vì chỉ làm lại liên tục; các bước vẫn mở theo thứ tự bắt buộc.',
    mediaLabel: 'Minh họa bảng ngữ pháp và từ vựng',
    coverImage: '/images/courses/course-8-grammar-vocabulary.svg',
  },
};

export function getCourseLearningProfile(
  courseId: number,
  title?: string,
): CourseLearningProfile {
  return (
    profiles[courseId] ?? {
      introduction: `${title ?? 'Khóa học'} cung cấp các bài học theo lộ trình, kết hợp phần giải thích ngắn với hoạt động thực hành phù hợp trình độ.`,
      objectives: [
        'Hiểu nội dung trọng tâm của từng bài.',
        'Áp dụng kiến thức vào hoạt động thực hành.',
        'Theo dõi tiến bộ qua các bước bắt buộc.',
      ],
      studyGuidance:
        'Học theo thứ tự, đọc phần lý thuyết trước khi mở hoạt động và xem lại kết quả sau khi hoàn thành.',
      mediaLabel: 'Minh họa nội dung học tập',
      coverImage: '/images/courses/course-1-foundations.svg',
    }
  );
}

export function getLessonTheory(
  title: string,
  description?: string | null,
  objective?: string | null,
  contentText?: string | null,
) {
  const source = [description, objective, contentText].find((value) =>
    Boolean(value?.trim()),
  );
  return {
    overview: source?.trim() ?? `Bài học tập trung vào ${title}.`,
    keyPoints: [
      `Xác định mục tiêu chính của chủ đề “${title}”.`,
      'Đọc ví dụ, chú ý từ khóa và thử nói hoặc viết lại bằng ngôn ngữ của bạn.',
      'Chỉ mở hoạt động luyện tập sau khi đã nắm được hướng dẫn trên trang này.',
    ],
  };
}
