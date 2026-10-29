import { NotFoundException } from '@nestjs/common';
import { QuizPublicationStatus } from '@prisma/client';

import { GenericExamService } from './generic-exam.service';

/**
 * Learner product cards (GET /exams, GET /exams/:id) carry catalog metadata
 * only. The authoring projection includes the exam's question groups with
 * answer keys and explanations; it must stay on the admin API.
 */
describe('GenericExamService learner contract', () => {
  const authoring = {
    id: 4,
    title: 'TOEIC 4 Skills — Đề luyện tập 01',
    description: 'd',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_4_SKILLS',
    family: 'TOEIC',
    variant: 'TOEIC_4_SKILLS',
    templateKey: 'TOEIC_4_SKILLS_V1',
    publicationStatus: QuizPublicationStatus.PUBLISHED,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    childId: 1,
    runtimeId: 1,
    type: 'FULL_TEST',
    difficulty: 'medium',
    durationSeconds: 7200,
    groups: [
      {
        id: 10,
        part: 5,
        passageText: 'secret passage',
        audioUrl: 'https://example.test/a.mp3',
        questions: [
          {
            id: 100,
            text: 'secret question',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 2,
            explanation: 'secret why',
          },
        ],
      },
    ],
    totalGroups: 1,
    totalQuestions: 200,
    questionsCount: 200,
    bilingualContent: { examFormat: 'TOEIC_4_SKILLS', examSetId: 1 },
    attemptsCount: 3,
    learnerReady: true,
    validation: { issues: ['Question 100 has no explanation'] },
    readiness: { listeningReady: true },
    readinessSummary: { ok: true },
    aiGenerationJobId: 'job-1',
    assessment: {
      id: 2,
      productFamily: 'TOEIC',
      components: [
        {
          id: 5,
          kind: 'LISTENING_READING',
          order: 1,
          required: true,
          sourceId: 1,
        },
      ],
    },
  };

  const make = () => {
    const service: any = Object.create(GenericExamService.prototype);
    service.project = jest.fn(() => authoring);
    service.prisma = {
      exam: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
    };
    service.findExam = jest.fn().mockResolvedValue({
      id: 4,
      publicationStatus: QuizPublicationStatus.PUBLISHED,
    });
    return service;
  };

  const SECRET =
    /correctIndex|explanation|secret|"groups"|"validation"|"readiness"|readinessSummary|aiGenerationJobId|passageText|audioUrl/;

  it('GET /exams: no question content, answer key or authoring data', async () => {
    const [card] = await make().listLearner();
    expect(JSON.stringify(card)).not.toMatch(SECRET);
  });

  it('GET /exams/:id: no question content, answer key or authoring data', async () => {
    const card = await make().getLearner(4);
    expect(JSON.stringify(card)).not.toMatch(SECRET);
  });

  it('keeps every field the learner catalog and exam routing use', async () => {
    const card = await make().getLearner(4);
    expect(card).toMatchObject({
      id: 4,
      title: authoring.title,
      description: 'd',
      variantCode: 'TOEIC_4_SKILLS',
      runtimeId: 1,
      questionsCount: 200,
      totalQuestions: 200,
      totalGroups: 1,
      durationSeconds: 7200,
      learnerReady: true,
      bilingualContent: { examFormat: 'TOEIC_4_SKILLS', examSetId: 1 },
      assessment: authoring.assessment,
    });
  });

  it('an unpublished product is still refused to learners', async () => {
    const service = make();
    service.findExam.mockResolvedValue({
      id: 4,
      publicationStatus: QuizPublicationStatus.DRAFT,
    });
    await expect(service.getLearner(4)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
