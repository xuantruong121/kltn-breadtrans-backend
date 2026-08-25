export const AI_EVALUATOR_TOKEN = 'AI_EVALUATOR_STRATEGY';

export interface WordAssessment {
  word: string;
  accuracyScore: number;
  errorType: 'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | 'Unspoken';
  isCorrect: boolean;
}

export interface PronunciationFeedback {
  overallScore: number; // 0-10
  clarity: string; // "Excellent" | "Good" | "Fair" | "Poor"
  feedback: string; // Nhận xét tổng quan
  problematicWords: string[]; // Danh sách từ phát âm sai hoặc chưa đọc
  suggestions: string[]; // Gợi ý cải thiện
  fluencyScore?: number;
  accuracyScore?: number;
  completenessScore?: number;
  words?: WordAssessment[]; // Chi tiết trạng thái từng từ trong câu
  isSilentOrNoSpeech?: boolean; // Cờ báo hiệu không phát hiện giọng nói
}

export interface SmartGeneratedContent {
  documentSummary?: string;
  quizQuestions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    difficulty?: string;
  }>;
  flashcards: Array<{
    term: string;
    pos?: string;
    ipa?: string;
    meaning: string;
    example: string;
  }>;
  assignment: {
    title: string;
    description: string;
    instructions: string;
    estimatedTimeMinutes?: number;
  };
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
   * Đánh giá TOEIC Writing Part 1
   * @param imageUrl URL hình ảnh
   * @param keywords Danh sách từ khóa
   * @param userSentence Câu trả lời của học viên
   */
  evaluateWritingPart1(
    imageUrl: string,
    keywords: string[],
    userSentence: string,
  ): Promise<{ score: number; feedback: string }>;

  /**
   * Đánh giá TOEIC Writing Part 2 (Respond to an Email Request - Thang điểm 0-4)
   * @param emailPrompt Nội dung email yêu cầu
   * @param userResponse Email phản hồi của học viên
   */
  evaluateWritingPart2(
    emailPrompt: string,
    userResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }>;

  /**
   * Đánh giá TOEIC Writing Part 3 (Write an Opinion Essay - Thang điểm 0-5)
   * @param essayTopic Chủ đề bài luận
   * @param userEssay Bài luận của học viên
   */
  evaluateWritingPart3(
    essayTopic: string,
    userEssay: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }>;

  /**
   * Đánh giá TOEIC Speaking Part 3-5 (Respond to Questions / Solution / Opinion)
   * @param promptText Câu hỏi / tình huống đề bài
   * @param studentResponse Bản ghi âm hoặc transcript câu trả lời
   */
  evaluateSpeakingPart3To5(
    promptText: string,
    studentResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }>;

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

  /**
   * Sinh câu hỏi trắc nghiệm, Flashcard và bài tập từ văn bản tài liệu đã trích xuất
   * @param documentText Nội dung tài liệu
   * @param options Tùy chọn số lượng câu hỏi và flashcard
   */
  generateSmartContentFromDocument(
    documentText: string,
    options?: { quizCount?: number; flashcardCount?: number },
  ): Promise<SmartGeneratedContent>;
}
