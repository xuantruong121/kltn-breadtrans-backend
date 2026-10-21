import {
  Injectable,
  Inject,
  Logger,
  Optional,
  BadRequestException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import type { SpeakingTaskType } from '../speaking/speaking-contract';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import type {
  IAIEvaluator,
  PronunciationFeedback,
  DictionaryEnrichment,
  DictionaryEnrichmentInput,
  ContextualVocabSuggestion,
  ContextualGrammarSuggestion,
  ContextualReadingPassageSuggestion,
  ContextualReadingQuestionsSuggestion,
  ContextualToeicPart5Suggestion,
  ContextualCourseCurriculumSuggestion,
  ContextualCourseLessonContentSuggestion,
  ContextualCourseLessonSectionSuggestion,
  ContextualListeningContentSuggestion,
  ContextualListeningQuestionsSuggestion,
  ContextualWritingTaskSuggestion,
  ContextualSpeakingPracticeSetSuggestion,
  ContextualSpeakingExercisesSuggestion,
  ContextualSpeakingFullDraftSuggestion,
  ContextualListeningFullDraftSuggestion,
  ContextualReadingFullDraftSuggestion,
  ContextualVocabFullDraftSuggestion,
  ContextualGrammarFullDraftSuggestion,
  ToeicExamBatch,
  ToeicExamBatchRequest,
  ToeicSpeakingWritingDraft,
  ToeicPart1CandidateAnalysis,
  ToeicPart1QuestionCandidate,
  AiImageSemanticValidationInput,
  AiImageSemanticValidationResult,
} from './strategies/ai-evaluator.interface';

export async function normalizeAzureSpeechResponse(response: {
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
  headers?: { get: (name: string) => string | null };
}): Promise<Buffer> {
  if (!response.ok) {
    const detail = response.text ? (await response.text()).trim() : '';
    const safeDetail = detail.replace(/\s+/g, ' ').slice(0, 300);
    const requestId =
      response.headers?.get('x-requestid') ??
      response.headers?.get('x-ms-request-id');
    throw new Error(
      `Azure Speech synthesis failed (${response.status} ${response.statusText})${requestId ? ` [requestId:${requestId}]` : ''}${safeDetail ? `: ${safeDetail}` : ''}`,
    );
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw new Error('Azure Speech returned empty audio bytes');
  }
  return audio;
}

export function buildToeicListeningSsml(transcript: string): string {
  const escapeXml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const turns = transcript
    .split(/\r?\n/)
    .map((line) => {
      const match = /^\s*([^:]{1,40}):\s*(.+)$/.exec(line);
      return match
        ? { speaker: match[1].trim(), text: match[2].trim() }
        : { speaker: 'Narrator', text: line.trim() };
    })
    .filter((turn) => turn.text);
  if (!turns.length) {
    throw new Error('Transcript không có nội dung để tạo audio');
  }
  const voicePool = [
    'en-US-JennyNeural',
    'en-US-GuyNeural',
    'en-US-AriaNeural',
    'en-US-DavisNeural',
  ];
  const voiceBySpeaker = new Map<string, string>();
  const body = turns
    .map((turn) => {
      if (!voiceBySpeaker.has(turn.speaker))
        voiceBySpeaker.set(
          turn.speaker,
          voicePool[voiceBySpeaker.size % voicePool.length],
        );
      return `<voice name="${voiceBySpeaker.get(turn.speaker)}">${escapeXml(turn.text)}</voice>`;
    })
    .join('');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">${body}</speak>`;
}

/**
 * AiService giờ đây hoạt động như một "Context" trong Strategy Pattern.
 * Nó không quan tâm AI đang dùng là Gemini hay ChatGPT. Mọi logic gọi API
 * được ủy thác (delegate) cho Strategy được tiêm vào thông qua Dependency Injection.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly DAILY_LIMIT = 500;

  constructor(
    @Inject(AI_EVALUATOR_TOKEN)
    private readonly aiEvaluator: IAIEvaluator,
    @Optional() @InjectRedis() private readonly redis?: Redis,
  ) {
    this.logger.log('AiService initialized with Strategy Pattern');
  }

  private getTodayUtcKey(): string {
    return `gemini:daily_quota:${new Date().toISOString().slice(0, 10)}`;
  }

  async checkAndIncrementDailyQuota(): Promise<number> {
    if (!this.redis) return 1;
    const key = this.getTodayUtcKey();
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 86400 * 2);
    }
    if (count > this.DAILY_LIMIT) {
      throw new BadRequestException(
        `Đã vượt quá hạn mức quota AI trong ngày (${this.DAILY_LIMIT} requests). Vui lòng thử lại sau.`,
      );
    }
    return count;
  }

  async enrichDictionaryEntry(
    input: DictionaryEnrichmentInput,
  ): Promise<DictionaryEnrichment | null> {
    if (!this.aiEvaluator.enrichDictionaryEntry) return null;
    return this.aiEvaluator.enrichDictionaryEntry(input);
  }

  async generateFeedback(
    question: string,
    studentAnswer: string,
  ): Promise<string> {
    return this.aiEvaluator.generateFeedback(question, studentAnswer);
  }

  async chat(prompt: string): Promise<string> {
    return this.aiEvaluator.chat(prompt);
  }

  async assessPronunciation(
    targetText: string,
    audioBuffer: Buffer,
    options?: { signal?: AbortSignal },
  ): Promise<PronunciationFeedback> {
    return this.aiEvaluator.assessPronunciation(
      targetText,
      audioBuffer,
      options,
    );
  }

  async generatePronunciationFeedback(
    targetText: string,
    assessment: PronunciationFeedback,
  ): Promise<
    Partial<Pick<PronunciationFeedback, 'clarity' | 'feedback' | 'suggestions'>>
  > {
    if (!this.aiEvaluator.generatePronunciationFeedback) return {};
    return this.aiEvaluator.generatePronunciationFeedback(
      targetText,
      assessment,
    );
  }

  async explainToeicError(
    questionContent: any,
    userAnswer: string,
    correctAnswer: string,
  ): Promise<string> {
    return this.aiEvaluator.explainToeicError(
      questionContent,
      userAnswer,
      correctAnswer,
    );
  }

  async generateToeicQuestions(
    topic: string,
    part: number,
    count: number,
  ): Promise<any[]> {
    return this.aiEvaluator.generateToeicQuestions(topic, part, count);
  }

  async generateToeicExamBatch(
    input: ToeicExamBatchRequest,
  ): Promise<ToeicExamBatch> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.generateToeicExamBatch) {
      throw new BadRequestException(
        'Nhà cung cấp AI hiện tại chưa hỗ trợ tạo batch đề TOEIC',
      );
    }
    return this.aiEvaluator.generateToeicExamBatch(input);
  }

  async generateToeicExamImage(input: {
    brief: string;
    part: number;
  }): Promise<{ buffer: Buffer; mimeType: string }> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.generateToeicExamImage) {
      throw new BadRequestException(
        'Nhà cung cấp AI hiện tại chưa hỗ trợ tạo ảnh đề TOEIC',
      );
    }
    return this.aiEvaluator.generateToeicExamImage(input);
  }

  async analyzeToeicPart1Candidates(input: {
    candidates: Array<{
      candidateId: string;
      imageBuffer: Buffer;
      mimeType: string;
    }>;
  }): Promise<ToeicPart1CandidateAnalysis[]> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.analyzeToeicPart1Candidates) {
      throw new BadRequestException(
        'Nhà cung cấp AI chưa hỗ trợ phân tích ảnh TOEIC',
      );
    }
    return this.aiEvaluator.analyzeToeicPart1Candidates(input);
  }

  async validateImageSemantic(
    input: AiImageSemanticValidationInput,
  ): Promise<AiImageSemanticValidationResult> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.validateImageSemantic) {
      return {
        status: 'UNAVAILABLE',
        confidence: 0,
        description: 'Nhà cung cấp AI chưa hỗ trợ kiểm tra ngữ nghĩa ảnh.',
        visibleFacts: [],
        issues: [],
        rejectionReasons: [],
      };
    }
    return this.aiEvaluator.validateImageSemantic(input);
  }

  async generateToeicPart1FromImage(input: {
    imageBuffer: Buffer;
    mimeType: string;
  }): Promise<ToeicPart1QuestionCandidate> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.generateToeicPart1FromImage) {
      throw new BadRequestException(
        'Nhà cung cấp AI chưa hỗ trợ sinh câu hỏi từ ảnh TOEIC',
      );
    }
    return this.aiEvaluator.generateToeicPart1FromImage(input);
  }

  async generateToeicSpeakingWritingDraft(input: {
    topic?: string;
    difficulty: 'easy' | 'medium' | 'hard';
    includeSpeaking: boolean;
    includeWriting: boolean;
  }): Promise<ToeicSpeakingWritingDraft> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.generateToeicSpeakingWritingDraft) {
      throw new BadRequestException(
        'Nhà cung cấp AI hiện tại chưa hỗ trợ tạo đề TOEIC Speaking/Writing',
      );
    }
    return this.aiEvaluator.generateToeicSpeakingWritingDraft(input);
  }

  async generateDictation(topic: string, count: number): Promise<any[]> {
    return this.aiEvaluator.generateDictation(topic, count);
  }

  async generateTtsAudio(text: string): Promise<Buffer | null> {
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    if (!azureKey || !azureRegion) {
      this.logger.warn('Thiếu AZURE_SPEECH_KEY. Bỏ qua tạo Audio.');
      return null;
    }

    try {
      const endpoint = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='en-US'>
  <voice xml:lang='en-US' xml:gender='Female' name='en-US-JennyNeural'>
    ${text}
  </voice>
</speak>`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'BreadtransKLTN',
        },
        body: ssml,
      });

      if (!response.ok) {
        this.logger.error(`Azure TTS failed: ${response.statusText}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      this.logger.error('Error in Azure TTS:', e);
      return null;
    }
  }

  /** Authoring-only TOEIC Listening TTS. The stored transcript remains the
   * source of truth; speaker labels are mapped deterministically to voices so
   * a Part 3 conversation is not flattened into one random voice. */
  async generateToeicListeningAudio(transcript: string): Promise<Buffer> {
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    if (!azureKey || !azureRegion) {
      throw new Error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
    }
    try {
      const response = await fetch(
        `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': azureKey,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
            'User-Agent': 'BreadTransToeicAuthoring',
          },
          body: buildToeicListeningSsml(transcript),
        },
      );
      return normalizeAzureSpeechResponse(response);
    } catch (error) {
      this.logger.error('Không thể tạo TOEIC Listening audio', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async generateVietnameseTtsAudio(
    text: string,
    voiceName: string = 'vi-VN-HoaiMyNeural',
  ): Promise<Buffer | null> {
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    if (!azureKey || !azureRegion) {
      this.logger.warn('Thiếu AZURE_SPEECH_KEY. Bỏ qua tạo Audio tiếng Việt.');
      return null;
    }

    try {
      const endpoint = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='vi-VN'>
  <voice xml:lang='vi-VN' xml:gender='Female' name='${voiceName}'>
    ${text}
  </voice>
</speak>`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'BreadtransKLTN',
        },
        body: ssml,
      });

      if (!response.ok) {
        this.logger.error(
          `Azure Vietnamese TTS failed: ${response.statusText}`,
        );
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      this.logger.error('Error in Azure Vietnamese TTS:', e);
      return null;
    }
  }

  async evaluateWritingPart1(
    imageUrl: string,
    keywords: string[],
    userSentence: string,
  ): Promise<{ score: number; feedback: string }> {
    return this.aiEvaluator.evaluateWritingPart1(
      imageUrl,
      keywords,
      userSentence,
    );
  }

  async evaluateWritingPart2(
    emailPrompt: string,
    userResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    return this.aiEvaluator.evaluateWritingPart2(emailPrompt, userResponse);
  }

  async evaluateWritingPart3(
    essayTopic: string,
    userEssay: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    return this.aiEvaluator.evaluateWritingPart3(essayTopic, userEssay);
  }

  async evaluateSpeakingPart3To5(
    promptText: string,
    studentResponse: string,
  ): Promise<{ score: number; feedback: string; suggestions: string[] }> {
    return this.aiEvaluator.evaluateSpeakingPart3To5(
      promptText,
      studentResponse,
    );
  }

  async importEtsPdf(
    pdfBuffer: Buffer,
    pdfMimeType: string,
    audioBuffer?: Buffer,
    audioMimeType?: string,
    audioUrl?: string,
  ): Promise<any[]> {
    return this.aiEvaluator.importEtsPdf(
      pdfBuffer,
      pdfMimeType,
      audioBuffer,
      audioMimeType,
      audioUrl,
    );
  }

  async generateSmartContentFromDocument(
    documentText: string,
    options?: { quizCount?: number; flashcardCount?: number },
  ) {
    return this.aiEvaluator.generateSmartContentFromDocument(
      documentText,
      options,
    );
  }

  async suggestVocabWord(input: {
    word: string;
    context?: string;
    level?: string;
  }): Promise<ContextualVocabSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestVocabWord) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý từ vựng',
      );
    }
    return this.aiEvaluator.suggestVocabWord(input);
  }

  async suggestGrammarQuestions(input: {
    topicTitle: string;
    level: string;
    theory?: string;
    keyFormula?: string;
    count: number;
  }): Promise<ContextualGrammarSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestGrammarQuestions) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu hỏi ngữ pháp',
      );
    }
    return this.aiEvaluator.suggestGrammarQuestions(input);
  }

  async suggestReadingPassage(input: {
    topic: string;
    level: string;
    targetLength?: number;
    microSkill?: string;
  }): Promise<ContextualReadingPassageSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestReadingPassage) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý đoạn đọc',
      );
    }
    return this.aiEvaluator.suggestReadingPassage(input);
  }

  async suggestReadingQuestions(input: {
    passage: string;
    level?: string;
    count: number;
  }): Promise<ContextualReadingQuestionsSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestReadingQuestions) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu hỏi đọc hiểu',
      );
    }
    return this.aiEvaluator.suggestReadingQuestions(input);
  }

  async suggestToeicPart5(input: {
    topic?: string;
    level?: string;
    grammarFocus?: string;
    vocabularyFocus?: string;
    count: number;
  }): Promise<ContextualToeicPart5Suggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestToeicPart5) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu hỏi TOEIC Part 5',
      );
    }
    return this.aiEvaluator.suggestToeicPart5(input);
  }

  async suggestCourseCurriculum(input: {
    courseTitle: string;
    level?: string;
    description?: string;
    targetLessonCount: number;
    existingLessonTitles?: string[];
  }): Promise<ContextualCourseCurriculumSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestCourseCurriculum) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý chương trình học',
      );
    }
    return this.aiEvaluator.suggestCourseCurriculum(input);
  }

  async suggestCourseLessonContent(input: {
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
  }): Promise<ContextualCourseLessonContentSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestCourseLessonContent) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ soạn nội dung bài học',
      );
    }
    return this.aiEvaluator.suggestCourseLessonContent(input);
  }

  async suggestCourseSectionRefinement(input: {
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
  }): Promise<ContextualCourseLessonSectionSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestCourseSectionRefinement) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ tinh chỉnh mục nội dung',
      );
    }
    return this.aiEvaluator.suggestCourseSectionRefinement(input);
  }

  async suggestListeningContent(input: {
    mode: 'DIALOGUE' | 'DICTATION';
    level?: string;
    topic?: string;
    currentText?: string;
    currentTurns?: Array<{
      speaker: string;
      text: string;
      translation?: string;
    }>;
  }): Promise<ContextualListeningContentSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestListeningContent) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý nội dung nghe',
      );
    }
    return this.aiEvaluator.suggestListeningContent(input);
  }

  async suggestListeningQuestions(input: {
    mode: 'DIALOGUE' | 'DICTATION';
    sourceText: string;
    level?: string;
    count: number;
  }): Promise<ContextualListeningQuestionsSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestListeningQuestions) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ tạo câu hỏi nghe',
      );
    }
    return this.aiEvaluator.suggestListeningQuestions(input);
  }

  async suggestWritingTask(input: {
    taskType: string;
    level?: string;
    topic?: string;
    currentPrompt?: string;
    wordMin?: number;
    wordMax?: number;
  }): Promise<ContextualWritingTaskSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestWritingTask) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý đề bài Writing',
      );
    }
    return this.aiEvaluator.suggestWritingTask(input);
  }

  async suggestSpeakingPracticeSet(input: {
    topic: string;
    level: string;
    category: string;
    categoryContext?: import('./strategies/ai-evaluator.interface').SpeakingCategoryAiContext;
    currentTitle?: string;
    currentDescription?: string;
  }): Promise<ContextualSpeakingPracticeSetSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestSpeakingPracticeSet) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý bộ luyện nói',
      );
    }
    return this.aiEvaluator.suggestSpeakingPracticeSet(input);
  }

  async suggestSpeakingExercises(input: {
    practiceSetTitle: string;
    practiceSetDescription?: string;
    level: string;
    category: string;
    categoryContext?: import('./strategies/ai-evaluator.interface').SpeakingCategoryAiContext;
    currentTitle?: string;
    currentTargetText?: string;
    taskType?: SpeakingTaskType;
    existingExerciseTitles?: string[];
    count: number;
  }): Promise<ContextualSpeakingExercisesSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestSpeakingExercises) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ gợi ý câu luyện nói',
      );
    }
    return this.aiEvaluator.suggestSpeakingExercises(input);
  }

  async suggestSpeakingFullDraft(input: {
    topic: string;
    level: string;
    category: string;
    categoryContext?: import('./strategies/ai-evaluator.interface').SpeakingCategoryAiContext;
    objective?: string;
    taskType?: SpeakingTaskType;
    count: number;
  }): Promise<ContextualSpeakingFullDraftSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestSpeakingFullDraft) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ soạn bộ luyện nói',
      );
    }
    return this.aiEvaluator.suggestSpeakingFullDraft(input);
  }

  async suggestListeningFullDraft(input: {
    topic: string;
    level?: string;
    mode: 'DIALOGUE' | 'DICTATION';
    count: number;
  }): Promise<ContextualListeningFullDraftSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestListeningFullDraft) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ soạn bài nghe',
      );
    }
    return this.aiEvaluator.suggestListeningFullDraft(input);
  }

  async suggestReadingFullDraft(input: {
    topic: string;
    level: string;
    targetLength?: number;
    microSkill?: string;
    count: number;
  }): Promise<ContextualReadingFullDraftSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestReadingFullDraft) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ soạn bài đọc',
      );
    }
    return this.aiEvaluator.suggestReadingFullDraft(input);
  }

  async suggestVocabFullDraft(input: {
    topic: string;
    level?: string;
    context?: string;
    count: number;
  }): Promise<ContextualVocabFullDraftSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestVocabFullDraft) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ soạn chủ đề từ vựng',
      );
    }
    return this.aiEvaluator.suggestVocabFullDraft(input);
  }

  async suggestGrammarFullDraft(input: {
    topicTitle: string;
    level: string;
    objective?: string;
    count: number;
  }): Promise<ContextualGrammarFullDraftSuggestion> {
    await this.checkAndIncrementDailyQuota();
    if (!this.aiEvaluator.suggestGrammarFullDraft) {
      throw new BadRequestException(
        'Chiến lược AI hiện tại không hỗ trợ soạn bài ngữ pháp',
      );
    }
    return this.aiEvaluator.suggestGrammarFullDraft(input);
  }
}
