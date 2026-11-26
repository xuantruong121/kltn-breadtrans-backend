/**
 * "Viết câu theo tranh" — picture-based Writing practice (Checkpoint 58).
 *
 * Original BreadTrans material. The pictures are the project's own seed
 * assets, published on R2 under catalog/toeic/shared/images and used by
 * Speaking "Describe a Picture" (the local copies were removed 2026-11-26); no
 * third-party picture or question is copied. Each task has one picture, two
 * English cue words, a 40-word limit and an authored scene description that
 * the grader uses as the truth about the image (the grader does not see it).
 *
 * The CEFR tag in each title decides access like every practice item:
 * A2 is free, B1 needs PLUS (Writing, matrix 2026-10-30). Written to a database only by
 * scripts/materialize-picture-writing.ts.
 */
export const PICTURE_WRITING_TOPIC = {
  name: 'Picture Writing',
  vietnameseName: 'Viết câu theo tranh',
} as const;

export const PICTURE_IMAGE_PREFIX = 'catalog/toeic/shared/images';

const RUBRIC = { grammar: 4, vocabulary: 2, taskCompletion: 4 };

export type PictureTaskSeed = {
  /**
   * A file name under PICTURE_IMAGE_PREFIX (the first ten), or a full object
   * key in the public bucket (anything with a "/", the 2026-11-24 batch).
   */
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

/**
 * Second batch (owner 2026-11-24: "sinh thêm số lượng nhiều bài nữa", +20,
 * real CC0/PD photos, mostly free): three A2 sets and one B1 set of five.
 * Pictures and licences: artifacts/picture-writing-2026-11-24/CREDITS.md;
 * each key ends with the first 12 hex of the file's SHA-256. Written to a
 * database only by scripts/picture-writing-more-2026-11-24.ts.
 */
export const PICTURE_MORE_IMAGE_PREFIX = 'catalog/writing/picture';
export const PICTURE_MORE_ARTIFACT_DIR = 'artifacts/picture-writing-2026-11-24';

const [A2_BASE, B1_BASE] = PICTURE_WRITING_EXERCISES;
const sameRules = (base: PictureExerciseSeed) => ({
  isPremiumContent: base.isPremiumContent,
  prompt: base.prompt,
  requirements: base.requirements,
  requireLinking: base.requireLinking,
});
const moreImage = (name: string, sha12: string) =>
  `${PICTURE_MORE_IMAGE_PREFIX}/${name}-${sha12}.jpg`;

export const PICTURE_WRITING_MORE_EXERCISES: PictureExerciseSeed[] = [
  {
    title: 'Viết câu theo tranh: gia đình và thời gian rảnh (A2)',
    description:
      'Nhìn tranh về gia đình, bạn bè và giờ rảnh, viết một hoặc hai câu đơn giản về người và hành động, dùng hai từ gợi ý.',
    ...sameRules(A2_BASE),
    tasks: [
      {
        image: moreImage('kids-football', '2fd5335837ca'),
        keywords: ['ball', 'kick'],
        sceneDescription:
          'On a sunny grass field, a man in a dark blue T-shirt and camouflage trousers plays football with a group of children. A boy in a light blue shirt runs to kick a white ball while other children watch and run behind them.',
        sampleResponse:
          'A man and a boy are running to kick a white ball on the grass.',
      },
      {
        image: moreImage('family-picnic', '2d5830540ceb'),
        keywords: ['picnic', 'dog'],
        sceneDescription:
          'A family of four sits on a red picnic blanket on the grass in a sunny park. The father holds a small white and brown dog, the mother sits behind a girl who blows soap bubbles, and a boy sits next to a football.',
        sampleResponse:
          'A family is having a picnic in the park with their small dog.',
      },
      {
        image: moreImage('family-dinner', 'c50d58d9609c'),
        keywords: ['family', 'dinner'],
        sceneDescription:
          'A family of five sits around a table with a white cloth: a grandmother, a father, a mother, a girl and a boy. They smile and pass bowls of rice, salad and beans, there is a pot of stew in the middle, and a glass jug of water stands on the table.',
        sampleResponse:
          'A happy family is eating dinner together at a big table.',
      },
      {
        image: moreImage('couple-cooking', '48dd0c618469'),
        keywords: ['cook', 'kitchen'],
        sceneDescription:
          'In a bright white kitchen, a smiling woman in a light top holds a slice of bacon over a round pan on the cooktop, and a man in a light green polo shirt stirs the food with wooden chopsticks. A carton of eggs and some vegetables are on the counter.',
        sampleResponse:
          'A man and a woman are cooking bacon together in the kitchen.',
      },
      {
        image: moreImage('dog-walk', 'c3e183ffa511'),
        keywords: ['walk', 'dog'],
        sceneDescription:
          'Two young women walk along a curved road in a dry, rocky place under a blue sky. One woman in a red T-shirt and a cap holds a pink leash, and a white and brown dog walks in front of them next to the kerb. A dark car is parked on the right.',
        sampleResponse:
          'Two women are walking their dog along a road near the hills.',
      },
    ],
  },
  {
    title: 'Viết câu theo tranh: mua sắm và đi lại (A2)',
    description:
      'Nhìn tranh về chợ, cửa hàng, nhà ga và đường phố, viết một hoặc hai câu đơn giản, dùng hai từ gợi ý.',
    ...sameRules(A2_BASE),
    tasks: [
      {
        image: moreImage('train-platform', '038d095a9666'),
        keywords: ['train', 'platform'],
        sceneDescription:
          'Inside a large station with a glass and metal roof, a yellow and blue double-decker train stands at the platform. A board with a clock shows the next train, and a few people walk or wait on the long platform.',
        sampleResponse:
          'Some people are waiting on the platform next to a yellow train.',
      },
      {
        image: moreImage('street-market', 'dd783d8f9f68'),
        keywords: ['vegetables', 'market'],
        sceneDescription:
          'At an outdoor market on a wet, rainy day, wooden boxes of vegetables stand on long tables: carrots, peppers, tomatoes, broccoli, green beans and radishes. A man in a dark jacket and a cap bends over the stall, and white vans are parked behind it.',
        sampleResponse:
          'A man is arranging fresh vegetables at an outdoor market in the rain.',
      },
      {
        image: moreImage('bookstore-shelf', '241a1e4327a4'),
        keywords: ['phone', 'bookstore'],
        sceneDescription:
          'In a bookstore with dark shelves full of colourful books, a young man in a brown leather jacket holds his phone up high to take a photo. Behind him, a woman reads a small book near a counter with a laptop.',
        sampleResponse:
          'A young man is taking a photo with his phone in a bookstore.',
      },
      {
        image: moreImage('clothes-shop', 'cb1676e0e22c'),
        keywords: ['clothes', 'shop'],
        sceneDescription:
          'In a small shop, a young woman with long red hair looks at clothes on a long rail of hangers. Above her, a red sweater, hats and old paintings hang on the wall, and small owl figures stand on a shelf.',
        sampleResponse:
          'A young woman is looking at clothes on a rail in a small shop.',
      },
      {
        image: moreImage('city-cyclists', 'b74ac0d7fa69'),
        keywords: ['ride', 'street'],
        sceneDescription:
          'A group of cyclists in helmets and tight sports clothes ride racing bicycles down a city street on a sunny morning. Bright sunlight shines between the tall buildings, and a road sign with the number 30 stands on the right.',
        sampleResponse:
          'A group of cyclists are riding their bikes down a sunny city street.',
      },
    ],
  },
  {
    title: 'Viết câu theo tranh: con người quanh ta (A2)',
    description:
      'Nhìn tranh về những người làm việc và thư giãn quanh ta, viết một hoặc hai câu đơn giản, dùng hai từ gợi ý.',
    ...sameRules(A2_BASE),
    tasks: [
      {
        image: moreImage('laptop-coffee', 'ed307b13d40b'),
        keywords: ['laptop', 'coffee'],
        sceneDescription:
          'A close view of a white table: a person in a blue shirt types on a pink laptop. A paper cup of coffee with a black lid stands on the left, and a smartphone lies next to the laptop.',
        sampleResponse:
          'A person is typing on a laptop next to a cup of coffee.',
      },
      {
        image: moreImage('pier-fishing', '6da6e44f960c'),
        keywords: ['fish', 'pier'],
        sceneDescription:
          'On a long wooden pier with a white railing, a man in a red and dark blue jacket and a black cap leans on the railing and looks at the sea. Several fishing rods lean against the railing next to him, and a small white sailboat is on the water under a cloudy blue sky.',
        sampleResponse: 'A man is waiting to fish on a long pier by the sea.',
      },
      {
        image: moreImage('postman-cart', 'cc6d5776403c'),
        keywords: ['postman', 'letters'],
        sceneDescription:
          'In front of a building, a postman in a blue cap and an orange and dark blue jacket looks at the letters in his hands next to a wall of mailboxes. His orange and grey trolley with bags stands beside him, and a man in a dark jacket looks at his phone near the door.',
        sampleResponse:
          'A postman is checking letters next to the mailboxes of a building.',
      },
      {
        image: moreImage('firefighter-hydrant', '62a2ddfb1618'),
        keywords: ['hose', 'truck'],
        sceneDescription:
          'On a sunny street, a long yellow fire hose is connected to a yellow fire hydrant with a blue top on the grass. A firefighter in a blue helmet and a man in a white shirt stand near a red fire truck with a ladder on its roof.',
        sampleResponse:
          'A long yellow hose goes from the hydrant to a red fire truck.',
      },
      {
        image: moreImage('station-guitar', 'b75369054738'),
        keywords: ['guitar', 'station'],
        sceneDescription:
          'Inside a clean underground station with a white tiled floor, a young man in a cap sits on a stool and plays an acoustic guitar in front of a microphone. A woman sits on the floor behind him, and an open case with CDs and an empty guitar case lie on the floor.',
        sampleResponse:
          'A young man is playing the guitar in an underground station.',
      },
    ],
  },
  {
    title: 'Viết câu theo tranh: sức khỏe và dịch vụ (B1)',
    description:
      'Nhìn tranh về bệnh viện, phòng thí nghiệm, nhà kho và tiệm cắt tóc, viết một câu nối hai ý bằng từ nối, dùng hai từ gợi ý.',
    ...sameRules(B1_BASE),
    tasks: [
      {
        image: moreImage('nurse-blood-pressure', '9143bf528239'),
        keywords: ['nurse', 'check'],
        sceneDescription:
          "A nurse with glasses, a white uniform and a white cap checks a man's blood pressure. She listens with a stethoscope while she holds the cuff on his arm, and the man in a blue shirt watches her carefully.",
        sampleResponse:
          "A nurse is checking a man's blood pressure while she listens carefully through her stethoscope.",
      },
      {
        image: moreImage('doctor-patient', '67206582b236'),
        keywords: ['doctor', 'patient'],
        sceneDescription:
          'In a bright clinic office, an older doctor with white hair and a white coat types on a keyboard at his desk. A woman with short grey hair and glasses sits across the desk and touches her head as she talks to him, and a nurse in blue holds a clipboard behind the doctor.',
        sampleResponse:
          'The doctor is typing on his computer while the patient explains how she feels.',
      },
      {
        image: moreImage('lab-microscope', 'efc34e873cb8'),
        keywords: ['microscope', 'sample'],
        sceneDescription:
          'In a laboratory, a woman in a white lab coat looks into a light blue microscope. She holds a thin wooden stick near the small sample under the microscope, and papers are pinned on the wall behind her.',
        sampleResponse:
          'A scientist is looking through a microscope so that she can study a small sample.',
      },
      {
        image: moreImage('forklift-pallets', 'cea350edd55a'),
        keywords: ['forklift', 'warehouse'],
        sceneDescription:
          'In a large warehouse, a worker in a red hard hat and an orange safety vest drives a green forklift. Next to him stands a tall pile of boxes wrapped in plastic with the word USAID printed on them, and many more boxes are stored on shelves behind.',
        sampleResponse:
          'A worker is driving a forklift through the warehouse, which is full of boxes on high shelves.',
      },
      {
        image: moreImage('barber-shop', 'f7192f94539a'),
        keywords: ['barber', 'customer'],
        sceneDescription:
          "In a busy barber shop with black chairs and large mirrors, several barbers in black T-shirts cut men's hair. In front, a barber with a beard uses electric clippers on a customer's beard, and another customer behind him wears a cape with stripes and stars.",
        sampleResponse:
          'A barber is trimming the beard of a customer while other barbers cut hair behind him.',
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
  const key = task.image.includes('/')
    ? task.image
    : `${PICTURE_IMAGE_PREFIX}/${task.image}`;
  return {
    skill: 'WRITING',
    taskType: 'PICTURE_SENTENCE',
    imageUrl: `${imageBaseUrl.replace(/\/$/, '')}/${key}`,
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
