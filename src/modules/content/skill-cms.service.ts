import { historyEditProblem } from './edit-with-history';
import { skillDeleteRefusal } from './skill-content-delete';
import { parseCefrRange, titleWithLevel } from '../subscription/practice-level';
import {
  mergeListeningContent,
  spokenTextChanged,
} from './listening-question-merge';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type LearningContentType,
  Prisma,
  QuizPublicationStatus,
  QuizType,
  Role,
  TopicCategory,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SkillContentDto,
  ListeningQuestionDto,
  SkillQuestionDto,
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
  WritingQuestionDto,
} from './skill-cms.dto';
import { SpeakingStimulusDto } from './speaking-stimulus.dto';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import { QuizService } from '../quiz/quiz.service';
import { ListeningAudioAuthoringService } from '../quiz/listening-audio-authoring.service';
import { normalizeDialogueSegments } from '../quiz/listening-dialogue.contract';
import { SPEAKING_SET_LEVELS } from '../speaking/speaking-contract';
import { taskTypeValidationErrors } from '../speaking/speaking-task-validation';
import { isPremiumSpeaking } from '../speaking/speaking-content-access.logic';
import { toeicSpeakingContractErrors } from '../speaking/toeic-speaking-contract';
import { SpeakingService } from '../speaking/speaking.service';
import { ListQuery, pageOf, wantsPage } from '../../common/paging/list-page';
import {
  filterQuizList,
  filterSpeakingSets,
  firstImageByQuiz,
  quizListFacets,
  speakingSetFacets,
  isTranscriptHolder,
  storedWritingKind,
  taskTypesByQuiz,
  writingKindOf,
} from './skill-cms-list';
import { writingQuestionContent } from './writing-question-content.logic';
import { UploadService } from '../upload/upload.service';
import {
  ContentFilesService,
  type ContentFile,
} from '../upload/content-files.service';
import { unavailableTracks } from '../learning-track/learning-track.logic';
import {
  SENTENCE_TRANSLATION,
  SENTENCE_TRANSLATION_TOPIC,
  translationTaskIssues,
} from '../writing/sentence-translation.logic';

type Domain = 'listening' | 'reading' | 'writing' | 'speaking';
type Admin = { id: number; role: Role };

const QUIZ_DOMAINS: Record<Exclude<Domain, 'speaking'>, QuizType> = {
  listening: QuizType.LISTENING_PRACTICE,
  reading: QuizType.BILINGUAL_READING,
  writing: QuizType.WRITING_EMAIL,
};

const PICTURE_WRITING_TASK_TYPES = new Set([
  'SENTENCE',
  'PICTURE_SENTENCE',
  'DESCRIBE_PICTURE',
  // "Dịch câu" exercises are stored on WRITING_PICTURE too (owner 2026-11-14).
  SENTENCE_TRANSLATION,
]);

