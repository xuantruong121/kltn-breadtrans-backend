import { ForbiddenException } from '@nestjs/common';
import { QuizPublicationStatus, Role, QuizType } from '@prisma/client';
import { validate } from 'class-validator';
import { SkillCmsService } from './skill-cms.service';
import {
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
} from './skill-cms.dto';

describe('SkillCmsService', () => {
  const admin = { id: 7, role: Role.ADMIN };

  it('requires an admin for domain content access', async () => {
    const service = new SkillCmsService({} as any);
    await expect(
      service.list('reading', { id: 1, role: Role.STUDENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps new quiz content in DRAFT and binds it to the domain type', async () => {
    const prisma = {
      quiz: {
        create: jest.fn().mockResolvedValue({
          id: 11,
          publicationStatus: QuizPublicationStatus.DRAFT,
          type: QuizType.BILINGUAL_READING,
        }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    await service.create('reading', { title: 'QA Reading' }, admin);
    expect(prisma.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: QuizType.BILINGUAL_READING,
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
  });

  it('rejects a Reading publish preflight with an invalid answer index', async () => {
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue({
          id: 12,
          title: 'Reading A2 — Notices',
          theoryContent: 'Passage',
          questions: [
            {
              id: 1,
              type: 'MULTIPLE_CHOICE',
              content: { options: ['A'], correctIndex: 2 },
              order: 0,
            },
          ],
          _count: { submissions: 0 },
        }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    const result = await service.validate('reading', '12', admin);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe(
      'Câu 1: chưa đủ phương án hoặc chưa chọn đáp án đúng',
    );
  });

  describe('editing a Listening question', () => {
    const setup = (content: Record<string, unknown>) => {
      const prisma = {
        question: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 5, type: 'MULTIPLE_CHOICE', content }),
          update: jest.fn().mockResolvedValue({ id: 5 }),
        },
        submission: { count: jest.fn().mockResolvedValue(0) },
        quizAudioAsset: { updateMany: jest.fn() },
      };
      return { prisma, service: new SkillCmsService(prisma as any) };
    };

    it('retires the clip when the spoken sentence changes', async () => {
      const { prisma, service } = setup({
        audioText: 'The bus leaves at nine.',
      });
      await service.updateListeningQuestion(
        '1',
        '5',
        {
          type: 'MULTIPLE_CHOICE',
          content: { audioText: 'The bus leaves at ten.' },
        },
        admin,
      );
      expect(prisma.quizAudioAsset.updateMany).toHaveBeenCalledWith({
        where: { questionId: 5, isActive: true },
        data: { isActive: false },
      });
    });

    it('keeps the clip when only the question wording changes', async () => {
      const { prisma, service } = setup({
        audioText: 'The bus leaves at nine.',
        text: 'When?',
      });
      await service.updateListeningQuestion(
        '1',
        '5',
        { type: 'MULTIPLE_CHOICE', content: { text: 'What time?' } },
        admin,
      );
      expect(prisma.quizAudioAsset.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Listening publish needs audio a learner can play', () => {
    const mcq = (id: number, extra: Record<string, unknown> = {}) => ({
      id,
      type: 'MULTIPLE_CHOICE',
      content: { options: ['a', 'b', 'c', 'd'], correctIndex: 1, ...extra },
      audioAssets: [],
      order: id,
    });
    const turns = [
      { speaker: 'A', text: 'Hi.' },
      { speaker: 'B', text: 'Hello.' },
    ];
    const run = async (
      questions: unknown[],
      recording: unknown,
      mode?: string,
    ) => {
      const prisma = {
        quiz: {
          findFirst: jest.fn().mockResolvedValue({
            id: 58,
            title: 'Hội thoại C1 — A visit',
            ...(mode ? { bilingualContent: { mode } } : {}),
            questions,
            _count: { submissions: 0 },
          }),
        },
      };
      const authoring = {
        getCurrentPublishedArtifact: jest.fn().mockResolvedValue(recording),
      };
      const service = new SkillCmsService(prisma as any, authoring as any);
      return service.validate('listening', '58', admin);
    };

    it('refuses a dialogue quiz with no recording and no clips', async () => {
      const result = await run(
        [
          mcq(1, { transcriptSegments: turns }),
          mcq(2, { transcriptSegments: turns }),
        ],
        null,
      );
      expect(result.errors).toEqual([
        'Câu 1: chưa có audio cho học viên',
        'Câu 2: chưa có audio cho học viên',
      ]);
    });

    it('accepts a dialogue quiz whose conversation recording is published', async () => {
      const result = await run([mcq(1, { transcriptSegments: turns })], {
        id: 3,
        version: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('needs a clip per question when questions do not share a conversation', async () => {
      const result = await run(
        [
          {
            ...mcq(1, { audioText: 'The bus leaves at nine.' }),
            audioAssets: [{ isActive: true }],
          },
          mcq(2, { audioText: 'The shop is closed.' }),
        ],
        { id: 3, version: 1 },
      );
      expect(result.errors).toEqual(['Câu 2: chưa có audio cho học viên']);
    });

    // QA 2026-11-22: a hand-made dialogue keeps its turns in a DIALOGUE
    // question; it is neither counted nor numbered as a question.
    it('does not count the transcript holder as a question', async () => {
      const holder = {
        id: 1,
        type: 'DIALOGUE',
        content: { transcriptSegments: turns },
        audioAssets: [],
        order: 0,
      };
      const onlyTurns = await run([holder], { id: 3, version: 1 });
      expect(onlyTurns.errors).toEqual(['Cần ít nhất một câu hỏi']);
      const withQuestion = await run(
        [holder, mcq(2, { transcriptSegments: turns, correctIndex: 9 })],
        { id: 3, version: 1 },
      );
      expect(withQuestion.errors).toEqual([
        'Câu 1: chưa đủ phương án hoặc chưa chọn đáp án đúng',
      ]);
      const badTurns = await run(
        [
          { ...holder, content: { transcriptSegments: [turns[0]] } },
          mcq(2, { transcriptSegments: turns }),
        ],
        { id: 3, version: 1 },
      );
      expect(badTurns.errors).toContain(
        'Lời thoại: cần ít nhất 2 lượt lời của 2 người nói',
      );
    });

    // A hand-made "Hội thoại" now has the published shape: one conversation
    // in every question, no holder, and the shared recording.
    describe('a "Hội thoại" quiz in the published shape', () => {
      it('publishes with its conversation in every question and a recording', async () => {
        const result = await run(
          [
            mcq(1, { transcriptSegments: turns }),
            mcq(2, { transcriptSegments: turns }),
          ],
          { id: 3, version: 1 },
          'DIALOGUE',
        );
        expect(result).toMatchObject({ valid: true, errors: [] });
      });

      it('needs 2 turns by 2 speakers, a choice question and audio', async () => {
        const oneSpeaker = await run(
          [
            mcq(1, {
              transcriptSegments: [
                { speaker: 'A', text: 'Hi.' },
                { speaker: 'A', text: 'Again.' },
              ],
            }),
          ],
          { id: 3, version: 1 },
          'DIALOGUE',
        );
        expect(oneSpeaker.errors).toEqual([
          'Lời thoại: cần ít nhất 2 lượt lời của 2 người nói',
        ]);
        // No conversation anywhere: nothing to record, nothing to hear.
        const silent = await run([mcq(1)], null, 'DIALOGUE');
        expect(silent.errors).toEqual([
          'Lời thoại: cần ít nhất 2 lượt lời của 2 người nói',
          'Câu 1: chưa có audio cho học viên',
        ]);
        const noChoice = await run(
          [
            {
              id: 1,
              type: 'DICTATION',
              content: { correctAnswer: 'Hi.', transcriptSegments: turns },
              audioAssets: [{ isActive: true }],
              order: 1,
            },
          ],
          { id: 3, version: 1 },
          'DIALOGUE',
        );
        expect(noChoice.errors).toContain('Cần ít nhất một câu trắc nghiệm');
      });

      it('accepts a clip on every question instead of the recording', async () => {
        const clipped = (id: number) => ({
          ...mcq(id, { transcriptSegments: turns }),
          audioAssets: [{ isActive: true }],
        });
        expect(
          await run([clipped(1), clipped(2)], null, 'DIALOGUE'),
        ).toMatchObject({ valid: true });
      });

      it('still checks a legacy holder as its own row', async () => {
        const holder = {
          id: 1,
          type: 'DIALOGUE',
          content: { transcriptSegments: turns },
          audioAssets: [],
          order: 0,
        };
        const result = await run(
          [holder, mcq(2)],
          { id: 3, version: 1 },
          'DIALOGUE',
        );
        // The holder plays the recording; the question carries no turns.
        expect(result.errors).toEqual(['Câu 1: chưa có audio cho học viên']);
      });
    });

    describe('the draft conversation on the quiz', () => {
      const draft = {
        mode: 'DIALOGUE',
        levels: ['B1'],
        draftTranscript: turns,
      };

      it('is dropped when the quiz is published', async () => {
        const prisma = {
          quiz: {
            findFirst: jest.fn().mockResolvedValue({
              id: 58,
              title: 'Hội thoại B1 — A visit',
              bilingualContent: draft,
              questions: [mcq(1, { transcriptSegments: turns })],
              _count: { submissions: 0 },
            }),
            findUnique: jest
              .fn()
              .mockResolvedValue({ bilingualContent: draft }),
            update: jest.fn().mockResolvedValue({ id: 58 }),
          },
          contentTrackTag: { findMany: jest.fn().mockResolvedValue([]) },
          toeicWritingSetItem: { count: jest.fn().mockResolvedValue(0) },
        };
        const authoring = {
          getCurrentPublishedArtifact: jest
            .fn()
            .mockResolvedValue({ id: 3, version: 1 }),
        };
        await new SkillCmsService(prisma as any, authoring as any).publish(
          'listening',
          '58',
          QuizPublicationStatus.PUBLISHED,
          admin,
        );
        expect(
          prisma.quiz.update.mock.calls[0][0].data.bilingualContent,
        ).toEqual({ mode: 'DIALOGUE', levels: ['B1'] });
      });

      it('is kept on a draft, and dropped on a published quiz save', async () => {
        const save = async (publicationStatus: QuizPublicationStatus) => {
          const prisma = {
            quiz: {
              findFirst: jest.fn().mockResolvedValue({
                id: 58,
                title: 'Hội thoại B1 — A visit',
                type: QuizType.LISTENING_PRACTICE,
                publicationStatus,
                bilingualContent: { mode: 'DIALOGUE' },
              }),
              update: jest.fn().mockResolvedValue({ id: 58 }),
            },
            submission: { count: jest.fn().mockResolvedValue(0) },
            toeicWritingSetItem: { count: jest.fn().mockResolvedValue(0) },
          };
          await new SkillCmsService(prisma as any).update(
            'listening',
            '58',
            { title: 'A visit', bilingualContent: draft },
            admin,
          );
          return prisma.quiz.update.mock.calls[0][0].data.bilingualContent;
        };
        expect(await save(QuizPublicationStatus.DRAFT)).toEqual(draft);
        expect(await save(QuizPublicationStatus.PUBLISHED)).toEqual({
          mode: 'DIALOGUE',
          levels: ['B1'],
        });
      });
    });

    it('lists a hand-made dialogue with its answered questions only', async () => {
      const prisma = {
        quiz: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 5,
              title: 'Hội thoại B1 — At the clinic',
              type: QuizType.LISTENING_PRACTICE,
              bilingualContent: { mode: 'DIALOGUE' },
              _count: { questions: 4, submissions: 0 },
              listeningAudioArtifacts: [],
            },
          ]),
        },
        question: {
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn(({ where }: { where: { type?: unknown } }) =>
            Promise.resolve(
              where.type === 'DIALOGUE'
                ? [{ quizId: 5, _count: { _all: 1 } }]
                : [],
            ),
          ),
        },
        contentTrackTag: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const page: any = await new SkillCmsService(prisma as any).list(
        'listening',
        admin,
        { page: '1' },
      );
      expect(page.items[0]._count.questions).toBe(3);
    });

    // Review 2026-11-22: a hand-made dialogue keeps its clip on the holder;
    // the card read "Chưa có audio" with the audio there.
    describe('the audio of a hand-made dialogue', () => {
      const listWith = async (
        artifacts: unknown[],
        activeClips: Array<{ type: string; count: number }>,
      ) => {
        const prisma = {
          quiz: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 5,
                title: 'Hội thoại B1 — At the clinic',
                type: QuizType.LISTENING_PRACTICE,
                bilingualContent: { mode: 'DIALOGUE' },
                _count: { questions: 4, submissions: 0 },
                listeningAudioArtifacts: artifacts,
              },
            ]),
          },
          question: {
            findMany: jest.fn().mockResolvedValue([]),
            groupBy: jest.fn(
              ({ by, where }: { by: string[]; where: { type?: unknown } }) =>
                Promise.resolve(
                  by.includes('type')
                    ? activeClips.map((clip) => ({
                        quizId: 5,
                        type: clip.type,
                        _count: { _all: clip.count },
                      }))
                    : where.type === 'DIALOGUE'
                      ? [{ quizId: 5, _count: { _all: 1 } }]
                      : [],
                ),
            ),
          },
          contentTrackTag: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const service = new SkillCmsService(prisma as any);
        const all: any = await service.list('listening', admin, { page: '1' });
        const ready: any = await service.list('listening', admin, {
          page: '1',
          audio: 'ok',
        });
        return {
          row: all.items[0],
          readyIds: ready.items.map((r: any) => r.id),
        };
      };

      it('reads as ready when the holder has an active clip', async () => {
        const { row, readyIds } = await listWith(
          [],
          [{ type: 'DIALOGUE', count: 1 }],
        );
        expect(row).toMatchObject({
          dialogueAudio: true,
          questionsWithAudio: 0,
          _count: { questions: 3 },
        });
        expect(readyIds).toEqual([5]);
      });

      it('reads as no audio when the holder has none', async () => {
        const { row, readyIds } = await listWith([], []);
        expect(row.dialogueAudio).toBe(false);
        expect(readyIds).toEqual([]);
      });

      it('follows the shared recording when there is one', async () => {
        const { readyIds } = await listWith(
          [{ version: 1, status: 'PREVIEW_READY' }],
          [{ type: 'DIALOGUE', count: 1 }],
        );
        expect(readyIds).toEqual([]);
      });

      it('counts question clips without the holder', async () => {
        const { row } = await listWith(
          [],
          [
            { type: 'DIALOGUE', count: 1 },
            { type: 'MULTIPLE_CHOICE', count: 2 },
          ],
        );
        expect(row.questionsWithAudio).toBe(2);
      });
    });

    it('asks a dictation quiz for 20 sentences, in Vietnamese', async () => {
      const sentence = (id: number) => ({
        id,
        type: 'DICTATION',
        content: { correctAnswer: 'The bus leaves at nine.' },
        audioAssets: [{ isActive: true }],
        order: id,
      });
      const result = await run(
        [sentence(1), sentence(2), { ...sentence(3), content: {} }],
        null,
      );
      expect(result.errors).toEqual([
        'Bài nghe chép cần ít nhất 20 câu (đang có 3)',
        'Câu 3: chưa có câu cần chép',
      ]);
    });
  });

  it('does not let a content PATCH bypass publish preflight', async () => {
    const prisma = {
      quiz: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 13, type: QuizType.BILINGUAL_READING }),
        update: jest.fn().mockResolvedValue({ id: 13 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);
    await service.update(
      'reading',
      '13',
      {
        title: 'Reading',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
      admin,
    );
    expect(prisma.quiz.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        }),
      }),
    );
  });

  it('creates Speaking practice sets and exercises as DRAFT', async () => {
    const tx = {
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 1,
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    const prisma = {
      speakingPracticeSet: {
        create: jest.fn().mockResolvedValue({
          id: 'speaking-qa',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-qa',
          level: 'BEGINNER',
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SkillCmsService(prisma as any);

    await service.create(
      'speaking',
      {
        title: 'Speaking QA',
        publicationStatus: QuizPublicationStatus.PUBLISHED,
      },
      admin,
    );
    await service.addSpeakingExercise(
      'speaking',
      'speaking-qa',
      {
        title: 'Prompt',
        targetText: 'Good morning.',
        taskType: 'READ_ALOUD',
      },
      admin,
    );

    expect(prisma.speakingPracticeSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      }),
    );
    const exerciseData = tx.speakingExercise.create.mock.calls[0][0].data;
    expect(exerciseData).toEqual(
      expect.objectContaining({
        publicationStatus: QuizPublicationStatus.DRAFT,
      }),
    );
    // The category columns are gone (2026-11-22); Lĩnh vực sits on the set.
    expect(exerciseData).not.toHaveProperty('category');
    expect(exerciseData).not.toHaveProperty('categoryId');
  });

  it('creates a Speaking set with no category', async () => {
    const prisma = {
      speakingPracticeSet: {
        create: jest.fn().mockResolvedValue({ id: 'speaking-new' }),
      },
    };
    const service = new SkillCmsService(prisma as any);
    await service.create('speaking', { title: 'Bộ mới', level: 'B1' }, admin);
    const data = prisma.speakingPracticeSet.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        title: 'Bộ mới',
        level: 'B1',
        publicationStatus: QuizPublicationStatus.DRAFT,
      }),
    );
    expect(data).not.toHaveProperty('category');
    expect(data).not.toHaveProperty('categoryId');
  });

  it('saves a Speaking set with its title, description and level only', async () => {
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'practice-question-response-a2',
        }),
        update: jest.fn().mockResolvedValue({ id: 'set' }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);
    await service.update(
      'speaking',
      'practice-question-response-a2',
      { title: ' Phản hồi câu hỏi ', description: 'Mô tả', level: 'A2' },
      admin,
    );
    expect(prisma.speakingPracticeSet.update).toHaveBeenCalledWith({
      where: { id: 'practice-question-response-a2' },
      data: { title: 'Phản hồi câu hỏi', description: 'Mô tả', level: 'A2' },
    });
  });

  it('publishes a valid Speaking set and all of its exercises together', async () => {
    const set = {
      id: 'speaking-ready',
      title: 'Speaking Ready',
      exercises: [
        {
          id: 1,
          title: 'Prompt',
          targetText: 'Hello.',
          taskType: 'READ_ALOUD',
        },
      ],
    };
    const tx = {
      speakingPracticeSet: {
        update: jest.fn().mockResolvedValue({
          ...set,
          publicationStatus: QuizPublicationStatus.PUBLISHED,
        }),
      },
      speakingExercise: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      speakingPracticeSet: { findUnique: jest.fn().mockResolvedValue(set) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SkillCmsService(prisma as any);

    await service.publish(
      'speaking',
      'speaking-ready',
      QuizPublicationStatus.PUBLISHED,
      admin,
    );

    expect(tx.speakingPracticeSet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
    );
    expect(tx.speakingExercise.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      }),
    );
  });

  it('keeps Speaking in a TOEIC exam locked after learner history exists', async () => {
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'speaking-used' }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(1) },
      toeicAssessmentComponent: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new SkillCmsService(prisma as any);
    await expect(
      service.update('speaking', 'speaking-used', { title: 'Changed' }, admin),
    ).rejects.toThrow('nhân bản đề');
  });

  it('the five exam Speaking writes run on the transaction they are given and open none (2026-11-18)', async () => {
    const exercise = {
      id: 1,
      practiceSetId: 's1',
      taskType: 'READ_ALOUD',
      targetText: 'Good morning.',
      imageUrl: null,
      stimulusId: null,
      stimulus: null,
      practiceSet: { id: 's1' },
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1',
          level: 'BEGINNER',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      },
      speakingExercise: {
        findFirst: jest.fn().mockResolvedValue(exercise),
        findMany: jest.fn().mockResolvedValue([{ id: 1, order: 1 }]),
        create: jest.fn().mockResolvedValue({ id: 2 }),
        update: jest.fn().mockResolvedValue(exercise),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue(exercise),
      },
      speakingStimulus: { create: jest.fn().mockResolvedValue({ id: 3 }) },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
      toeicAssessmentComponent: { count: jest.fn().mockResolvedValue(0) },
    };
    // No model on the service's own client: any read or write outside the
    // given transaction fails the test.
    const prisma: any = { $transaction: jest.fn() };
    const service = new SkillCmsService(prisma);

    await service.addSpeakingExercise(
      'speaking',
      's1',
      { title: 'P', targetText: 'Good morning.', taskType: 'READ_ALOUD' },
      admin,
      tx,
    );
    await service.updateSpeakingExercise(
      'speaking',
      's1',
      '1',
      { title: 'Q' } as any,
      admin,
      tx,
    );
    await service.reorderSpeakingExercises(
      'speaking',
      's1',
      { exerciseIds: [1] },
      admin,
      tx,
    );
    await service.deleteSpeakingExercise('speaking', 's1', '1', admin, tx);
    await service.createSpeakingStimulus(
      { kind: 'INFORMATION', content: 'Lịch họp' } as any,
      admin,
      tx,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.speakingExercise.create).toHaveBeenCalled();
    expect(tx.speakingExercise.delete).toHaveBeenCalled();
    expect(tx.speakingStimulus.create).toHaveBeenCalled();
  });

  describe('editing practice that has attempts', () => {
    const question = {
      id: 8,
      quizId: 4,
      type: 'MULTIPLE_CHOICE',
      content: { options: ['A', 'B'], correctAnswer: 'A' },
    };
    const build = (examItems = 0) => {
      const prisma = {
        question: {
          findFirst: jest.fn().mockResolvedValue(question),
          update: jest.fn().mockResolvedValue(question),
          delete: jest.fn(),
          create: jest.fn(),
          count: jest.fn().mockResolvedValue(1),
        },
        quiz: {
          findFirst: jest.fn().mockResolvedValue({
            id: 4,
            type: QuizType.BILINGUAL_READING,
          }),
          update: jest.fn().mockResolvedValue({ id: 4 }),
        },
        submission: { count: jest.fn().mockResolvedValue(1) },
        toeicWritingSetItem: { count: jest.fn().mockResolvedValue(examItems) },
      };
      return { prisma, service: new SkillCmsService(prisma as any) };
    };
    const dto = (content: Record<string, unknown>) =>
      ({ type: 'MULTIPLE_CHOICE', content }) as any;

    it('saves new wording and a new answer', async () => {
      const { prisma, service } = build();
      await service.updateQuestion(
        'reading',
        '4',
        '8',
        dto({ options: ['A', 'B'], correctAnswer: 'B' }),
        admin,
      );
      expect(prisma.question.update).toHaveBeenCalled();
    });

    it('saves the title of the practice', async () => {
      const { prisma, service } = build();
      await service.update('reading', '4', { title: 'Đã sửa' }, admin);
      expect(prisma.quiz.update).toHaveBeenCalled();
    });

    it('refuses to add an option', async () => {
      const { prisma, service } = build();
      await expect(
        service.updateQuestion(
          'reading',
          '4',
          '8',
          dto({ options: ['A', 'B', 'C'], correctAnswer: 'A' }),
          admin,
        ),
      ).rejects.toThrow('lựa chọn');
      expect(prisma.question.update).not.toHaveBeenCalled();
    });

    it('still refuses to delete a question', async () => {
      const { prisma, service } = build();
      await expect(
        service.deleteQuestion('reading', '4', '8', admin),
      ).rejects.toThrow('lịch sử làm bài');
      expect(prisma.question.delete).not.toHaveBeenCalled();
    });

    it('keeps a task that belongs to a TOEIC exam locked', async () => {
      const { prisma, service } = build(1);
      await expect(
        service.updateQuestion(
          'reading',
          '4',
          '8',
          dto({ options: ['A', 'B'], correctAnswer: 'B' }),
          admin,
        ),
      ).rejects.toThrow('nhân bản đề');
      expect(prisma.question.update).not.toHaveBeenCalled();
    });
  });

  it('rejects duplicate or foreign ids in Speaking reorder requests', async () => {
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-order',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
      $transaction: jest.fn(),
    };
    const service = new SkillCmsService(prisma as any);

    await expect(
      service.reorderSpeakingExercises(
        'speaking',
        'speaking-order',
        { exerciseIds: [1, 1] },
        admin,
      ),
    ).rejects.toThrow('đúng một lần toàn bộ câu');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates positive integer order DTOs', async () => {
    const exercise = Object.assign(new SpeakingExerciseDto(), { order: 0 });
    const reorder = Object.assign(new SpeakingExerciseReorderDto(), {
      exerciseIds: [-1],
    });

    expect(await validate(exercise)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'order' })]),
    );
    expect(await validate(reorder)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'exerciseIds' }),
      ]),
    );
  });

  it('assigns contiguous authoritative order during Speaking reorder', async () => {
    const tx = {
      speakingExercise: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        update: jest.fn().mockResolvedValue({}),
      },
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-order',
          exercises: [
            { id: 2, order: 1 },
            { id: 1, order: 2 },
          ],
        }),
      },
    };
    const prisma = {
      speakingPracticeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'speaking-order',
          publicationStatus: QuizPublicationStatus.DRAFT,
        }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
      speakingExercise: {
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SkillCmsService(prisma as any);

    await service.reorderSpeakingExercises(
      'speaking',
      'speaking-order',
      { exerciseIds: [2, 1] },
      admin,
    );

    expect(tx.speakingExercise.updateMany).toHaveBeenCalledWith({
      where: { practiceSetId: 'speaking-order' },
      data: { order: null },
    });
    expect(tx.speakingExercise.update).toHaveBeenNthCalledWith(1, {
      where: { id: 2 },
      data: { order: 1 },
    });
    expect(tx.speakingExercise.update).toHaveBeenNthCalledWith(2, {
      where: { id: 1 },
      data: { order: 2 },
    });
  });

  it('stores Writing task fields in the learner runtime content shape', async () => {
    const prisma = {
      quiz: { findFirst: jest.fn().mockResolvedValue({ id: 21 }) },
      question: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);

    await service.addWritingQuestion(
      '21',
      {
        type: 'WRITING',
        taskType: 'EMAIL',
        prompt: 'Write an email.',
        level: 'B1',
        keywords: ['reply', 'confirm'],
        wordRange: [100, 130],
        sampleSentences: ['Dear team,'],
      },
      admin,
    );

    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'WRITING',
        content: {
          skill: 'WRITING',
          taskType: 'EMAIL',
          prompt: 'Write an email.',
          level: 'B1',
          keywords: ['reply', 'confirm'],
          // The grader reads requiredKeywords (owner 2026-11-19).
          requiredKeywords: ['reply', 'confirm'],
          wordRange: [100, 130],
          sampleSentences: ['Dear team,'],
        },
      }),
    });
  });

  it('rejects a Writing task family that contradicts its parent format', async () => {
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue({
          id: 22,
          type: QuizType.WRITING_PICTURE,
        }),
      },
      submission: { count: jest.fn().mockResolvedValue(0) },
      question: { findFirst: jest.fn() },
    };
    const service = new SkillCmsService(prisma as any);

    await expect(
      service.addWritingQuestion(
        '22',
        {
          type: 'WRITING',
          taskType: 'EMAIL',
          prompt: 'Write a response.',
        },
        admin,
      ),
    ).rejects.toThrow('task family của dạng tranh');
    expect(prisma.question.findFirst).not.toHaveBeenCalled();
  });

  it('never writes a category on a Speaking exercise update', async () => {
    const prisma = {
      speakingExercise: {
        findFirst: jest.fn().mockResolvedValue({
          id: 42,
          difficulty: 'ADVANCED',
        }),
        update: jest.fn().mockResolvedValue({ id: 42 }),
      },
      speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new SkillCmsService(prisma as any);

    await service.updateSpeakingExercise(
      'speaking',
      'set-42',
      '42',
      { title: 'Updated', targetText: 'Hello again.' },
      admin,
    );

    const { data } = prisma.speakingExercise.update.mock.calls[0][0];
    expect(data).toEqual(expect.objectContaining({ title: 'Updated' }));
    expect(data).not.toHaveProperty('category');
    expect(data).not.toHaveProperty('categoryId');
  });

  it('exposes Listening audio authoring only for a question owned by the quiz', async () => {
    const prisma = {
      question: { findFirst: jest.fn().mockResolvedValue({ id: 8 }) },
      submission: { count: jest.fn().mockResolvedValue(0) },
    };
    const audio = {
      validateContent: jest.fn().mockResolvedValue({ valid: true }),
      generatePreview: jest.fn(),
      listArtifacts: jest.fn(),
      approve: jest.fn(),
      publish: jest.fn(),
    };
    const quiz = {
      createAudioAsset: jest.fn().mockResolvedValue({ id: 9 }),
      generateDialogueAudioAsset: jest.fn(),
    };
    const service = new SkillCmsService(
      prisma as any,
      audio as any,
      quiz as any,
    );
    const file = {
      buffer: Buffer.from('audio'),
      mimetype: 'audio/mpeg',
    } as any;

    await service.uploadListeningQuestionAudio(4, 8, file, admin);

    expect(prisma.question.findFirst).toHaveBeenCalledWith({
      where: { id: 8, quizId: 4, quiz: { type: QuizType.LISTENING_PRACTICE } },
      select: { id: true },
    });
    expect(quiz.createAudioAsset).toHaveBeenCalledWith(8, file);
  });

  it('lets Listening audio follow an edited sentence after learner history exists', async () => {
    const prisma = {
      question: { findFirst: jest.fn().mockResolvedValue({ id: 8 }) },
      submission: { count: jest.fn().mockResolvedValue(1) },
      toeicWritingSetItem: { count: jest.fn().mockResolvedValue(0) },
    };
    const quiz = { createAudioAsset: jest.fn().mockResolvedValue({}) };
    const service = new SkillCmsService(prisma as any, {} as any, quiz as any);

    await service.uploadListeningQuestionAudio(
      4,
      8,
      { buffer: Buffer.from('audio'), mimetype: 'audio/mpeg' } as any,
      admin,
    );
    expect(quiz.createAudioAsset).toHaveBeenCalled();
  });
});

