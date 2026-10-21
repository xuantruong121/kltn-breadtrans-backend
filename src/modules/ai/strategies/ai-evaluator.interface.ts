import type { SpeakingTaskType } from '../../speaking/speaking-contract';

export const AI_EVALUATOR_TOKEN = 'AI_EVALUATOR_STRATEGY';

export interface WordAssessment {
  word: string;
  accuracyScore: number;
  errorType:
    'None' | 'Mispronunciation' | 'Omission' | 'Insertion' | 'Unspoken';
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
  transcript?: string;
  errorCode?: string;
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

export interface DictionaryEnrichmentInput {
  word: string;
  partOfSpeech: string | null;
  definitionEn: string;
  exampleEn: string | null;
}

export interface DictionaryEnrichment {
  meaningVi: string;
  shortExplanationVi?: string;
  exampleVi?: string;
  collocations?: Array<{ phrase: string; meaningVi: string }>;
}

export interface IAIEvaluator {
  validateImageSemantic?(
    input: AiImageSemanticValidationInput,
  ): Promise<AiImageSemanticValidationResult>;
  analyzeToeicPart1Candidates?(input: {
    candidates: Array<{
      candidateId: string;
      imageBuffer: Buffer;
      mimeType: string;
    }>;
  }): Promise<ToeicPart1CandidateAnalysis[]>;

  generateToeicPart1FromImage?(input: {
    imageBuffer: Buffer;
    mimeType: string;
  }): Promise<ToeicPart1QuestionCandidate>;
  /** Optional, bounded enrichment for external dictionary entries. */
  enrichDictionaryEntry?(
    input: DictionaryEnrichmentInput,
  ): Promise<DictionaryEnrichment | null>;
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
    options?: { signal?: AbortSignal },
  ): Promise<PronunciationFeedback>;

  /** Optional second-stage feedback; score creation must not depend on it. */
  generatePronunciationFeedback?(
    targetText: string,
    assessment: PronunciationFeedback,
  ): Promise<
    Partial<Pick<PronunciationFeedback, 'clarity' | 'feedback' | 'suggestions'>>
  >;

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

  /** Phase 8.9B: bounded TOEIC practice batch. The TOEIC domain validates this
   * untrusted candidate before it can become a Draft row. */
  generateToeicExamBatch?(
    input: ToeicExamBatchRequest,
  ): Promise<ToeicExamBatch>;

  /** Optional image capability. Returning bytes (not a URL) prevents a
   * provider from inventing remote media references. */
  generateToeicExamImage?(input: {
    brief: string;
    part: number;
  }): Promise<{ buffer: Buffer; mimeType: string }>;

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

  /** Phase 5A: Gợi ý nội dung từ vựng theo chuẩn VocabWord */
  suggestVocabWord?(input: {
    word: string;
    context?: string;
    level?: string;
  }): Promise<ContextualVocabSuggestion>;

  /** Phase 5A: Gợi ý danh sách câu hỏi ngữ pháp trắc nghiệm nháp */
  suggestGrammarQuestions?(input: {
    topicTitle: string;
    level: string;
    theory?: string;
    keyFormula?: string;
    count: number;
  }): Promise<ContextualGrammarSuggestion>;

  /** Phase 5A: Gợi ý đoạn văn đọc (Reading passage) nháp */
  suggestReadingPassage?(input: {
    topic: string;
    level: string;
    targetLength?: number;
    microSkill?: string;
  }): Promise<ContextualReadingPassageSuggestion>;

  /** Phase 5A: Gợi ý câu hỏi trắc nghiệm từ đoạn văn đọc hiện tại trong editor */
  suggestReadingQuestions?(input: {
    passage: string;
    level?: string;
    count: number;
  }): Promise<ContextualReadingQuestionsSuggestion>;

  /** Phase 5A: Gợi ý câu hỏi TOEIC Part 5 nháp */
  suggestToeicPart5?(input: {
    topic?: string;
    level?: string;
    grammarFocus?: string;
    vocabularyFocus?: string;
    count: number;
  }): Promise<ContextualToeicPart5Suggestion>;

