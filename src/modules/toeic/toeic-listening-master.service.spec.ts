import { planMaster } from './listening-master/master-script';
import {
  isFullListening,
  listeningSourceHash,
  ToeicListeningMasterService,
} from './toeic-listening-master.service';

const group = (id: number, part: number, numbers: number[], extra = {}) => ({
  id,
  part,
  groupOrder: id,
  audioUrl: `premium/listening/toeic/${id}.mp3`,
  mediaMetadata: { audio: { sourceHash: `hash-${id}` } },
  questions: numbers.map((questionNumber) => ({ questionNumber })),
  ...extra,
});

const fullSection = () => [
  ...Array.from({ length: 31 }, (_, i) => group(i + 1, i < 6 ? 1 : 2, [i + 1])),
  ...Array.from({ length: 23 }, (_, i) =>
    group(100 + i, i < 13 ? 3 : 4, [32 + i * 3, 33 + i * 3, 34 + i * 3]),
  ),
];

describe('planMaster', () => {
  const clips = [
    { groupId: 1, part: 1, questionNumbers: [1] },
    { groupId: 2, part: 3, questionNumbers: [32, 33, 34] },
  ];
  const plan = planMaster(clips, () => 10);

  it('opens with the intro and ends with the closing line', () => {
    expect(plan.timeline[0]).toMatchObject({ kind: 'INTRO', start: 0 });
    expect(plan.timeline[plan.timeline.length - 1].kind).toBe('END');
  });

  it('gives every question of a Part 3 group its own answer time', () => {
    const position = plan.items.findIndex(
      (item) => item.kind === 'clip' && item.groupId === 2,
    );
    expect(plan.items[position + 1]).toEqual({ kind: 'silence', seconds: 24 });
  });

  it('places each group after the directions of its Part', () => {
    const part1 = plan.timeline.find((entry) => entry.kind === 'DIRECTIONS');
    const first = plan.timeline.find((entry) => entry.groupId === 1);
    expect(first!.start).toBeGreaterThanOrEqual(part1!.end);
  });
});

describe('listening source hash', () => {
  it('changes when a clip changes and not otherwise', () => {
    const base = listeningSourceHash([group(1, 1, [1])]);
    expect(listeningSourceHash([group(1, 1, [1])])).toBe(base);
    expect(
      listeningSourceHash([
        group(1, 1, [1], { mediaMetadata: { audio: { sourceHash: 'new' } } }),
      ]),
    ).not.toBe(base);
  });
});

describe('isFullListening', () => {
  it('accepts questions 1 to 100 and nothing shorter', () => {
    expect(isFullListening(fullSection())).toBe(true);
    expect(isFullListening([group(1, 1, [1])])).toBe(false);
  });
});

describe('ToeicListeningMasterService', () => {
  const build = (stored: unknown) => {
    const groups = fullSection();
    const service: any = Object.create(ToeicListeningMasterService.prototype);
    service.building = new Map();
    service.manifests = new Map();
    service.logger = { warn: jest.fn(), log: jest.fn() };
    service.prisma = {
      toeicQuestionGroup: { findMany: jest.fn().mockResolvedValue(groups) },
    };
    service.r2 = {
      privateObjectExists: jest.fn().mockResolvedValue(Boolean(stored)),
      downloadPrivateFileBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from(JSON.stringify(stored ?? {}))),
    };
    service.build = jest.fn().mockResolvedValue({ examId: 4, built: true });
    return { service, groups };
  };

  it('builds when no recording exists', async () => {
    const { service } = build(null);
    await expect(service.ensure(4)).resolves.toMatchObject({ built: true });
    expect(service.build).toHaveBeenCalledTimes(1);
  });

  it('reuses a recording that still matches the clips', async () => {
    const stored = {
      examId: 4,
      sourceHash: listeningSourceHash(fullSection()),
    };
    const { service } = build(stored);
    await expect(service.ensure(4)).resolves.toMatchObject({ examId: 4 });
    expect(service.build).not.toHaveBeenCalled();
    await expect(service.state(4)).resolves.toMatchObject({ state: 'READY' });
  });

  it('rebuilds and reports stale once a clip changed', async () => {
    const { service } = build({ examId: 4, sourceHash: 'old' });
    await expect(service.state(4)).resolves.toMatchObject({ state: 'STALE' });
    await expect(service.current(4)).resolves.toBeNull();
    await service.ensure(4);
    expect(service.build).toHaveBeenCalledTimes(1);
  });

  it('refuses when a group has no audio', async () => {
    const { service, groups } = build(null);
    (groups[0] as { audioUrl: string | null }).audioUrl = null;
    await expect(service.ensure(4)).rejects.toThrow('chưa có audio');
    expect(service.build).not.toHaveBeenCalled();
  });

  it('builds once when two publishes arrive together', async () => {
    const { service } = build(null);
    await Promise.all([service.ensure(4), service.ensure(4)]);
    expect(service.build).toHaveBeenCalledTimes(1);
  });

  it('skips an exam without a full Listening section', async () => {
    const { service } = build(null);
    service.prisma.toeicQuestionGroup.findMany.mockResolvedValue([]);
    await expect(service.ensure(4)).resolves.toBeNull();
    await expect(service.state(4)).resolves.toEqual({ state: 'NOT_NEEDED' });
  });

  it('never builds for an exam with a registered recording', async () => {
    const { service } = build(null);
    await expect(service.ensure(1)).resolves.toMatchObject({ examId: 1 });
    expect(service.build).not.toHaveBeenCalled();
  });
});
