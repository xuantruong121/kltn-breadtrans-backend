import { ToeicAssessmentService } from './toeic-assessment.service';

/**
 * Phase E — the legacy-route treatment on the frontend decides
 * redirect-vs-editable purely from `examId`, so the admin projection must
 * expose it (it was previously silently dropped).
 */
describe('ToeicAssessmentService admin projection — exposes examId for legacy-route treatment', () => {
  let service: any;

  beforeEach(() => {
    service = Object.create(ToeicAssessmentService.prototype);
  });

  it('includes examId when the Assessment is mapped to an Exam', async () => {
    const result = await service['projectAdmin']({
      id: 15,
      title: 'TOEIC S&W',
      description: null,
      productFamily: 'TOEIC_SW',
      publicationStatus: 'PUBLISHED',
      version: 1,
      examId: 22,
      components: [],
    });
    expect(result.examId).toBe(22);
  });

  it('exposes null (not undefined) when the Assessment has no Exam mapping', async () => {
    const result = await service['projectAdmin']({
      id: 99,
      title: 'Orphan legacy assessment',
      description: null,
      productFamily: 'TOEIC_LR',
      publicationStatus: 'DRAFT',
      version: 1,
      examId: null,
      components: [],
    });
    expect(result.examId).toBeNull();
  });
});