  /** Phase 5B: Course curriculum candidates only. */
  suggestCourseCurriculum?(input: {
    courseTitle: string;
    level?: string;
    description?: string;
    targetLessonCount: number;
    existingLessonTitles?: string[];
  }): Promise<ContextualCourseCurriculumSuggestion>;

  /** Phase 8.15: bounded candidate for one selected Course V5 lesson only. */
  suggestCourseLessonContent?(input: {
    courseTitle: string;
    courseDescription?: string;
    courseLevel?: string;
    lessonTitle: string;
    lessonSummary: string;
    objectives: string[];
    existingSectionHeadings?: string[];
    existingExerciseSlugs?: string[];
    previousLessons?: Array<{
      title: string;
      summary?: string;
      objectives?: string[];
    }>;
    nextLessonTitle?: string;
    existingSections?: Array<{
      type: string;
      heading: string;
      text?: string;
      bullets?: string[];
      examples?: string[];
    }>;
    mode?: 'CREATE' | 'IMPROVE';
  }): Promise<ContextualCourseLessonContentSuggestion>;

  /** Phase 8.16: candidate-only refinement of one existing lesson section. */
  suggestCourseSectionRefinement?(input: {
    action: 'EXPAND' | 'SIMPLIFY' | 'ADD_EXAMPLES' | 'KEY_POINTS';
    courseTitle: string;
    courseLevel?: string;
    lessonTitle: string;
    objectives: string[];
    section: {
      type: string;
      heading: string;
      text?: string;
      paragraphs?: string[];
      bullets?: string[];
      examples?: Array<{
        text: string;
        translation?: string;
        explanation?: string;
      }>;
    };
  }): Promise<ContextualCourseLessonSectionSuggestion>;

  /** Phase 5B: Listening transcript/turn candidates only. */
  suggestListeningContent?(input: {
    mode: 'DIALOGUE' | 'DICTATION';
    level?: string;
    topic?: string;
    currentText?: string;
    currentTurns?: Array<{
      speaker: string;
      text: string;
      translation?: string;
    }>;
  }): Promise<ContextualListeningContentSuggestion>;

  /** Phase 5B: Listening multiple-choice candidates from current editor text. */
  suggestListeningQuestions?(input: {
    mode: 'DIALOGUE' | 'DICTATION';
    sourceText: string;
    level?: string;
    count: number;
  }): Promise<ContextualListeningQuestionsSuggestion>;

  /** Phase 5B: Writing task candidates only, without media fabrication. */
  suggestWritingTask?(input: {
    taskType: string;
    level?: string;
    topic?: string;
    currentPrompt?: string;
    wordMin?: number;
    wordMax?: number;
  }): Promise<ContextualWritingTaskSuggestion>;

  /** Phase 8.8: Speaking practice-set draft only; no persistence or media. */
  suggestSpeakingPracticeSet?(input: {
    topic: string;
    level: string;
    category: string;
    categoryContext?: SpeakingCategoryAiContext;
    currentTitle?: string;
    currentDescription?: string;
  }): Promise<ContextualSpeakingPracticeSetSuggestion>;

  /** Phase 8.8: Speaking exercise drafts only; parent context stays explicit. */
  suggestSpeakingExercises?(input: {
    practiceSetTitle: string;
    practiceSetDescription?: string;
    level: string;
    category: string;
    categoryContext?: SpeakingCategoryAiContext;
    currentTitle?: string;
    currentTargetText?: string;
    taskType?: SpeakingTaskType;
    existingExerciseTitles?: string[];
    count: number;
  }): Promise<ContextualSpeakingExercisesSuggestion>;

  suggestSpeakingFullDraft?(input: {
    topic: string;
    level: string;
    category: string;
    categoryContext?: SpeakingCategoryAiContext;
    objective?: string;
    taskType?: SpeakingTaskType;
    count: number;
  }): Promise<ContextualSpeakingFullDraftSuggestion>;