function asJson(value: unknown): Prisma.InputJsonValue {
  return value ?? {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const SKILL_TITLE_LABEL: Record<string, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
};

/** The publish check's line for a choice question, in the checklist's words. */
const CHOICES_INCOMPLETE = 'chưa đủ phương án hoặc chưa chọn đáp án đúng';

/** "Nghe chép" needs this many sentences to publish (the FE checklist agrees). */
const DICTATION_MIN_SENTENCES = 20;

const EXAM_CONTENT_LOCKED =
  'Nội dung thuộc đề TOEIC đã có lượt làm; hãy nhân bản đề để sửa.';

/** Tags in the order admins set for the tracks. */
const TRACK_ORDER = [
  { trackRef: { sortOrder: 'asc' as const } },
  { track: 'asc' as const },
];

@Injectable()
export class SkillCmsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly listeningAudioAuthoring?: ListeningAudioAuthoringService,
    @Optional()
    private readonly quizService?: QuizService,
    @Optional()
    private readonly speakingService?: SpeakingService,
    @Optional()
    private readonly uploadService?: UploadService,
    @Optional()
    private readonly contentFiles?: ContentFilesService,
  ) {}

  private admin(user: Admin) {
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException(
        'Chỉ quản trị viên được thực hiện thao tác này.',
      );
  }

  private domain(value: string): Domain {
    if (!['listening', 'reading', 'writing', 'speaking'].includes(value)) {
      throw new NotFoundException('Không tìm thấy phân hệ nội dung này.');
    }
    return value as Domain;
  }

  private quizType(domain: Domain) {
    if (domain === 'speaking')
      throw new BadRequestException(
        'Kỹ năng Nói dùng bộ luyện tập, không dùng thao tác này.',
      );
    return QUIZ_DOMAINS[domain];
  }

  private assertSpeakingSetContract(dto: SkillContentDto) {
    if (
      dto.level &&
      !SPEAKING_SET_LEVELS.some((level) => level === dto.level)
    ) {
      throw new BadRequestException(
        `Trình độ bộ luyện nói phải là một trong: ${SPEAKING_SET_LEVELS.join(', ')}`,
      );
    }
  }

  /**
   * The quiz's bilingualContent on a save. A Writing exercise keeps the kind
   * the admin picked in it (writingKind), next to what it already holds;
   * listening sends its own metadata object, reading its paragraphs.
   */
  private contentMetadata(
    domain: Exclude<Domain, 'speaking'>,
    dto: SkillContentDto,
    previous?: unknown,
  ): Prisma.InputJsonValue | undefined {
    if (domain === 'writing' && dto.writingKind)
      return asJson({
        ...asRecord(previous),
        ...asRecord(dto.bilingualContent),
        writingKind: dto.writingKind,
      });
    return dto.bilingualContent ? asJson(dto.bilingualContent) : undefined;
  }

  private contentTypeWhere(domain: Exclude<Domain, 'speaking'>) {
    // Writing CMS owns both picture and email formats.
    return domain === 'writing'
      ? { type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] } }
      : { type: this.quizType(domain) };
  }

  private async practiceTopicId(
    domain: Exclude<Domain, 'speaking'>,
    type: QuizType,
    level?: string,
    writingKind?: 'TRANSLATION',
  ) {
    const category =
      domain === 'reading'
        ? TopicCategory.BILINGUAL_LEVEL
        : type === QuizType.WRITING_PICTURE
          ? TopicCategory.WRITING_PART1
          : TopicCategory.WRITING_PART2;
    if (!this.prisma.practiceTopic?.findMany) return undefined;
    // "Dịch câu" has its own topic, created on first use.
    if (writingKind === 'TRANSLATION') {
      const where = {
        name: SENTENCE_TRANSLATION_TOPIC.name,
        category: TopicCategory.WRITING_PART1,
      };
      const existing = await this.prisma.practiceTopic.findFirst({
        where,
        select: { id: true },
      });
      if (existing) return existing.id;
      const created = await this.prisma.practiceTopic.create({
        data: {
          ...where,
          vietnameseName: SENTENCE_TRANSLATION_TOPIC.vietnameseName,
        },
        select: { id: true },
      });
      return created.id;
    }
    const topics = (
      await this.prisma.practiceTopic.findMany({
        where: { category },
        select: { id: true, name: true },
        orderBy: { order: 'asc' },
      })
    ).filter((topic) => topic.name !== SENTENCE_TRANSLATION_TOPIC.name);
    if (!topics.length) return undefined;
    if (domain !== 'reading') return topics[0].id;
    const normalizedLevel = level?.trim().toUpperCase() ?? '';
    const marker = normalizedLevel.includes('C1')
      ? 'C1'
      : normalizedLevel.includes('B1') || normalizedLevel.includes('B2')
        ? 'B1'
        : 'A1';
    return (
      topics.find((topic) => topic.name.toUpperCase().includes(marker))?.id ??
      topics[0].id
    );
  }

  /**
   * The domain's items. Without `query.page` the full array (editors and
   * composers need it); with it one page plus header counts, filtered and
   * sorted on the server (see skill-cms-list.ts).
   */
  async list(rawDomain: string, user: Admin, query: ListQuery = {}) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      const include = {
        exercises: {
          orderBy: [{ order: 'asc' as const }, { id: 'asc' as const }],
          include: {
            stimulus: true,
            _count: { select: { submissions: true } },
          },
        },
      };
      if (!wantsPage(query))
        return this.prisma.speakingPracticeSet.findMany({
          where: { scope: 'SKILL_PRACTICE' },
          orderBy: { updatedAt: 'desc' },
          include,
        });
      // Light rows decide the page; exercises load for that page only. A
      // set's tags are its own (SpeakingSetTrack), whatever its exercises.
      const rows = (
        await this.prisma.speakingPracticeSet.findMany({
          where: { scope: 'SKILL_PRACTICE' },
          select: {
            id: true,
            title: true,
            description: true,
            level: true,
            publicationStatus: true,
            createdAt: true,
            tracks: { orderBy: TRACK_ORDER, select: { track: true } },
            _count: { select: { exercises: true } },
          },
        })
      ).map(({ _count, tracks, ...row }) => ({
        ...row,
        exerciseCount: _count.exercises,
        tracks: tracks.map((tag) => tag.track),
      }));
      const page = pageOf(filterSpeakingSets(rows, query), query, 12);
      const full = await this.prisma.speakingPracticeSet.findMany({
        where: { id: { in: page.items.map((row) => row.id) } },
        include,
      });
      const byId = new Map(full.map((set) => [set.id, set]));
      return {
        ...page,
        items: page.items
          .map((row) => {
            const set = byId.get(row.id);
            return set ? { ...set, tracks: row.tracks } : null;
          })
          .filter(Boolean),
        facets: speakingSetFacets(rows),
      };
    }
    const quizzes = await this.prisma.quiz.findMany({
      // Writing tasks of a TOEIC exam are edited in the exam, not listed here.
      where: {
        ...this.contentTypeWhere(domain),
        ...(domain === 'writing' ? { toeicWritingSetItems: { none: {} } } : {}),
      },
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { questions: true, submissions: true } },
        // The list card shows the newest recording's state; whether it still
        // matches the transcript is decided in the editor.
        ...(domain === 'listening'
          ? {
              listeningAudioArtifacts: {
                orderBy: { version: 'desc' as const },
                take: 1,
                select: { version: true, status: true, durationMs: true },
              },
            }
          : {}),
      },
    });
    const quizTracks = wantsPage(query)
      ? await this.quizTracks()
      : new Map<number, string[]>();
    // Writing reads every task once: the first image and each task type decide
    // the card's kind ("Dịch câu", tranh, câu, email; owner 2026-11-19).
    const writingTasks =
      domain === 'writing' && quizzes.length
        ? await this.prisma.question.findMany({
            where: { quizId: { in: quizzes.map((quiz) => quiz.id) } },
            orderBy: { order: 'asc' },
            select: { quizId: true, content: true },
          })
        : null;
    const thumbnails = writingTasks
      ? firstImageByQuiz(
          writingTasks.filter((row) =>
            String(
              (row.content as { imageUrl?: unknown } | null)?.imageUrl ?? '',
            ).startsWith('http'),
          ),
        )
      : await this.quizThumbnails(
          domain,
          quizzes.map((quiz) => quiz.id),
        );
    const taskTypes = writingTasks
      ? taskTypesByQuiz(writingTasks)
      : new Map<number, string[]>();
    // The list card names a "Dịch câu" exercise by its topic.
    const translationTopic =
      domain === 'writing' ? await this.translationTopic() : null;
    const tagged = quizzes.map((quiz) => ({
      ...quiz,
      tracks: quizTracks.get(quiz.id) ?? [],
      thumbnailUrl: thumbnails.get(quiz.id) ?? null,
      ...(domain === 'writing'
        ? {
            writingKind: writingKindOf({
              type: quiz.type,
              stored: storedWritingKind(quiz.bilingualContent),
              isTranslation:
                !!translationTopic &&
                quiz.practiceTopicId === translationTopic.id,
              taskTypes: taskTypes.get(quiz.id),
              hasImage: thumbnails.has(quiz.id),
              questionCount: quiz._count?.questions,
            }),
          }
        : {}),
    }));
    if (domain !== 'listening' || !quizzes.length)
      return this.listPage(tagged, query, domain === 'writing');
    // A hand-made dialogue keeps its turns in a DIALOGUE question; the card
    // counts only the questions a learner answers, as for AI-made quizzes.
    const holders = await this.prisma.question.groupBy({
      by: ['quizId'],
      where: {
        quizId: { in: quizzes.map((quiz) => quiz.id) },
        type: 'DIALOGUE',
      },
      _count: { _all: true },
    });
    const holderCounts = new Map(
      holders.map((row) => [row.quizId, row._count._all]),
    );
    // Questions with an active clip, by type. Comprehension and dictation
    // play one clip per question: those are counted. A hand-made dialogue's
    // holder may carry the conversation's clip instead of a shared recording.
    const withAudio = await this.prisma.question.groupBy({
      by: ['quizId', 'type'],
      where: {
        quizId: { in: quizzes.map((quiz) => quiz.id) },
        audioAssets: { some: { isActive: true } },
      },
      _count: { _all: true },
    });
    const counts = new Map<number, number>();
    const dialogueAudio = new Set<number>();
    for (const row of withAudio) {
      if (isTranscriptHolder(row)) dialogueAudio.add(row.quizId);
      else
        counts.set(row.quizId, (counts.get(row.quizId) ?? 0) + row._count._all);
    }
    return this.listPage(
      tagged.map((quiz) => ({
        ...quiz,
        _count: {
          ...quiz._count,
          questions:
            (quiz._count?.questions ?? 0) - (holderCounts.get(quiz.id) ?? 0),
        },
        questionsWithAudio: counts.get(quiz.id) ?? 0,
        dialogueAudio: dialogueAudio.has(quiz.id),
      })),
      query,
    );
  }

  /** Only the questions holding an image are read, not every question body. */
  private async quizThumbnails(domain: string, quizIds: number[]) {
    if (!['listening', 'writing'].includes(domain) || !quizIds.length)
      return new Map<number, string>();
    const rows = await this.prisma.question.findMany({
      where: {
        quizId: { in: quizIds },
        content: { path: ['imageUrl'], string_starts_with: 'http' },
      },
      orderBy: { order: 'asc' },
      select: { quizId: true, content: true },
    });
    return firstImageByQuiz(rows);
  }

  private listPage<T extends Parameters<typeof filterQuizList>[0][number]>(
    rows: T[],
    query: ListQuery,
    writing = false,
  ) {
    if (!wantsPage(query)) return rows;
    return {
      ...pageOf(filterQuizList(rows, query), query),
      facets: quizListFacets(rows, { writing }),
    };
  }

  async get(
    rawDomain: string,
    rawId: string,
    user: Admin,
    allowExamInternal = false,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: rawId },
        include: {
          exercises: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            include: { stimulus: true },
          },
          tracks: { orderBy: TRACK_ORDER, select: { track: true } },
        },
      });
      if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
      if (set.scope === 'EXAM_INTERNAL' && !allowExamInternal)
        throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
      return { ...set, tracks: set.tracks.map((tag) => tag.track) };
    }
    const id = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ...this.contentTypeWhere(domain) },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          ...(domain === 'listening'
            ? { include: { audioAssets: { orderBy: { version: 'desc' } } } }
            : {}),
        },
        listeningAudioArtifacts: domain === 'listening',
        _count: { select: { submissions: true } },
      },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy nội dung kỹ năng.');
    // An empty "Dịch câu" exercise has no sentence to tell it from a picture
    // one: its topic does (owner 2026-11-20, the AI draft did not open).
    const translationTopic =
      domain === 'writing' ? await this.translationTopic() : null;
    return {
      ...quiz,
      passage: quiz.theoryContent,
      tracks: await this.quizTracksOf(quiz.id),
      ...(domain === 'writing'
        ? {
            writingKind: writingKindOf({
              type: quiz.type,
              stored: storedWritingKind(quiz.bilingualContent),
              questionCount: quiz.questions.length,
              isTranslation:
                !!translationTopic &&
                quiz.practiceTopicId === translationTopic.id,
              taskTypes: quiz.questions
                .map(
                  (q) => (q.content as { taskType?: unknown } | null)?.taskType,
                )
                .filter((t): t is string => typeof t === 'string'),
              hasImage: quiz.questions.some((q) =>
                String(
                  (q.content as { imageUrl?: unknown } | null)?.imageUrl ?? '',
                ).startsWith('http'),
              ),
            }),
          }
        : {}),
    };
  }

  /** The "Dịch câu" topic, if it exists yet. */
  private async translationTopic() {
    return this.prisma.practiceTopic?.findFirst
      ? this.prisma.practiceTopic.findFirst({
          where: { name: SENTENCE_TRANSLATION_TOPIC.name },
          select: { id: true },
        })
      : null;
  }

  /** Each quiz's track codes. Speaking sets keep theirs in SpeakingSetTrack. */
  private async quizTracks() {
    const tags =
      (await this.prisma.contentTrackTag?.findMany({
        where: { contentType: 'QUIZ' },
        orderBy: TRACK_ORDER,
        select: { contentId: true, track: true },
      })) ?? [];
    const byContent = new Map<number, string[]>();
    for (const { contentId, track } of tags)
      byContent.set(contentId, [...(byContent.get(contentId) ?? []), track]);
    return byContent;
  }

  private async quizTracksOf(quizId: number) {
    const tags =
      (await this.prisma.contentTrackTag?.findMany({
        where: { contentType: 'QUIZ', contentId: quizId },
        orderBy: TRACK_ORDER,
        select: { track: true },
      })) ?? [];
    return tags.map((tag) => tag.track);
  }

  private async setTracksOf(setId: string) {
    const tags = await this.prisma.speakingSetTrack.findMany({
      where: { setId },
      orderBy: TRACK_ORDER,
      select: { track: true },
    });
    return tags.map((tag) => tag.track);
  }

  /**
   * Replaces an item's career tracks: a quiz's by its id, a speaking set's
   * on the set itself, so a set with no exercise yet can be tagged too. Only
   * active tracks can be added; an inactive one the item already has stays.
   */
  async setTracks(
    rawDomain: string,
    rawId: string,
    tracks: string[],
    user: Admin,
  ) {
    const item = (await this.get(rawDomain, rawId, user)) as {
      id: number | string;
      tracks: string[];
    };
    const added = tracks.filter((code) => !item.tracks.includes(code));
    if (added.length) {
      const active = await this.prisma.learningTrack.findMany({
        where: { code: { in: added }, isActive: true },
        select: { code: true },
      });
      const refused = unavailableTracks(
        tracks,
        item.tracks,
        active.map((track) => track.code),
      );
      if (refused.length)
        throw new BadRequestException(
          `Lĩnh vực không tồn tại hoặc đã tắt: ${refused.join(', ')}`,
        );
    }
    if (this.domain(rawDomain) === 'speaking') {
      const setId = String(item.id);
      await this.prisma.$transaction([
        this.prisma.speakingSetTrack.deleteMany({
          where: { setId, track: { notIn: tracks } },
        }),
        this.prisma.speakingSetTrack.createMany({
          data: tracks.map((track) => ({
            setId,
            track,
            createdById: user.id,
          })),
          skipDuplicates: true,
        }),
      ]);
      return { tracks: await this.setTracksOf(setId) };
    }
    const contentType: LearningContentType = 'QUIZ';
    const contentId = Number(item.id);
    await this.prisma.$transaction([
      this.prisma.contentTrackTag.deleteMany({
        where: { contentType, contentId, track: { notIn: tracks } },
      }),
      this.prisma.contentTrackTag.createMany({
        data: tracks.map((track) => ({
          contentType,
          contentId,
          track,
          createdById: user.id,
        })),
        skipDuplicates: true,
      }),
    ]);
    return { tracks: await this.quizTracksOf(contentId) };
  }

  async create(rawDomain: string, dto: SkillContentDto, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      this.assertSpeakingSetContract(dto);
      // A set carries no category: Lĩnh vực tags it (PUT :domain/:id/tracks).
      return this.prisma.speakingPracticeSet.create({
        data: {
          id: `speaking-${randomUUID()}`,
          title: dto.title.trim(),
          description: dto.description?.trim() ?? '',
          level: dto.level?.trim() || 'A1-B1',
          publicationStatus: QuizPublicationStatus.DRAFT,
        },
      });
    }
    const type = this.quizType(domain);
    const translation =
      domain === 'writing' && dto.writingKind === 'TRANSLATION';
    const writingType =
      domain === 'writing' && (dto.type === 'WRITING_PICTURE' || translation)
        ? QuizType.WRITING_PICTURE
        : type;
    const practiceTopicId = await this.practiceTopicId(
      domain,
      writingType,
      dto.level,
      translation ? 'TRANSLATION' : undefined,
    );
    return this.prisma.quiz.create({
      data: {
        title: titleWithLevel(dto.title, dto.level, SKILL_TITLE_LABEL[domain]),
        description: dto.description?.trim(),
        theoryContent: dto.passage,
        bilingualContent: this.contentMetadata(domain, dto),
        type: writingType,
        timeLimit: dto.timeLimit,
        isPremiumContent: dto.isPremiumContent ?? false,
        publicationStatus: QuizPublicationStatus.DRAFT,
        practiceTopicId,
      },
    });
  }

  async update(
    rawDomain: string,
    rawId: string,
    dto: SkillContentDto,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      this.assertSpeakingSetContract(dto);
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id: rawId },
      });
      if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
      await this.assertSpeakingEditable(rawId);
      return this.prisma.speakingPracticeSet.update({
        where: { id: rawId },
        data: {
          title: dto.title?.trim(),
          description: dto.description?.trim(),
          level: dto.level?.trim(),
        },
      });
    }
    const id = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ...this.contentTypeWhere(domain) },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy nội dung kỹ năng.');
    const lock = await this.assertContentEditable(id);
    const type =
      domain === 'writing' &&
      (dto.type === 'WRITING_PICTURE' || dto.type === 'WRITING_EMAIL')
        ? dto.type === 'WRITING_PICTURE'
          ? QuizType.WRITING_PICTURE
          : QuizType.WRITING_EMAIL
        : undefined;
    if (lock === 'PRACTICE' && type && type !== quiz.type)
      throw new ConflictException(
        'Nội dung đã có lịch sử làm bài; không thể đổi loại bài.',
      );
    // An exam task carries no level: the exam sets who can open it.
    const title =
      dto.level && !(await this.isExamTask(id))
        ? titleWithLevel(
            dto.title ?? quiz.title,
            dto.level,
            SKILL_TITLE_LABEL[domain],
          )
        : dto.title?.trim();
    return this.prisma.quiz.update({
      where: { id },
      data: {
        title,
        description: dto.description?.trim(),
        theoryContent: dto.passage,
        bilingualContent: this.contentMetadata(
          domain,
          dto,
          quiz.bilingualContent,
        ),
        timeLimit: dto.timeLimit,
        type,
        isPremiumContent: dto.isPremiumContent,
      },
    });
  }

  async addQuestion(
    rawDomain: string,
    rawId: string,
    dto: SkillQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking')
      throw new BadRequestException(
        'Câu hỏi Nói được quản lý dưới dạng bài luyện.',
      );
    const quizId = this.id(rawId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ...this.contentTypeWhere(domain) },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy nội dung kỹ năng.');
    await this.assertNoHistory(quizId);
    const last = await this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        content: asJson(dto.content),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async addWritingQuestion(
    rawQuizId: string,
    dto: WritingQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const quiz = await this.prisma.quiz.findFirst({
      where: {
        id: quizId,
        type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] },
      },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy nội dung Viết.');
    this.assertWritingTaskType(quiz.type, dto.taskType);
    await this.assertNoHistory(quizId);
    const last = await this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        content: this.writingContent(dto),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async addListeningQuestion(
    rawQuizId: string,
    dto: ListeningQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, type: QuizType.LISTENING_PRACTICE },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy nội dung Nghe.');
    await this.assertNoHistory(quizId);
    const last = await this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        content: asJson(dto.content),
        order: dto.order ?? (last?.order ?? -1) + 1,
      },
    });
  }

  async updateListeningQuestion(
    rawQuizId: string,
    rawQuestionId: string,
    dto: ListeningQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: { type: QuizType.LISTENING_PRACTICE },
      },
    });
    if (!question)
      throw new NotFoundException('Câu hỏi không thuộc nội dung Nghe này.');
    // Same type: merge, so fields the form does not show survive the edit.
    const content =
      dto.type === question.type
        ? mergeListeningContent(
            question.content,
            dto.content as unknown as Record<string, unknown>,
          )
        : dto.content;
    await this.assertQuestionEditable(quizId, question, {
      type: dto.type,
      content,
    });
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        type: dto.type,
        content: asJson(content),
        order: dto.order,
      },
    });
    // A clip that reads the old sentence is retired; the CMS asks for a new one.
    if (spokenTextChanged(question.content, content))
      await this.prisma.quizAudioAsset.updateMany({
        where: { questionId, isActive: true },
        data: { isActive: false },
      });
    return updated;
  }

  async updateWritingQuestion(
    rawQuizId: string,
    rawQuestionId: string,
    dto: WritingQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const quizId = this.id(rawQuizId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: {
          type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] },
        },
      },
      include: { quiz: { select: { type: true } } },
    });
    if (!question)
      throw new NotFoundException('Câu hỏi không thuộc nội dung Viết này.');
    this.assertWritingTaskType(question.quiz?.type, dto.taskType);
    // Keeps what the CMS form does not edit (dismissed translations).
    const content = this.writingContent(dto, question.content);
    await this.assertQuestionEditable(quizId, question, {
      type: dto.type,
      content,
    });
    return this.prisma.question.update({
      where: { id: questionId },
      data: {
        type: dto.type,
        content,
        order: dto.order,
      },
    });
  }

  async addSpeakingExercise(
    rawDomain: string,
    rawSetId: string,
    dto: SpeakingExerciseDto,
    user: Admin,
    client?: Prisma.TransactionClient,
  ) {
    this.admin(user);
    // An exam's Speaking section passes the transaction that holds the exam
    // lock (inDraftExam); the skill practice CMS passes none.
    const db: Prisma.TransactionClient = client ?? this.prisma;
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Câu luyện chỉ dùng cho kỹ năng Nói.');
    const set = await db.speakingPracticeSet.findUnique({
      where: { id: rawSetId },
    });
    if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
    if (!dto.taskType) {
      throw new BadRequestException('Câu luyện nói mới phải có loại bài.');
    }
    const stimulus = dto.stimulusId
      ? await db.speakingStimulus.findUnique({
          where: { id: dto.stimulusId },
        })
      : null;
    if (dto.stimulusId && !stimulus) {
      throw new NotFoundException('Không tìm thấy thông tin dùng chung.');
    }
    const semanticErrors = taskTypeValidationErrors({
      taskType: dto.taskType as any,
      targetText: dto.targetText,
      imageUrl: dto.imageUrl,
      stimulusId: dto.stimulusId,
      stimulus,
    });
    if (semanticErrors.length) throw new BadRequestException(semanticErrors);
    // No category: Lĩnh vực sits on the set.
    const data: any = {
      title: dto.title.trim(),
      targetText: dto.targetText.trim(),
      difficulty: dto.difficulty || set.level,
      imageUrl: dto.imageUrl,
      audioUrl: dto.audioUrl,
      isPremiumContent: dto.isPremiumContent ?? false,
      taskType: dto.taskType,
      stimulusId: dto.stimulusId,
      order: null,
      practiceSetId: rawSetId,
      publicationStatus: QuizPublicationStatus.DRAFT,
    };
    return this.inTransaction(
      client,
      async (tx) => {
        const existing = await tx.speakingExercise.findMany({
          where: { practiceSetId: rawSetId },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true, order: true },
        });
        const requestedOrder = dto.order ?? existing.length + 1;
        if (requestedOrder > existing.length + 1) {
          throw new BadRequestException(
            `Vị trí câu phải nằm trong khoảng 1-${existing.length + 1}`,
          );
        }

        const created = await tx.speakingExercise.create({
          data: { ...data, order: null },
        });
        const orderedIds = existing.map((item) => item.id);
        orderedIds.splice(requestedOrder - 1, 0, created.id);
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: rawSetId },
          data: { order: null },
        });
        for (const [index, id] of orderedIds.entries()) {
          await tx.speakingExercise.update({
            where: { id },
            data: { order: index + 1 },
          });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateSpeakingExercise(
    rawDomain: string,
    rawSetId: string,
    rawExerciseId: string,
    dto: SpeakingExerciseDto,
    user: Admin,
    client?: Prisma.TransactionClient,
  ) {
    this.admin(user);
    // An exam's Speaking section passes the transaction that holds the exam
    // lock (inDraftExam); the skill practice CMS passes none.
    const db: Prisma.TransactionClient = client ?? this.prisma;
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Câu luyện chỉ dùng cho kỹ năng Nói.');
    const exerciseId = this.id(rawExerciseId);
    const exercise = await db.speakingExercise.findFirst({
      where: { id: exerciseId, practiceSetId: rawSetId },
      include: { stimulus: true },
    });
    if (!exercise) throw new NotFoundException('Không tìm thấy bài luyện Nói.');
    if (dto.order !== undefined) {
      throw new BadRequestException(
        'Dùng API reorder để thay đổi thứ tự câu trong bộ luyện',
      );
    }
    const hasHistory = await this.assertSpeakingEditable(rawSetId, db);
    const taskType = dto.taskType ?? exercise.taskType;
    if (hasHistory && taskType !== exercise.taskType)
      throw new ConflictException(
        'Bộ luyện nói đã có lịch sử làm bài; không thể đổi loại câu.',
      );
    const stimulus = dto.stimulusId
      ? await db.speakingStimulus.findUnique({
          where: { id: dto.stimulusId },
        })
      : dto.stimulusId === null
        ? null
        : exercise.stimulus;
    if (dto.stimulusId && !stimulus) {
      throw new NotFoundException('Không tìm thấy thông tin dùng chung.');
    }
    const semanticErrors = taskType
      ? taskTypeValidationErrors({
          taskType: taskType as any,
          targetText: dto.targetText ?? exercise.targetText,
          imageUrl: dto.imageUrl ?? exercise.imageUrl,
          stimulusId: dto.stimulusId ?? exercise.stimulusId,
          stimulus,
        })
      : [];
    if (semanticErrors.length) throw new BadRequestException(semanticErrors);
    // No category here: an exercise has none of its own any more.
    const data: any = {
      title: dto.title?.trim(),
      targetText: dto.targetText?.trim(),
      difficulty: dto.difficulty,
      imageUrl: dto.imageUrl,
      // A new sample sentence retires the clip that reads the old one; the
      // CMS then offers to make a new reference audio.
      audioUrl:
        dto.audioUrl !== undefined
          ? dto.audioUrl
          : dto.targetText !== undefined &&
              dto.targetText.trim() !== (exercise.targetText ?? '').trim()
            ? null
            : undefined,
      isPremiumContent: dto.isPremiumContent,
      taskType,
      stimulusId: dto.stimulusId === null ? null : stimulus?.id,
    };
    return db.speakingExercise.update({
      where: { id: exerciseId },
      data,
    });
  }

  /**
   * Reads the sample sentence with Azure TTS and makes it the exercise's
   * reference audio. A new key per run, so no cache serves the old clip.
   */
  async generateSpeakingReferenceAudio(
    rawSetId: string,
    rawExerciseId: string,
    user: Admin,
  ) {
    this.admin(user);
    if (!this.speakingService || !this.uploadService)
      throw new ServiceUnavailableException(
        'Âm thanh bài Nói hiện không khả dụng.',
      );
    const exerciseId = this.id(rawExerciseId);
    const exercise = await this.prisma.speakingExercise.findFirst({
      where: { id: exerciseId, practiceSetId: rawSetId },
      include: { practiceSet: { select: { scope: true, level: true } } },
    });
    if (!exercise) throw new NotFoundException('Không tìm thấy bài luyện Nói.');
    const text = exercise.targetText.trim();
    if (!text) throw new BadRequestException('Câu luyện chưa có câu mẫu.');
    // The learner endpoint drops a public URL on paid content, and paid is
    // decided from the set level (B1+), not from the stored flag (QA
    // 2026-11-22: a B1-B2 clip saved public never played). Same rule here.
    const premium = isPremiumSpeaking(exercise);
    if (premium && !this.uploadService.isPrivateStorageConfigured())
      throw new ServiceUnavailableException(
        'Kho lưu trữ âm thanh Nói chưa được cấu hình.',
      );
    const audio = await this.speakingService.generateTts(text, 'US', 1);
    const file = `${exerciseId}.r${Date.now()}.mp3`;
    let audioUrl: string;
    if (premium) {
      audioUrl = `premium/speaking/reference/${file}`;
      await this.uploadService.putPrivateObjectAtKey(
        audioUrl,
        audio,
        'audio/mpeg',
      );
    } else {
      audioUrl = (
        await this.uploadService.putObjectAtKey(
          `catalog/speaking/reference/${file}`,
          audio,
          'audio/mpeg',
        )
      ).url;
    }
    return this.prisma.speakingExercise.update({
      where: { id: exerciseId },
      data: { audioUrl },
    });
  }

  async listSpeakingStimuli(user: Admin) {
    this.admin(user);
    return this.prisma.speakingStimulus.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { exercises: true } } },
    });
  }

  async createSpeakingStimulus(
    dto: SpeakingStimulusDto,
    user: Admin,
    client?: Prisma.TransactionClient,
  ) {
    this.admin(user);
    // An exam's Speaking section passes the transaction that holds the exam
    // lock (inDraftExam); the skill practice CMS passes none.
    const db: Prisma.TransactionClient = client ?? this.prisma;
    if (!dto.kind) {
      throw new BadRequestException('Thông tin dùng chung cần có loại hợp lệ.');
    }
    if (dto.kind === 'INFORMATION' && !dto.content?.trim()) {
      throw new BadRequestException(
        'Thông tin dùng chung dạng văn bản cần có nội dung.',
      );
    }
    if (dto.kind === 'IMAGE' && !dto.imageUrl?.trim()) {
      throw new BadRequestException(
        'Thông tin dùng chung dạng ảnh cần có ảnh.',
      );
    }
    return db.speakingStimulus.create({
      data: {
        kind: dto.kind,
        title: dto.title?.trim() || null,
        content: dto.content?.trim() || null,
        imageUrl: dto.imageUrl?.trim() || null,
      },
    });
  }

  async updateSpeakingStimulus(
    rawId: string,
    dto: SpeakingStimulusDto,
    user: Admin,
  ) {
    this.admin(user);
    const id = this.id(rawId);
    const existing = await this.prisma.speakingStimulus.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException('Không tìm thấy thông tin dùng chung.');
    const kind = dto.kind ?? existing.kind;
    const content = dto.content === undefined ? existing.content : dto.content;
    const imageUrl =
      dto.imageUrl === undefined ? existing.imageUrl : dto.imageUrl;
    if (kind === 'INFORMATION' && !content?.trim()) {
      throw new BadRequestException(
        'Thông tin dùng chung dạng văn bản cần có nội dung.',
      );
    }
    if (kind === 'IMAGE' && !imageUrl?.trim()) {
      throw new BadRequestException(
        'Thông tin dùng chung dạng ảnh cần có ảnh.',
      );
    }
    return this.prisma.speakingStimulus.update({
      where: { id },
      data: {
        kind,
        title: dto.title === undefined ? existing.title : dto.title.trim(),
        content: content?.trim() || null,
        imageUrl: imageUrl?.trim() || null,
      },
    });
  }

  /**
   * Deletes a whole skill item (owner 2026-11-17). Refused once learners have
   * worked on it (their submissions would cascade away), for exam content, and
   * for a quiz that is not a draft: see skill-content-delete.ts.
   */
  async deleteContent(rawDomain: string, rawId: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    // Each branch checks and deletes in one transaction, with the rows a
    // learner's recording or submission points to locked (audit A5,
    // 2026-11-18): that insert either committed before the lock and is
    // counted, or it waits and then fails on the deleted row. Before, one
    // saved between the count and the delete went with the content.
    // Its own R2 files go after the commit (bug 2026-11-22).
    if (domain === 'speaking') {
      let exercises: Array<{ id: number; audioUrl: string | null }> = [];
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "SpeakingPracticeSet" WHERE id = ${rawId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "SpeakingExercise" WHERE "practiceSetId" = ${rawId} FOR UPDATE`;
        const set = await tx.speakingPracticeSet.findUnique({
          where: { id: rawId },
          select: { id: true, scope: true, publicationStatus: true },
        });
        if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
        const attempts = await tx.speakingSubmission.count({
          where: { exercise: { practiceSetId: set.id } },
        });
        const refusal = skillDeleteRefusal({
          domain,
          status: set.publicationStatus,
          attempts,
          examInternal: set.scope === 'EXAM_INTERNAL',
        });
        if (refusal) throw new ConflictException(refusal);
        exercises = await tx.speakingExercise.findMany({
          where: { practiceSetId: set.id },
          select: { id: true, audioUrl: true },
        });
        // practiceSet on SpeakingExercise is SetNull: delete the exercises
        // first so none is left behind without a set.
        await tx.speakingExercise.deleteMany({
          where: { practiceSetId: set.id },
        });
        await tx.speakingPracticeSet.delete({ where: { id: set.id } });
        return { id: set.id, deleted: true };
      });
      await this.removeSpeakingExerciseFiles(exercises);
      return result;
    }
    const id = this.id(rawId);
    let files: ContentFile[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Quiz" WHERE id = ${id} FOR UPDATE`;
      const quiz = await tx.quiz.findFirst({
        where: { id, ...this.contentTypeWhere(domain) },
        select: { id: true, publicationStatus: true },
      });
      if (!quiz) throw new NotFoundException('Không tìm thấy bài này.');
      const attempts = await tx.submission.count({
        where: { quizId: id },
      });
      const refusal = skillDeleteRefusal({
        domain,
        status: quiz.publicationStatus,
        attempts,
        examInternal: await this.isExamTask(id),
      });
      if (refusal) throw new ConflictException(refusal);
      // Read before the delete: the asset and artifact rows cascade with it.
      if (domain === 'listening') files = await this.listeningQuizFiles(tx, id);
      try {
        await tx.quiz.delete({ where: { id } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2003')
          throw new ConflictException(
            'Bài đang được dùng ở nơi khác nên chưa xoá được.',
          );
        throw error;
      }
      // Tags have no foreign key to the quiz: left behind, they would keep
      // their track counted as in use and block its delete.
      await tx.contentTrackTag.deleteMany({
        where: { contentType: 'QUIZ', contentId: id },
      });
      return { id, deleted: true };
    });
    await this.removeFiles(files);
    return result;
  }

  /**
   * The audio a listening quiz owns: every version of every question clip,
   * and every whole-quiz artifact. Each key is checked against the quiz's own
   * prefix before any delete (ownedContentKey).
   */
  private async listeningQuizFiles(
    db: Prisma.TransactionClient,
    quizId: number,
  ): Promise<ContentFile[]> {
    const owner = { kind: 'listening-quiz', quizId } as const;
    const assets = await db.quizAudioAsset.findMany({
      where: { question: { quizId } },
      select: { key: true },
    });
    const artifacts = await db.listeningAudioArtifact.findMany({
      where: { quizId },
      select: { r2Key: true },
    });
    return [
      ...assets.map((a) => ({ owner, stored: a.key })),
      ...artifacts.map((a) => ({ owner, stored: a.r2Key })),
    ];
  }

  /**
   * After the delete has committed: the reference audio the server made for
   * these exercises. An exam deletes its exercise in its own transaction and
   * calls this after it commits.
   */
  async removeSpeakingExerciseFiles(
    exercises: Array<{ id: number; audioUrl: string | null }>,
  ) {
    await this.removeFiles(
      exercises.map((e) => ({
        owner: { kind: 'speaking-exercise', exerciseId: e.id } as const,
        stored: e.audioUrl,
      })),
    );
  }

  /** Best effort: a file that cannot go never fails the delete. */
  private async removeFiles(files: ContentFile[]) {
    if (!files.length || !this.contentFiles) return;
    await this.contentFiles.removeFiles(files).catch(() => undefined);
  }

  async deleteSpeakingExercise(
    rawDomain: string,
    rawSetId: string,
    rawExerciseId: string,
    user: Admin,
    client?: Prisma.TransactionClient,
  ) {
    this.admin(user);
    // An exam's Speaking section passes the transaction that holds the exam
    // lock (inDraftExam); the skill practice CMS passes none.
    const db: Prisma.TransactionClient = client ?? this.prisma;
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Câu luyện chỉ dùng cho kỹ năng Nói.');
    const exerciseId = this.id(rawExerciseId);
    const exercise = await db.speakingExercise.findFirst({
      where: { id: exerciseId, practiceSetId: rawSetId },
    });
    if (!exercise) throw new NotFoundException('Không tìm thấy bài luyện Nói.');
    await this.assertNoSpeakingHistory(rawSetId, db);
    const removed = await this.inTransaction(
      client,
      async (tx) => {
        // Counted again with the exercise row locked (audit A5 follow-up,
        // 2026-11-18): a recording saved between the check above and the
        // delete was removed with the exercise. A recording on it now waits,
        // then fails on its foreign key.
        await tx.$queryRaw`SELECT id FROM "SpeakingExercise" WHERE id = ${exerciseId} FOR UPDATE`;
        await this.assertNoSpeakingHistory(rawSetId, tx);
        const deleted = await tx.speakingExercise.delete({
          where: { id: exerciseId },
        });
        const remaining = await tx.speakingExercise.findMany({
          where: { practiceSetId: rawSetId },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: rawSetId },
          data: { order: null },
        });
        for (const [index, item] of remaining.entries()) {
          await tx.speakingExercise.update({
            where: { id: item.id },
            data: { order: index + 1 },
          });
        }
        return deleted;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    // An exam's transaction has not committed yet: the exam removes the file.
    if (!client) await this.removeSpeakingExerciseFiles([removed]);
    return removed;
  }

  async reorderSpeakingExercises(
    rawDomain: string,
    rawSetId: string,
    dto: SpeakingExerciseReorderDto,
    user: Admin,
    client?: Prisma.TransactionClient,
  ) {
    this.admin(user);
    // An exam's Speaking section passes the transaction that holds the exam
    // lock (inDraftExam); the skill practice CMS passes none.
    const db: Prisma.TransactionClient = client ?? this.prisma;
    if (this.domain(rawDomain) !== 'speaking')
      throw new BadRequestException('Câu luyện chỉ dùng cho kỹ năng Nói.');
    const set = await db.speakingPracticeSet.findUnique({
      where: { id: rawSetId },
      select: { id: true, publicationStatus: true },
    });
    if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
    if (set.publicationStatus === QuizPublicationStatus.PUBLISHED) {
      throw new ConflictException(
        'Hãy chuyển bộ luyện về bản nháp trước khi sắp xếp lại câu',
      );
    }
    await this.assertNoSpeakingHistory(rawSetId, db);

    const current = await db.speakingExercise.findMany({
      where: { practiceSetId: rawSetId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const requested = dto.exerciseIds;
    if (
      requested.length !== current.length ||
      new Set(requested).size !== requested.length ||
      requested.some((id) => !current.some((item) => item.id === id))
    ) {
      throw new BadRequestException(
        'Danh sách sắp xếp phải chứa đúng một lần toàn bộ câu trong bộ luyện',
      );
    }

    return this.inTransaction(
      client,
      async (tx) => {
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: rawSetId },
          data: { order: null },
        });
        for (const [index, id] of requested.entries()) {
          await tx.speakingExercise.update({
            where: { id },
            data: { order: index + 1 },
          });
        }
        return tx.speakingPracticeSet.findUnique({
          where: { id: rawSetId },
          include: {
            exercises: {
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
              include: { stimulus: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateQuestion(
    rawDomain: string,
    rawId: string,
    rawQuestionId: string,
    dto: SkillQuestionDto,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking')
      throw new BadRequestException(
        'Câu hỏi Nói được quản lý dưới dạng bài luyện.',
      );
    const quizId = this.id(rawId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: this.contentTypeWhere(domain),
      },
    });
    if (!question)
      throw new NotFoundException('Câu hỏi không thuộc nội dung kỹ năng này.');
    await this.assertQuestionEditable(quizId, question, dto);
    return this.prisma.question.update({
      where: { id: questionId },
      data: { type: dto.type, content: asJson(dto.content), order: dto.order },
    });
  }

  async deleteQuestion(
    rawDomain: string,
    rawId: string,
    rawQuestionId: string,
    user: Admin,
  ) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking')
      throw new BadRequestException(
        'Câu hỏi Nói được quản lý dưới dạng bài luyện.',
      );
    const quizId = this.id(rawId);
    const questionId = this.id(rawQuestionId);
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: this.contentTypeWhere(domain),
      },
    });
    if (!question)
      throw new NotFoundException('Câu hỏi không thuộc nội dung kỹ năng này.');
    await this.assertNoHistory(quizId);
    // Read before the delete: the clip rows cascade with the question. Its
    // reading or writing images are generic uploads and stay.
    const owner = { kind: 'listening-question', quizId, questionId } as const;
    const files: ContentFile[] =
      domain === 'listening'
        ? (
            await this.prisma.quizAudioAsset.findMany({
              where: { questionId },
              select: { key: true },
            })
          ).map((a) => ({ owner, stored: a.key }))
        : [];
    const deleted = await this.prisma.question.delete({
      where: { id: questionId },
    });
    await this.removeFiles(files);
    return deleted;
  }

  async validate(rawDomain: string, rawId: string, user: Admin) {
    this.admin(user);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') return this.validateSpeaking(rawId);
    const quiz = (await this.get(domain, rawId, user)) as unknown as {
      id: number;
      type?: QuizType;
      title?: string;
      questions: Array<{
        type: string;
        content: unknown;
        audioAssets?: Array<{ isActive: boolean }>;
      }>;
    };
    const errors: string[] = [];
    // A hand-made dialogue keeps its turns in a DIALOGUE question: it is not
    // a question a learner answers, so it is not counted or numbered.
    const answered = quiz.questions.filter(
      (question) => domain !== 'listening' || !isTranscriptHolder(question),
    );
    const labels = new Map<(typeof quiz.questions)[number], string>();
    for (const question of quiz.questions)
      labels.set(
        question,
        answered.includes(question)
          ? `Câu ${answered.indexOf(question) + 1}`
          : 'Lời thoại',
      );
    if (!quiz.title?.trim()) errors.push('Thiếu tiêu đề');
    if (!answered.length) errors.push('Cần ít nhất một câu hỏi');
    if (!parseCefrRange(quiz.title) && !(await this.isExamTask(quiz.id)))
      errors.push('Chưa có trình độ: chọn trình độ rồi lưu lại');
    if (
      domain === 'listening' &&
      answered.length &&
      answered.every((q) => q.type === 'DICTATION') &&
      answered.length < DICTATION_MIN_SENTENCES
    )
      errors.push(
        `Bài nghe chép cần ít nhất ${DICTATION_MIN_SENTENCES} câu (đang có ${answered.length})`,
      );
    for (const question of quiz.questions) {
      const label = labels.get(question);
      const content = asRecord(question.content);
      if (domain === 'reading') {
        const options = content.options;
        const correctIndex = content.correctIndex as number;
        if (
          !Array.isArray(options) ||
          !Number.isInteger(correctIndex) ||
          correctIndex < 0 ||
          correctIndex >= options.length
        )
          errors.push(`${label}: ${CHOICES_INCOMPLETE}`);
      }
      if (
        domain === 'writing' &&
        (typeof (content.prompt ?? content.text) !== 'string' ||
          !String(content.prompt ?? content.text).trim())
      )
        errors.push(`${label}: thiếu đề bài`);
      if (domain === 'writing' && question.type !== 'WRITING')
        errors.push(`${label}: không phải câu của bài viết`);
      if (
        domain === 'writing' &&
        quiz.type === QuizType.WRITING_EMAIL &&
        (typeof content.taskType !== 'string' || !content.taskType.trim())
      )
        errors.push(`${label}: chưa chọn dạng đề`);
      if (
        domain === 'writing' &&
        quiz.type === QuizType.WRITING_PICTURE &&
        typeof content.taskType === 'string' &&
        ['PICTURE', 'PICTURE_SENTENCE', 'DESCRIBE_PICTURE'].includes(
          content.taskType.trim().toUpperCase(),
        ) &&
        !isAcceptedContentImageReference(content.imageUrl)
      )
        errors.push(`${label}: câu theo tranh chưa có ảnh`);
      if (
        domain === 'writing' &&
        typeof content.taskType === 'string' &&
        content.taskType.trim().toUpperCase() === SENTENCE_TRANSLATION
      )
        for (const issue of translationTaskIssues(content))
          errors.push(`${label}: ${issue}`);
      if (domain === 'writing' && content.wordRange !== undefined) {
        const range = content.wordRange;
        if (
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every((value) => Number.isInteger(value) && value > 0) ||
          range[0] > range[1]
        )
          errors.push(`${label}: số từ tối thiểu, tối đa không hợp lệ`);
      }
      if (
        domain === 'listening' &&
        question.type === 'DICTATION' &&
        ![
          content.correctAnswer,
          content.audioText,
          content.text,
          content.prompt,
        ].some((value) => typeof value === 'string' && value.trim())
      )
        errors.push(`${label}: chưa có câu cần chép`);
      if (
        domain === 'listening' &&
        question.type === 'MULTIPLE_CHOICE' &&
        (() => {
          const correctIndex = content.correctIndex;
          return (
            !Array.isArray(content.options) ||
            typeof correctIndex !== 'number' ||
            !Number.isInteger(correctIndex) ||
            correctIndex < 0 ||
            correctIndex >= content.options.length
          );
        })()
      )
        errors.push(`${label}: ${CHOICES_INCOMPLETE}`);
      if (
        domain === 'listening' &&
        question.type === 'DIALOGUE' &&
        (!Array.isArray(content.transcriptSegments) ||
          normalizeDialogueSegments(content.transcriptSegments).length < 2 ||
          new Set(
            normalizeDialogueSegments(content.transcriptSegments).map(
              (segment) => segment.speakerId ?? segment.speaker,
            ),
          ).size < 2)
      )
        errors.push(`${label}: cần ít nhất 2 lượt lời của 2 người nói`);
    }
    // A learner hears either the question's own clip or, for questions that
    // share the conversation, the quiz's published recording.
    if (domain === 'listening' && quiz.questions.length) {
      const recording = this.listeningAudioAuthoring
        ? await this.listeningAudioAuthoring.getCurrentPublishedArtifact(
            quiz.id,
          )
        : null;
      for (const question of quiz.questions) {
        const content = asRecord(question.content);
        const ownClip = (question.audioAssets ?? []).some(
          (asset) => asset.isActive,
        );
        const sharesRecording =
          Boolean(recording) &&
          (typeof content.targetTurnId === 'string' ||
            (Array.isArray(content.transcriptSegments) &&
              content.transcriptSegments.length > 0));
        if (!ownClip && !sharesRecording)
          errors.push(`${labels.get(question)}: chưa có audio cho học viên`);
      }
    }
    return { valid: errors.length === 0, errors, domain, quizId: quiz.id };
  }

  async publish(
    rawDomain: string,
    rawId: string,
    status: QuizPublicationStatus,
    user: Admin,
  ) {
    this.admin(user);
    const check = await this.validate(rawDomain, rawId, user);
    if (!check.valid && status === QuizPublicationStatus.PUBLISHED)
      throw new BadRequestException(check.errors);
    const domain = this.domain(rawDomain);
    if (domain === 'speaking') {
      const id = rawId;
      const set = await this.prisma.speakingPracticeSet.findUnique({
        where: { id },
        include: { exercises: true },
      });
      if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.speakingPracticeSet.update({
          where: { id },
          data: { publicationStatus: status },
        });
        await tx.speakingExercise.updateMany({
          where: { practiceSetId: id },
          data: { publicationStatus: status },
        });
        return updated;
      });
    }
    const id = this.id(rawId);
    return this.prisma.quiz.update({
      where: { id },
      data: {
        publicationStatus: status,
        publishedAt:
          status === QuizPublicationStatus.PUBLISHED ? new Date() : undefined,
      },
    });
  }

  private id(raw: string) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1)
      throw new BadRequestException('Mã nội dung không hợp lệ.');
    return id;
  }

  /** The stored content after a form save: lib in writing-question-content.logic.ts. */
  private writingContent(
    dto: WritingQuestionDto,
    previous?: unknown,
  ): Prisma.InputJsonValue {
    return writingQuestionContent(dto, previous) as Prisma.InputJsonValue;
  }

  private assertWritingTaskType(
    quizType: QuizType | undefined,
    taskType?: string,
  ) {
    const normalizedTaskType = taskType?.trim().toUpperCase();
    if (!normalizedTaskType) return;
    if (
      quizType === QuizType.WRITING_PICTURE &&
      !PICTURE_WRITING_TASK_TYPES.has(normalizedTaskType)
    ) {
      throw new BadRequestException(
        'Writing theo tranh chỉ nhận task family của dạng tranh',
      );
    }
    if (
      quizType === QuizType.WRITING_EMAIL &&
      PICTURE_WRITING_TASK_TYPES.has(normalizedTaskType)
    ) {
      throw new BadRequestException(
        'Writing Email không nhận task family của dạng tranh',
      );
    }
  }

  private requireListeningAuthoring() {
    if (!this.listeningAudioAuthoring || !this.quizService)
      throw new ServiceUnavailableException(
        'Công cụ soạn bài Nghe hiện không khả dụng.',
      );
    return {
      audio: this.listeningAudioAuthoring,
      quiz: this.quizService,
    };
  }

  async validateListeningAudio(quizId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.validateContent(quizId);
  }

  async generateListeningAudioPreview(quizId: number, user: Admin) {
    this.admin(user);
    await this.assertContentEditable(quizId);
    return this.requireListeningAuthoring().audio.generatePreview(
      quizId,
      user.id,
    );
  }

  async listListeningAudio(quizId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.listArtifacts(quizId);
  }

  async approveListeningAudio(quizId: number, artifactId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.approve(
      quizId,
      artifactId,
      user.id,
    );
  }

  async publishListeningAudio(quizId: number, artifactId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.publish(
      quizId,
      artifactId,
      user.id,
    );
  }

  async previewListeningAudio(quizId: number, artifactId: number, user: Admin) {
    this.admin(user);
    return this.requireListeningAuthoring().audio.getPreviewAudio(
      quizId,
      artifactId,
    );
  }

  private async assertListeningQuestion(quizId: number, questionId: number) {
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
        quizId,
        quiz: { type: QuizType.LISTENING_PRACTICE },
      },
      select: { id: true },
    });
    if (!question) throw new NotFoundException('Không tìm thấy câu hỏi Nghe.');
  }

  async uploadListeningQuestionAudio(
    quizId: number,
    questionId: number,
    file: Express.Multer.File,
    user: Admin,
  ) {
    this.admin(user);
    await this.assertListeningQuestion(quizId, questionId);
    await this.assertContentEditable(quizId);
    return this.requireListeningAuthoring().quiz.createAudioAsset(
      questionId,
      file,
    );
  }

  async generateListeningDialogueAudio(
    quizId: number,
    questionId: number,
    user: Admin,
  ) {
    this.admin(user);
    await this.assertListeningQuestion(quizId, questionId);
    // Re-recording the same sentence changes no answer or score, so it is
    // allowed after learners have taken the quiz.
    return this.requireListeningAuthoring().quiz.generateDialogueAudioAsset(
      questionId,
    );
  }

  private async assertNoHistory(quizId: number) {
    const count = await this.prisma.submission.count({ where: { quizId } });
    if (count > 0)
      throw new ConflictException(
        'Nội dung đã có lịch sử làm bài; không thể thêm hoặc xoá câu.',
      );
  }

  /**
   * Practice with attempts can be edited in place. A TOEIC exam task cannot:
   * its attempts must keep matching the exam, so the exam is duplicated instead.
   */
  private async assertContentEditable(quizId: number) {
    const count = await this.prisma.submission.count({ where: { quizId } });
    if (count === 0) return 'NONE' as const;
    if (await this.isExamTask(quizId))
      throw new ConflictException(EXAM_CONTENT_LOCKED);
    return 'PRACTICE' as const;
  }

  private async isExamTask(quizId: number) {
    const items = await this.prisma.toeicWritingSetItem.count({
      where: { writingQuizId: quizId },
    });
    return items > 0;
  }

  private async assertQuestionEditable(
    quizId: number,
    before: { type?: string | null; content?: unknown },
    after: { type?: string | null; content?: unknown },
  ) {
    const lock = await this.assertContentEditable(quizId);
    const problem = lock === 'PRACTICE' && historyEditProblem(before, after);
    if (problem) throw new ConflictException(problem);
  }

  private async validateSpeaking(rawId: string) {
    const set = await this.prisma.speakingPracticeSet.findUnique({
      where: { id: rawId },
      include: { exercises: { include: { stimulus: true } } },
    });
    if (!set) throw new NotFoundException('Không tìm thấy bộ luyện Nói.');
    const errors = [
      !set.title.trim() ? 'Thiếu tiêu đề' : null,
      set.exercises.length === 0 ? 'Cần ít nhất một câu luyện.' : null,
      ...set.exercises.map((exercise) =>
        !exercise.title.trim() || !exercise.targetText.trim()
          ? `Câu #${exercise.id}: thiếu tiêu đề hoặc câu mẫu.`
          : null,
      ),
      ...set.exercises.flatMap((exercise) =>
        taskTypeValidationErrors({
          taskType: exercise.taskType,
          targetText: exercise.targetText,
          imageUrl: exercise.imageUrl,
          stimulusId: exercise.stimulusId,
          stimulus: exercise.stimulus,
        }).map((error) => `Câu #${exercise.id}: ${error}`),
      ),
    ].filter((value): value is string => Boolean(value));
    if (set.scope === 'EXAM_INTERNAL') {
      errors.push(...toeicSpeakingContractErrors(set));
    }
    return {
      valid: errors.length === 0,
      errors,
      domain: 'speaking',
      contentId: set.id,
    };
  }

  /** Runs on the caller's transaction when given one: Prisma cannot nest them. */
  private inTransaction<T>(
    client: Prisma.TransactionClient | undefined,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    return client ? work(client) : this.prisma.$transaction(work, options);
  }

  private async assertNoSpeakingHistory(
    setId: string,
    client: Pick<Prisma.TransactionClient, 'speakingSubmission'> = this.prisma,
  ) {
    const count = await client.speakingSubmission.count({
      where: { exercise: { practiceSetId: setId } },
    });
    if (count > 0)
      throw new ConflictException(
        'Bộ luyện nói đã có lịch sử làm bài; không thể xoá hoặc sắp xếp lại câu.',
      );
  }

  /** True when the set has attempts. Exam sets with attempts stay locked. */
  private async assertSpeakingEditable(
    setId: string,
    client: Pick<
      Prisma.TransactionClient,
      'speakingSubmission' | 'toeicAssessmentComponent'
    > = this.prisma,
  ) {
    const count = await client.speakingSubmission.count({
      where: { exercise: { practiceSetId: setId } },
    });
    if (count === 0) return false;
    const examParts = await client.toeicAssessmentComponent.count({
      where: { speakingPracticeSetId: setId },
    });
    if (examParts > 0) throw new ConflictException(EXAM_CONTENT_LOCKED);
    return true;
  }
}
