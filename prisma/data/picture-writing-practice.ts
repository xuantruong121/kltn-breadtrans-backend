/**
 * "Viết câu theo tranh" — picture-based Writing practice (Checkpoint 58).
 *
 * Original BreadTrans material. The pictures are the project's own seed
 * assets (prisma/seed-assets, already published under
 * catalog/toeic/shared/images and used by Speaking "Describe a Picture"); no
 * third-party picture or question is copied. Each task has one picture, two
 * English cue words, a 40-word limit and an authored scene description that
 * the grader uses as the truth about the image (the grader does not see it).
 *
 * The CEFR tag in each title decides access like every practice item:
 * A2 is free, B1 needs PRO (Writing). Written to a database only by
 * scripts/materialize-picture-writing.ts.
 */
export const PICTURE_WRITING_TOPIC = {
  name: 'Picture Writing',
  vietnameseName: 'Viết câu theo tranh',
} as const;

export const PICTURE_IMAGE_PREFIX = 'catalog/toeic/shared/images';

const RUBRIC = { grammar: 4, vocabulary: 2, taskCompletion: 4 };

export type PictureTaskSeed = {
  image: string;
  keywords: [string, string];
  sceneDescription: string;
  sampleResponse: string;
};

export type PictureExerciseSeed = {
  title: string;
  description: string;
  isPremiumContent: boolean;
  prompt: string;
  /** Shown to the learner; the grader receives the same list. */
  requirements: string[];
  /** B1: one sentence linking two ideas with a connector. */
  requireLinking: boolean;
  tasks: PictureTaskSeed[];
};