  /** Structured TOEIC S&W draft only. Persistence and publishing stay in the exam domain. */
  generateToeicSpeakingWritingDraft?(input: {
    topic?: string;
    difficulty: 'easy' | 'medium' | 'hard';
    includeSpeaking: boolean;
    includeWriting: boolean;
  }): Promise<ToeicSpeakingWritingDraft>;

  suggestListeningFullDraft?(input: {
    topic: string;
    level?: string;
    mode: 'DIALOGUE' | 'DICTATION';
    count: number;
  }): Promise<ContextualListeningFullDraftSuggestion>;

  suggestReadingFullDraft?(input: {
    topic: string;
    level: string;
    targetLength?: number;
    microSkill?: string;
    count: number;
  }): Promise<ContextualReadingFullDraftSuggestion>;

  suggestVocabFullDraft?(input: {
    topic: string;
    level?: string;
    context?: string;
    count: number;
  }): Promise<ContextualVocabFullDraftSuggestion>;

  suggestGrammarFullDraft?(input: {
    topicTitle: string;
    level: string;
    objective?: string;
    count: number;
  }): Promise<ContextualGrammarFullDraftSuggestion>;
}

export interface ToeicPart1CandidateAnalysis {
  candidateId: string;
  status: 'SUITABLE' | 'UNSUITABLE' | 'ANALYSIS_FAILED';
  suitable: boolean;
  score: number;
  sceneSummary: string;
  visibleFacts: string[];
  unsafeInferences: string[];
  rejectionReasons: string[];
}

export type AiImageSemanticValidationInput = {
  taskType:
    | 'TOEIC_PART1'
    | 'SPEAKING_DESCRIBE_PICTURE'
    | 'WRITING_PICTURE'
    | 'COURSE_LESSON_IMAGE';
  imageBuffer: Buffer;
  mimeType: string;
  imageBrief: string;
  context?: string;
};

export type AiImageSemanticValidationResult = {
  status: 'PASS' | 'FAIL' | 'LOW_CONFIDENCE' | 'UNAVAILABLE';
  confidence: number;
  description: string;
  visibleFacts: string[];
  issues: string[];
  rejectionReasons: string[];
};

export interface ToeicPart1QuestionCandidate {
  sceneSummary: string;
  statements: string[];
  correctIndex: number;
  explanation: string;
}