describe('Speaking reference audio follows the sample sentence', () => {
  const admin = { id: 7, role: Role.ADMIN };
  const exercise = {
    id: 30,
    practiceSetId: 'set-1',
    targetText: 'Hello, my name is Alex.',
    taskType: 'READ_ALOUD',
    imageUrl: null,
    stimulusId: null,
    stimulus: null,
    isPremiumContent: false,
    audioUrl: 'https://pub/catalog/speaking/reference/30.v1.mp3',
    practiceSet: { id: 'set-1' },
  };
  const prismaWith = () => ({
    speakingExercise: {
      findFirst: jest.fn().mockResolvedValue(exercise),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...exercise, ...data })),
    },
    speakingSubmission: { count: jest.fn().mockResolvedValue(0) },
  });

  it('clears the reference audio when the sentence changes', async () => {
    const prisma = prismaWith();
    const service = new SkillCmsService(prisma as any);
    await service.updateSpeakingExercise(
      'speaking',
      'set-1',
      '30',
      { targetText: 'Hi, I am Alex.' } as any,
      admin,
    );
    expect(
      prisma.speakingExercise.update.mock.calls[0][0].data.audioUrl,
    ).toBeNull();
  });

  it('keeps the reference audio when the sentence is unchanged', async () => {
    const prisma = prismaWith();
    const service = new SkillCmsService(prisma as any);
    await service.updateSpeakingExercise(
      'speaking',
      'set-1',
      '30',
      { title: 'Greeting', targetText: 'Hello, my name is Alex.' },
      admin,
    );
    expect(
      prisma.speakingExercise.update.mock.calls[0][0].data.audioUrl,
    ).toBeUndefined();
  });

  it('synthesizes a free reference clip to a new public key', async () => {
    const prisma = prismaWith();
    const speaking = {
      generateTts: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    const upload = {
      putObjectAtKey: jest.fn().mockImplementation((key: string) => ({
        key,
        url: `https://pub/${key}`,
      })),
      putPrivateObjectAtKey: jest.fn(),
      isPrivateStorageConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new SkillCmsService(
      prisma as any,
      undefined,
      undefined,
      speaking as any,
      upload as any,
    );
    await service.generateSpeakingReferenceAudio('set-1', '30', admin);
    expect(speaking.generateTts).toHaveBeenCalledWith(
      'Hello, my name is Alex.',
      'US',
      1,
    );
    const key = upload.putObjectAtKey.mock.calls[0][0] as string;
    expect(key).toMatch(/^catalog\/speaking\/reference\/30\.r\d+\.mp3$/);
    expect(prisma.speakingExercise.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { audioUrl: `https://pub/${key}` },
    });
  });

  it('stores a premium reference clip privately and saves its key', async () => {
    const prisma = prismaWith();
    prisma.speakingExercise.findFirst.mockResolvedValue({
      ...exercise,
      isPremiumContent: true,
    });
    const speaking = {
      generateTts: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    const upload = {
      putObjectAtKey: jest.fn(),
      putPrivateObjectAtKey: jest.fn(),
      isPrivateStorageConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new SkillCmsService(
      prisma as any,
      undefined,
      undefined,
      speaking as any,
      upload as any,
    );
    await service.generateSpeakingReferenceAudio('set-1', '30', admin);
    const key = upload.putPrivateObjectAtKey.mock.calls[0][0] as string;
    expect(key).toMatch(/^premium\/speaking\/reference\/30\.r\d+\.mp3$/);
    expect(prisma.speakingExercise.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { audioUrl: key },
    });
  });

  // QA 2026-11-22: a B1-B2 exercise keeps isPremiumContent false, but access
  // treats B1+ as paid and drops a public URL, so its new clip never played.
  const storeFor = async (level: string) => {
    const prisma = prismaWith();
    prisma.speakingExercise.findFirst.mockResolvedValue({
      ...exercise,
      isPremiumContent: false,
      practiceSet: { scope: 'SKILL_PRACTICE', level },
    });
    const upload = {
      putObjectAtKey: jest.fn().mockImplementation((key: string) => ({
        key,
        url: `https://pub/${key}`,
      })),
      putPrivateObjectAtKey: jest.fn(),
      isPrivateStorageConfigured: jest.fn().mockReturnValue(true),
    };
    const service = new SkillCmsService(
      prisma as any,
      undefined,
      undefined,
      { generateTts: jest.fn().mockResolvedValue(Buffer.from('mp3')) } as any,
      upload as any,
    );
    await service.generateSpeakingReferenceAudio('set-1', '30', admin);
    return { prisma, upload };
  };

  it.each(['B1', 'B1-B2', 'C1-C2'])(
    'stores the clip of a %s set privately, as access reads it',
    async (level) => {
      const { prisma, upload } = await storeFor(level);
      expect(upload.putObjectAtKey).not.toHaveBeenCalled();
      const key = upload.putPrivateObjectAtKey.mock.calls[0][0] as string;
      expect(key).toMatch(/^premium\/speaking\/reference\/30\.r\d+\.mp3$/);
      expect(
        prisma.speakingExercise.update.mock.calls[0][0].data.audioUrl,
      ).toBe(key);
    },
  );

  it.each(['A1', 'A1-A2'])(
    'keeps the clip of a free %s set public',
    async (level) => {
      const { upload } = await storeFor(level);
      expect(upload.putPrivateObjectAtKey).not.toHaveBeenCalled();
      expect(upload.putObjectAtKey.mock.calls[0][0]).toMatch(
        /^catalog\/speaking\/reference\//,
      );
    },
  );

  it('loads the set level the rule needs', async () => {
    const { prisma } = await storeFor('B1-B2');
    expect(prisma.speakingExercise.findFirst).toHaveBeenCalledWith({
      where: { id: 30, practiceSetId: 'set-1' },
      include: { practiceSet: { select: { scope: true, level: true } } },
    });
  });

  it('refuses a paid clip when private storage is missing, before any TTS', async () => {
    const prisma = prismaWith();
    prisma.speakingExercise.findFirst.mockResolvedValue({
      ...exercise,
      practiceSet: { scope: 'SKILL_PRACTICE', level: 'B2' },
    });
    const speaking = { generateTts: jest.fn() };
    const service = new SkillCmsService(
      prisma as any,
      undefined,
      undefined,
      speaking as any,
      {
        putObjectAtKey: jest.fn(),
        putPrivateObjectAtKey: jest.fn(),
        isPrivateStorageConfigured: jest.fn().mockReturnValue(false),
      } as any,
    );
    await expect(
      service.generateSpeakingReferenceAudio('set-1', '30', admin),
    ).rejects.toThrow('Kho lưu trữ âm thanh Nói chưa được cấu hình.');
    expect(speaking.generateTts).not.toHaveBeenCalled();
  });
});