export const PICTURE_WRITING_EXERCISES: PictureExerciseSeed[] = [
  {
    title: 'Viết câu theo tranh: đời sống và dịch vụ (A2)',
    description:
      'Nhìn tranh và viết một hoặc hai câu đơn giản về người, hành động và đồ vật, dùng hai từ gợi ý.',
    isPremiumContent: false,
    prompt:
      'Viết một hoặc hai câu mô tả bức tranh, dùng đúng cả hai từ gợi ý. Tối đa 40 từ.',
    requirements: [
      'Dùng đúng cả hai từ gợi ý (có thể chia động từ, số nhiều).',
      'Mô tả đúng người, hành động hoặc đồ vật trong tranh.',
      'Tối đa 40 từ.',
    ],
    requireLinking: false,
    tasks: [
      {
        image: 'grocery-checkout.png',
        keywords: ['cashier', 'scan'],
        sceneDescription:
          'At a supermarket checkout, a smiling woman in a beige coat holds a card to the card reader to pay. A cashier in a black apron scans a jar of red sauce. Bananas, lettuce, bread, tomatoes, a red pepper and a bottle of milk are on the counter.',
        sampleResponse:
          'The cashier is scanning a jar of sauce while a woman pays by card.',
      },
      {
        image: 'cafe-counter.png',
        keywords: ['order', 'counter'],
        sceneDescription:
          'In a bright café, a young man and a young woman stand at a wooden counter to order. Behind the counter a barista pours milk into a cup. A glass case shows croissants and muffins, and other customers sit at tables near large windows.',
        sampleResponse:
          'A young couple is ordering drinks at the counter of a busy café.',
      },
      {
        image: 'delivery-boxes.png',
        keywords: ['carry', 'boxes'],
        sceneDescription:
          'A delivery man in a dark cap and uniform carries three cardboard boxes through the open glass door of a small shop. A white van with its back doors open is parked outside. The shop has shelves of jars and a plant near the door.',
        sampleResponse:
          'A delivery man is carrying three boxes into a small shop.',
      },
      {
        image: 'restaurant-service.png',
        keywords: ['waiter', 'table'],
        sceneDescription:
          'In a restaurant, a smiling waiter in a white shirt and black apron puts a plate of food on a wooden table. A woman and a man sit at the table with glasses of wine and water, a small vase of white flowers, and salt and pepper.',
        sampleResponse:
          'The waiter is serving a plate of food to two people at a table.',
      },
      {
        image: 'departure-board.png',
        keywords: ['suitcase', 'board'],
        sceneDescription:
          'In a large airport hall, a man and a woman wearing backpacks stand with their suitcases and look up at a big departure board showing flight times. Other passengers walk and sit in the background.',
        sampleResponse:
          'Two travelers with suitcases are looking at the departure board.',
      },
    ],
  },
  {
    title: 'Viết câu theo tranh: nơi làm việc (B1)',
    description:
      'Nhìn tranh về công việc và viết một câu nối hai ý (hai hành động, hành động và bối cảnh, hoặc mục đích) bằng từ nối, dùng hai từ gợi ý.',
    isPremiumContent: true,
    prompt:
      'Viết MỘT câu mô tả bức tranh, nối hai ý trong tranh bằng một từ nối như while, because, so that, when hoặc which, và dùng đúng cả hai từ gợi ý. Tối đa 40 từ.',
    requirements: [
      'Dùng đúng cả hai từ gợi ý (có thể chia động từ, số nhiều).',
      'Viết một câu nối hai ý bằng từ nối: while, when, because, so that, which, who, where, although…',
      'Chỉ dùng chi tiết có trong tranh.',
      'Tối đa 40 từ.',
    ],
    requireLinking: true,
    tasks: [
      {
        image: 'office-meeting.png',
        keywords: ['presentation', 'chart'],
        sceneDescription:
          'In a meeting room with a large window, a man in a dark suit stands and points with a pen at bar and pie charts on a flip chart. Three colleagues sit at a wooden table with laptops, papers and a coffee cup and listen to him; two of them take notes.',
        sampleResponse:
          'A manager is pointing at a chart during his presentation while two colleagues take notes.',
      },
      {
        image: 'folders-cabinet.png',
        keywords: ['file', 'shelf'],
        sceneDescription:
          'In an office storeroom, a woman in a light blue shirt puts a brown folder onto a tall metal shelf full of folders and blue magazine files. Piles of papers lie on a desk in front of her, and a grey filing cabinet stands near the window.',
        sampleResponse:
          'An office worker is putting a file on a tall shelf while piles of papers wait on the desk in front of her.',
      },
      {
        image: 'construction-plan.png',
        keywords: ['plan', 'site'],
        sceneDescription:
          'At a construction site, two men wearing hard hats, one white and one yellow, and bright safety vests hold a large paper plan and study it together. Behind them is an unfinished concrete building with block walls and wooden boards.',
        sampleResponse:
          'Two engineers in hard hats are studying a large plan at a construction site where the concrete walls are still unfinished.',
      },
      {
        image: 'ceiling-light.png',
        keywords: ['ladder', 'replace'],
        sceneDescription:
          'In a long office corridor, a man in a dark polo shirt and jeans stands on a yellow stepladder and replaces a round ceiling light. The hallway has a grey carpet, several doors and framed pictures on the walls.',
        sampleResponse:
          'A worker is standing on a yellow ladder so that he can replace a ceiling light in the office hallway.',
      },
      {
        image: 'bicycle-rack.png',
        keywords: ['bicycle', 'entrance'],
        sceneDescription:
          'Outside a modern glass office building, several bicycles are parked in a metal rack on the pavement. Near the revolving door at the entrance there is a large planter with white flowers, and young trees stand along the building.',
        sampleResponse:
          'Several bicycles are parked in a metal rack near the entrance of a glass building, which has a revolving door.',
      },
    ],
  },
];

/** The stored content of one task, as the Writing service reads it. */
export function pictureTaskContent(
  exercise: PictureExerciseSeed,
  task: PictureTaskSeed,
  imageBaseUrl: string,
) {
  return {
    skill: 'WRITING',
    taskType: 'PICTURE_SENTENCE',
    imageUrl: `${imageBaseUrl.replace(/\/$/, '')}/${PICTURE_IMAGE_PREFIX}/${task.image}`,
    prompt: exercise.prompt,
    requirements: exercise.requirements,
    requireLinking: exercise.requireLinking,
    requiredKeywords: [...task.keywords],
    sceneDescription: task.sceneDescription,
    sampleResponse: task.sampleResponse,
    wordRange: [1, 40],
    rubric: RUBRIC,
  };
}
