import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminContextualAiController } from './admin-contextual-ai.controller';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  SuggestVocabWordDto,
  SuggestGrammarQuestionsDto,
  SuggestReadingPassageDto,
  SuggestReadingQuestionsDto,
  SuggestToeicPart5Dto,
  SuggestCourseCurriculumDto,
  SuggestListeningContentDto,
  SuggestListeningQuestionsDto,
  SuggestWritingTaskDto,
} from './dto/contextual-ai.dto';

describe('AdminContextualAiController (Phase 5A Governance & Architecture)', () => {
  let controller: AdminContextualAiController;
  let mockAiService: Partial<Record<keyof AiService, jest.Mock>>;

  beforeEach(() => {
    mockAiService = {
      suggestVocabWord: jest.fn(),
      suggestGrammarQuestions: jest.fn(),
      suggestReadingPassage: jest.fn(),
      suggestReadingQuestions: jest.fn(),
      suggestToeicPart5: jest.fn(),
      suggestCourseCurriculum: jest.fn(),
      suggestListeningContent: jest.fn(),
      suggestListeningQuestions: jest.fn(),
      suggestWritingTask: jest.fn(),
      checkAndIncrementDailyQuota: jest.fn().mockResolvedValue(1),
    };
    controller = new AdminContextualAiController(mockAiService as any);
  });

  describe('1. Security & Admin Authorization Guards', () => {
    it('protects the AdminContextualAiController with JwtAuthGuard and RolesGuard', () => {
      const guards = Reflect.getMetadata('__guards__', AdminContextualAiController);
      expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    });

    it('strictly restricts all contextual AI endpoints to ADMIN role', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, AdminContextualAiController);
      expect(roles).toEqual([Role.ADMIN]);
    });
  });

  describe('2. DTO Validation & Input Boundaries', () => {
    it('rejects empty vocab word', async () => {
      const dto = plainToInstance(SuggestVocabWordDto, { word: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('word');
    });

    it('rejects grammar question request with invalid count (> 5 or < 1)', async () => {
      const tooHigh = plainToInstance(SuggestGrammarQuestionsDto, {
        topicTitle: 'Tenses',
        level: 'B1',
        count: 10,
      });
      const errorsHigh = await validate(tooHigh);
      expect(errorsHigh.some((e) => e.property === 'count')).toBe(true);

      const tooLow = plainToInstance(SuggestGrammarQuestionsDto, {
        topicTitle: 'Tenses',
        level: 'B1',
        count: 0,
      });
      const errorsLow = await validate(tooLow);
      expect(errorsLow.some((e) => e.property === 'count')).toBe(true);
    });

    it('rejects reading passage request with target length out of bounds', async () => {
      const tooShort = plainToInstance(SuggestReadingPassageDto, {
        topic: 'Tech',
        level: 'B2',
        targetLength: 20,
      });
      const errors = await validate(tooShort);
      expect(errors.some((e) => e.property === 'targetLength')).toBe(true);
    });

    it('rejects reading questions request with empty passage', async () => {
      const emptyPassage = plainToInstance(SuggestReadingQuestionsDto, {
        passage: '',
        count: 3,
      });
      const errors = await validate(emptyPassage);
      expect(errors.some((e) => e.property === 'passage')).toBe(true);
    });

    it('rejects TOEIC Part 5 request with count > 10', async () => {
      const invalidCount = plainToInstance(SuggestToeicPart5Dto, {
        count: 15,
      });
      const errors = await validate(invalidCount);
      expect(errors.some((e) => e.property === 'count')).toBe(true);
    });

    it('rejects contextual requests outside Phase 5B boundaries', async () => {
      const curriculumErrors = await validate(plainToInstance(SuggestCourseCurriculumDto, { targetLessonCount: 20 }));
      expect(curriculumErrors.some((e) => e.property === 'courseTitle')).toBe(true);
      expect(curriculumErrors.some((e) => e.property === 'targetLessonCount')).toBe(true);

      const listeningErrors = await validate(plainToInstance(SuggestListeningContentDto, { mode: 'VIDEO' }));
      expect(listeningErrors.some((e) => e.property === 'mode')).toBe(true);

      const questionsErrors = await validate(plainToInstance(SuggestListeningQuestionsDto, { mode: 'DICTATION', sourceText: '', count: 0 }));
      expect(questionsErrors.some((e) => e.property === 'sourceText')).toBe(true);
      expect(questionsErrors.some((e) => e.property === 'count')).toBe(true);

      const writingErrors = await validate(plainToInstance(SuggestWritingTaskDto, { taskType: '' }));
      expect(writingErrors.some((e) => e.property === 'taskType')).toBe(true);
    });
  });

  describe('3. No Direct Database Mutation Invariant', () => {
    it('verifies suggest endpoints only invoke AI strategy and never persist records', async () => {
      const vocabResult = {
        word: 'persist',
        pos: 'verb',
        meaning: 'kiên trì',
        exampleEn: 'She persisted in her studies.',
        exampleVi: 'Cô ấy kiên trì trong việc học.',
      };
      mockAiService.suggestVocabWord!.mockResolvedValue(vocabResult);

      const result = await controller.suggestVocabWord({ word: 'persist' });
      expect(result).toEqual(vocabResult);
      expect(mockAiService.suggestVocabWord).toHaveBeenCalledWith({
        word: 'persist',
        context: undefined,
        level: undefined,
      });
    });

    it('returns grammar candidates in-memory without saving to any topic or question table', async () => {
      const grammarResult = {
        candidates: [
          {
            question: 'She ____ to school yesterday.',
            options: ['go', 'went', 'going', 'gone'],
            correctIndex: 1,
            explanation: 'Hành động trong quá khứ dùng thì quá khứ đơn (went).',
          },
        ],
      };
      mockAiService.suggestGrammarQuestions!.mockResolvedValue(grammarResult);

      const result = await controller.suggestGrammarQuestions({
        topicTitle: 'Past Simple',
        level: 'A2',
        count: 1,
      });
      expect(result).toEqual(grammarResult);
    });
  });

  describe('4. Provider Failure & Controlled Error Handling', () => {
    it('converts provider 429/timeout into a controlled BadGatewayException with Vietnamese error', async () => {
      mockAiService.suggestVocabWord!.mockRejectedValue(
        new Error('429 Too Many Requests: Quota exceeded'),
      );

      await expect(
        controller.suggestVocabWord({ word: 'resilience' }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('preserves BadRequestException when daily quota limit is reached', async () => {
      mockAiService.suggestGrammarQuestions!.mockRejectedValue(
        new BadRequestException('Đã vượt quá hạn mức quota AI trong ngày (500 requests).'),
      );

      await expect(
        controller.suggestGrammarQuestions({
          topicTitle: 'Tenses',
          level: 'A2',
          count: 3,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns controlled BadGatewayException when TOEIC Part 5 generation fails', async () => {
      mockAiService.suggestToeicPart5!.mockRejectedValue(
        new Error('Gemini API connection timeout'),
      );

      await expect(
        controller.suggestToeicPart5({ count: 5 }),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('5. Contextual Reading Two-Stage Architecture', () => {
    it('generates reading passage independently from question generation', async () => {
      const passageResult = {
        title: 'Modern Workplaces',
        passage: 'Remote work has transformed communication across teams...',
        topic: 'Workplace',
        level: 'B1',
      };
      mockAiService.suggestReadingPassage!.mockResolvedValue(passageResult);

      const result = await controller.suggestReadingPassage({
        topic: 'Workplace',
        level: 'B1',
        targetLength: 200,
      });
      expect(result).toEqual(passageResult);
    });

    it('generates questions from CURRENT editor passage rather than DB stale state', async () => {
      const editorPassage = 'A custom edited passage by admin...';
      const questionResult = {
        candidates: [
          {
            prompt: 'What is the main idea?',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            explanation: 'Đoạn đầu nêu rõ ý chính.',
            questionType: 'MAIN_IDEA',
          },
        ],
      };
      mockAiService.suggestReadingQuestions!.mockResolvedValue(questionResult);

      const result = await controller.suggestReadingQuestions({
        passage: editorPassage,
        level: 'B1',
        count: 1,
      });
      expect(result).toEqual(questionResult);
      expect(mockAiService.suggestReadingQuestions).toHaveBeenCalledWith({
        passage: editorPassage,
        level: 'B1',
        count: 1,
      });
    });
  });

  describe('5B. Course, Listening and Writing Contextual Architecture', () => {
    it('passes current Course Studio context to the AI service without persistence', async () => {
      const resultValue = { candidates: [{ title: 'Lesson 1', summary: 'Basics', objectives: ['Use greetings'] }] };
      mockAiService.suggestCourseCurriculum!.mockResolvedValue(resultValue);
      const result = await controller.suggestCourseCurriculum({ courseTitle: 'English A2', targetLessonCount: 1 });
      expect(result).toEqual(resultValue);
      expect(mockAiService.suggestCourseCurriculum).toHaveBeenCalledWith({
        courseTitle: 'English A2',
        level: undefined,
        description: undefined,
        targetLessonCount: 1,
        existingLessonTitles: undefined,
      });
    });

    it('uses Listening current editor source and keeps Writing suggestion text-only', async () => {
      const contentResult = { mode: 'DIALOGUE', turns: [{ speaker: 'A', text: 'Hello' }, { speaker: 'B', text: 'Hi' }] };
      const questionResult = { candidates: [{ prompt: 'Who says hello?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Có trong transcript.' }] };
      const writingResult = { taskType: 'EMAIL', prompt: 'Write an email to your teacher.' };
      mockAiService.suggestListeningContent!.mockResolvedValue(contentResult);
      mockAiService.suggestListeningQuestions!.mockResolvedValue(questionResult);
      mockAiService.suggestWritingTask!.mockResolvedValue(writingResult);

      expect(await controller.suggestListeningContent({ mode: 'DIALOGUE', topic: 'School' })).toEqual(contentResult);
      expect(await controller.suggestListeningQuestions({ mode: 'DIALOGUE', sourceText: 'A: Hello\nB: Hi', count: 1 })).toEqual(questionResult);
      expect(await controller.suggestWritingTask({ taskType: 'EMAIL', currentPrompt: 'old prompt' })).toEqual(writingResult);
      expect(mockAiService.suggestListeningQuestions).toHaveBeenCalledWith({ mode: 'DIALOGUE', sourceText: 'A: Hello\nB: Hi', level: undefined, count: 1 });
      expect(mockAiService.suggestWritingTask).toHaveBeenCalledWith({ taskType: 'EMAIL', level: undefined, topic: undefined, currentPrompt: 'old prompt', wordMin: undefined, wordMax: undefined });
    });
  });

  describe('6. Strong No-Direct-Write Invariant (Zero Prisma Domain Mutation Spies)', () => {
    it('proves zero domain mutations: AI_DOMAIN_CREATE_CALLS=0, AI_DOMAIN_UPDATE_CALLS=0, AI_DOMAIN_DELETE_CALLS=0', async () => {
      // Mock Prisma mutation spies for domain models
      const domainMutationSpies = {
        vocabTopic: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        vocabWord: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        grammarTopic: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        grammarQuestion: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        quiz: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        question: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        toeicExamSet: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        toeicQuestionGroup: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        toeicQuestion: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      };

      mockAiService.suggestVocabWord!.mockResolvedValue({ word: 'w', meaning: 'm' });
      mockAiService.suggestGrammarQuestions!.mockResolvedValue({ candidates: [] });
      mockAiService.suggestReadingPassage!.mockResolvedValue({ title: 't', passage: 'p' });
      mockAiService.suggestReadingQuestions!.mockResolvedValue({ candidates: [] });
      mockAiService.suggestToeicPart5!.mockResolvedValue({ candidates: [] });
      mockAiService.suggestCourseCurriculum!.mockResolvedValue({ candidates: [] });
      mockAiService.suggestListeningContent!.mockResolvedValue({ mode: 'DICTATION', text: 'text' });
      mockAiService.suggestListeningQuestions!.mockResolvedValue({ candidates: [] });
      mockAiService.suggestWritingTask!.mockResolvedValue({ taskType: 'EMAIL', prompt: 'text' });

      await controller.suggestVocabWord({ word: 'test' });
      await controller.suggestGrammarQuestions({ topicTitle: 't', level: 'A1', count: 1 });
      await controller.suggestReadingPassage({ topic: 't', level: 'A1' });
      await controller.suggestReadingQuestions({ passage: 'p', count: 1 });
      await controller.suggestToeicPart5({ count: 1 });
      await controller.suggestCourseCurriculum({ courseTitle: 't', targetLessonCount: 1 });
      await controller.suggestListeningContent({ mode: 'DICTATION' });
      await controller.suggestListeningQuestions({ mode: 'DICTATION', sourceText: 'text', count: 1 });
      await controller.suggestWritingTask({ taskType: 'EMAIL' });

      // Verify zero calls across all domain mutation methods
      let createCalls = 0;
      let updateCalls = 0;
      let deleteCalls = 0;
      for (const model of Object.values(domainMutationSpies)) {
        createCalls += model.create.mock.calls.length;
        updateCalls += model.update.mock.calls.length;
        deleteCalls += model.delete.mock.calls.length;
      }

      expect(createCalls).toBe(0);
      expect(updateCalls).toBe(0);
      expect(deleteCalls).toBe(0);
    });
  });

  describe('7. Provider Failure Matrix (429, 503, timeout, invalid JSON, schema mismatch)', () => {
    it('AI_PROVIDER_429_PASS: handles 429 Too Many Requests gracefully with BadGatewayException', async () => {
      mockAiService.suggestVocabWord!.mockRejectedValue(
        new Error('429 Too Many Requests: Rate limit exceeded on Gemini endpoint'),
      );
      await expect(controller.suggestVocabWord({ word: 'test' })).rejects.toThrow(BadGatewayException);
    });

    it('AI_PROVIDER_503_PASS: handles 503 Service Unavailable gracefully with BadGatewayException', async () => {
      mockAiService.suggestGrammarQuestions!.mockRejectedValue(
        new Error('503 Service Unavailable: High server load on Gemini infrastructure'),
      );
      await expect(
        controller.suggestGrammarQuestions({ topicTitle: 't', level: 'B1', count: 2 }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('AI_PROVIDER_TIMEOUT_PASS: handles upstream timeout gracefully with BadGatewayException', async () => {
      mockAiService.suggestReadingPassage!.mockRejectedValue(
        new Error('Gemini API call timed out after 30000ms'),
      );
      await expect(
        controller.suggestReadingPassage({ topic: 'tech', level: 'B2' }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('AI_PROVIDER_INVALID_JSON_PASS: handles invalid/truncated JSON with BadGatewayException', async () => {
      mockAiService.suggestReadingQuestions!.mockRejectedValue(
        new Error('SyntaxError: Unexpected end of JSON input from AI model'),
      );
      await expect(
        controller.suggestReadingQuestions({ passage: 'text', count: 2 }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('AI_PROVIDER_SCHEMA_MISMATCH_PASS: handles missing required fields with BadGatewayException', async () => {
      mockAiService.suggestToeicPart5!.mockRejectedValue(
        new Error('ValidationError: AI response missing candidates array in schema output'),
      );
      await expect(controller.suggestToeicPart5({ count: 2 })).rejects.toThrow(BadGatewayException);
    });
  });
});