export type ToeicExamBatchQuestion = {
  text?: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type ToeicExamBatchGroup = {
  transcript?: string;
  passageText?: string;
  imageBrief?: string;
  questions: ToeicExamBatchQuestion[];
};

export type ToeicExamBatchRequest = {
  part: number;
  topic?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  groups: Array<{ questionCount: number; kind?: 'SINGLE' | 'MULTIPLE' }>;
};

export type ToeicExamBatch = { groups: ToeicExamBatchGroup[] };

export interface ContextualVocabSuggestion {
  word: string;
  pos: string;
  meaning: string;
  ipaUs?: string;
  ipaUk?: string;
  exampleEn?: string;
  exampleVi?: string;
  collocations?: Array<{ phrase: string; meaningVi: string }>;
}

export interface ContextualGrammarCandidate {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ContextualGrammarSuggestion {
  candidates: ContextualGrammarCandidate[];
}

export interface ContextualReadingPassageSuggestion {
  title: string;
  passage: string;
  topic?: string;
  level?: string;
}

export interface ContextualReadingCandidate {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  questionType?: string;
}

export interface ContextualReadingQuestionsSuggestion {
  candidates: ContextualReadingCandidate[];
}

export interface ContextualToeicPart5Candidate {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ContextualToeicPart5Suggestion {
  candidates: ContextualToeicPart5Candidate[];
}
export interface ContextualCourseLessonCandidate {
  title: string;
  summary: string;
  objectives: string[];
  sections?: Array<{
    type: string;
    heading: string;
    content: string;
  }>;
}
export interface ContextualCourseCurriculumSuggestion {
  candidates: ContextualCourseLessonCandidate[];
}

export interface ContextualCourseLessonSectionSuggestion {
  type: string;
  heading: string;
  content: string;
  paragraphs?: string[];
  bullets?: string[];
  examples?: Array<{
    text: string;
    translation?: string;
    explanation?: string;
  }>;
}

/** Candidate-only generation plan. Guides review; never persisted to Course. */
export interface ContextualCoursePedagogyPlan {
  keyConcepts: string[];
  realWorldContexts: string[];
  commonMistakes: string[];
  practiceCoverage: string[];
}

export interface ContextualCourseLessonContentSuggestion {
  sections: ContextualCourseLessonSectionSuggestion[];
  guidedPractice: ContextualCourseLessonExerciseSuggestion;
  finalCheck: ContextualCourseLessonExerciseSuggestion;
  pedagogyPlan?: ContextualCoursePedagogyPlan;
}

export interface ContextualCourseLessonExerciseSuggestion {
  type: string;
  title: string;
  prompt: string;
  instructions?: string;
  questions: Array<{
    prompt: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
  }>;
}

export interface ContextualListeningTurn {
  speaker: string;
  text: string;
  translation?: string;
}

export interface ContextualListeningContentSuggestion {
  mode: 'DIALOGUE' | 'DICTATION';
  turns?: ContextualListeningTurn[];
  text?: string;
}

export interface ContextualListeningQuestionCandidate {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ContextualListeningQuestionsSuggestion {
  candidates: ContextualListeningQuestionCandidate[];
}

export interface ContextualWritingTaskSuggestion {
  taskType: string;
  prompt: string;
  scenario?: string;
  recipient?: string;
  context?: string;
  wordRange?: [number, number];
  keywords?: string[];
  sampleSentences?: string[];
}

export interface ContextualSpeakingPracticeSetSuggestion {
  title: string;
  description: string;
  category: string;
  level: string;
}

export interface SpeakingCategoryAiContext {
  code: string;
  displayLabel: string;
  allowPracticeSet: boolean;
  allowExercise: boolean;
}

export interface ContextualSpeakingExerciseCandidate {
  title: string;
  targetText: string;
  difficulty: string;
  taskType: SpeakingTaskType;
}

export interface ContextualSpeakingExercisesSuggestion {
  candidates: ContextualSpeakingExerciseCandidate[];
}

export interface ContextualSpeakingFullDraftSuggestion {
  practiceSet: ContextualSpeakingPracticeSetSuggestion;
  exercises: ContextualSpeakingExerciseCandidate[];
}

export interface ToeicSpeakingDraftExercise {
  title: string;
  targetText: string;
  taskType: SpeakingTaskType;
  imageBrief?: string;
  informationStimulus?: string;
}

export interface ToeicWritingDraftTask {
  title: string;
  taskKind: 'PICTURE_SENTENCE' | 'WRITTEN_REQUEST' | 'OPINION_ESSAY';
  prompt: string;
  imageBrief?: string;
  keywords?: string[];
  wordRange?: [number, number];
}

export interface ToeicSpeakingWritingDraft {
  speaking: ToeicSpeakingDraftExercise[];
  writing: ToeicWritingDraftTask[];
}

export interface ContextualListeningFullDraftSuggestion {
  title: string;
  description: string;
  level?: string;
  mode: 'DIALOGUE' | 'DICTATION';
  text?: string;
  turns?: ContextualListeningTurn[];
  questions: ContextualListeningQuestionCandidate[];
}

export interface ContextualReadingFullDraftSuggestion {
  title: string;
  description: string;
  level: string;
  passage: string;
  questions: ContextualReadingCandidate[];
}

export interface ContextualVocabFullDraftSuggestion {
  title: string;
  categoryName: string;
  words: ContextualVocabSuggestion[];
}

export interface ContextualGrammarFullDraftSuggestion {
  title: string;
  description: string;
  level: string;
  keyFormula: string;
  questions: ContextualGrammarCandidate[];
}
