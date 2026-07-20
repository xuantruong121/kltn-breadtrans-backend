export const AI_EVALUATOR_TOKEN = 'AI_EVALUATOR_STRATEGY';

export interface PronunciationFeedback {
  overallScore: number; // 0-10
  clarity: string; // "Excellent" | "Good" | "Fair" | "Poor"
  feedback: string; // Nhận xét tổng quan
  problematicWords: string[]; // Danh sách từ phát âm sai
  suggestions: string[]; // Gợi ý cải thiện
}

export interface IAIEvaluator {
  /**
   * Đánh giá và trả về phản hồi cho bài tập của học viên
   * @param question Câu hỏi gốc
   * @param studentAnswer Câu trả lời của học viên
   * @returns Chuỗi Feedback chi tiết
   */
  generateFeedback(question: string, studentAnswer: string): Promise<string>;

  /**
   * Trò chuyện với Chatbot AI
   * @param prompt Tin nhắn của người dùng
   * @returns Phản hồi từ AI
   */
  chat(prompt: string): Promise<string>;

  /**
   * Chấm điểm phát âm từ file audio
   * @param targetText Đoạn văn mẫu học viên cần đọc
   * @param audioBuffer File audio dưới dạng binary buffer (chuẩn WAV 16kHz)
   * @returns Đối tượng PronunciationFeedback có cấu trúc rõ ràng
   */
  assessPronunciation(
    targetText: string,
    audioBuffer: Buffer,
  ): Promise<PronunciationFeedback>;

  /**
   * Giải thích lỗi sai cho câu hỏi TOEIC
   * @param questionContent Nội dung câu hỏi (JSON hoặc string)
   * @param userAnswer Đáp án người dùng chọn
   * @param correctAnswer Đáp án đúng
   */
  explainToeicError(
    questionContent: any,
    userAnswer: string,
    correctAnswer: string,
  ): Promise<string>;

  /**
   * Tự động sinh danh sách câu hỏi TOEIC
   * @param topic Chủ đề (VD: Travel, Office)
   * @param part Phần thi TOEIC (VD: 5)
   * @param count Số lượng câu hỏi
   */
  generateToeicQuestions(
    topic: string,
    part: number,
    count: number,
  ): Promise<any[]>;

  /**
   * Tự động sinh danh sách câu hỏi Luyện nghe (Chép chính tả)
   * @param topic Chủ đề
   * @param count Số lượng câu
   */
  generateDictation(topic: string, count: number): Promise<any[]>;

  /**
   * Đọc file PDF/Image đề thi ETS và bóc tách thành JSON (Kèm Audio để trích xuất Timestamp)
   * @param pdfBuffer Buffer của file PDF/Ảnh
   * @param pdfMimeType MimeType của file PDF
   * @param audioBuffer Buffer của file Audio (Tùy chọn)
   * @param audioMimeType MimeType của file Audio (Tùy chọn)
   * @param audioUrl URL của Audio đã upload để gắn vào JSON
   */
  importEtsPdf(
    pdfBuffer: Buffer,
    pdfMimeType: string,
    audioBuffer?: Buffer,
    audioMimeType?: string,
    audioUrl?: string,
  ): Promise<any[]>;
}
