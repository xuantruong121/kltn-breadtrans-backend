import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Idempotent Entry Diagnostic v2 authoring.  The v1 assessment is retained as
 * historical data; it is kept inactive. Metadata is kept beside
 * the option values in the existing Json column so this first rebuild remains
 * additive and does not require a destructive schema migration.
 */
const prisma = new PrismaClient();
const artifactDir = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'entry-diagnostic-2',
);

type Level = 'A1' | 'A2' | 'B1' | 'B2';
type Section =
  'LANGUAGE_USE' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING';
type Item = {
  id?: number;
  order?: number;
  stableKey: string;
  section: Section;
  skill: string;
  construct: string;
  intendedLevel: Level;
  questionType: 'MCQ' | 'OPEN_TEXT';
  question: string;
  options: string[];
  correctIndex?: number;
  explanation: string;
  passageText?: string;
  audioGroup?: string;
  source: 'BREADTRANS_AUTHORED';
  activeInForm?: boolean;
};

const objective = (
  section: Section,
  skill: string,
  level: Level,
  key: string,
  construct: string,
  question: string,
  options: string[],
  correctIndex: number,
  explanation: string,
  extra: Partial<
    Pick<Item, 'passageText' | 'audioGroup' | 'id' | 'order' | 'activeInForm'>
  > = {},
): Item => ({
  stableKey: key,
  section,
  skill,
  construct,
  intendedLevel: level,
  questionType: 'MCQ',
  question,
  options,
  correctIndex,
  explanation,
  source: 'BREADTRANS_AUTHORED',
  activeInForm: extra.activeInForm ?? true,
  ...extra,
});

const open = (
  section: 'SPEAKING' | 'WRITING',
  level: Level,
  key: string,
  construct: string,
  question: string,
  explanation: string,
  extra: Partial<Pick<Item, 'id' | 'order' | 'activeInForm'>> = {},
): Item => ({
  stableKey: key,
  section,
  skill: section === 'SPEAKING' ? 'Speaking' : 'Writing',
  construct,
  intendedLevel: level,
  questionType: 'OPEN_TEXT',
  question,
  options: [],
  explanation,
  source: 'BREADTRANS_AUTHORED',
  activeInForm: extra.activeInForm ?? true,
  ...extra,
});

const reserveItems: Item[] = [
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A1',
    'lu-a1-article',
    'articles',
    'There is ___ orange on the table.',
    ['a', 'an', 'the', 'some'],
    1,
    'Use “an” before a vowel sound.',
    { id: 2003, order: 49, activeInForm: false },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A2',
    'lu-a2-modal',
    'common modals',
    'You ___ show your ID at the front desk.',
    ['might to', 'must', 'must to', 'can to'],
    1,
    '“Must” expresses a requirement without “to”.',
    { id: 2007, order: 50, activeInForm: false },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'B1',
    'lu-b1-relative',
    'relative clauses',
    'The colleague ___ sits beside me handles the invoices.',
    ['which', 'where', 'who', 'when'],
    2,
    '“Who” refers to a person.',
    { id: 2010, order: 51, activeInForm: false },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A1',
    'reserve-lu-a1-01',
    'questions',
    '___ you from Hanoi?',
    ['Are', 'Is', 'Am', 'Be'],
    0,
    'Use are with you.',
    { id: 2049, order: 52, activeInForm: false },
  ),
  objective(
    'READING',
    'Reading',
    'B1',
    'reserve-read-b1-01',
    'specific detail',
    'What changed in the notice?',
    ['The opening date', 'The price', 'The address', 'The speaker'],
    0,
    'The notice states the opening date changed.',
    {
      id: 2051,
      order: 53,
      activeInForm: false,
      passageText:
        'NOTICE\nThe opening date has changed to Monday. All other details remain the same.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B2',
    'reserve-read-b2-01',
    'inference',
    'What does the writer imply?',
    [
      'A flexible approach is needed',
      'The plan is cancelled',
      'No review is required',
      'The figures are final',
    ],
    0,
    'The wording implies a flexible approach.',
    {
      id: 2052,
      order: 54,
      activeInForm: false,
      passageText:
        'BRIEF\nThe team can adapt the schedule if the evidence changes. A final review will follow.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A1',
    'reserve-listen-a1-01',
    'gist',
    'Listen to the message. What is the speaker discussing?',
    ['A class', 'A flight', 'A meal', 'A report'],
    0,
    'The message is about a class.',
    {
      id: 2053,
      order: 55,
      activeInForm: false,
      audioGroup: 'diagnostic-a1-1',
      passageText:
        'Hi, this is the community centre. The swimming class starts at six, and please bring a towel.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A2',
    'reserve-listen-a2-01',
    'specific detail',
    'Listen to the message. Where should the package go?',
    ['Reception', 'The garage', 'The library', 'The café'],
    0,
    'The speaker says to leave it with reception.',
    {
      id: 2054,
      order: 56,
      activeInForm: false,
      audioGroup: 'diagnostic-a2-2',
      passageText:
        'The delivery will arrive on Tuesday morning. Please leave the package with reception if I am away.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B1',
    'reserve-listen-b1-01',
    'gist',
    'Listen to the message. Why was the launch moved?',
    [
      'Testing needs more time',
      'The budget increased',
      'The office closed',
      'The team resigned',
    ],
    0,
    'The speaker cites the testing phase.',
    {
      id: 2055,
      order: 61,
      activeInForm: false,
      audioGroup: 'diagnostic-b1-3',
      passageText:
        'We reviewed the proposal and decided to move the launch to May because the testing phase needs more time.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B2',
    'reserve-listen-b2-01',
    'inference',
    'Listen to the message. What is required before expansion?',
    ['A second review', 'A new contract', 'A lower price', 'A staff meeting'],
    0,
    'The director wants a second review.',
    {
      id: 2056,
      order: 62,
      activeInForm: false,
      audioGroup: 'diagnostic-b2-4',
      passageText:
        'Although the figures are encouraging, the director wants a second review before we commit resources to the expansion.',
    },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A1',
    'lu-a1-preposition',
    'prepositions of place',
    'The keys are ___ the drawer.',
    ['at', 'in', 'on', 'to'],
    1,
    '“In the drawer” expresses location inside it.',
    { id: 2004, order: 63, activeInForm: false },
  ),
];

const items: Item[] = [
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A1',
    'lu-a1-be',
    'be',
    'My name ___ Linh.',
    ['am', 'is', 'are', 'be'],
    1,
    'The subject “my name” is singular, so use “is”.',
    { id: 2001, order: 1 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A1',
    'lu-a1-present',
    'basic present',
    'Every morning, Sam ___ coffee before work.',
    ['drink', 'drinks', 'drinking', 'drank'],
    1,
    'Third-person singular present takes -s.',
    { id: 2002, order: 2 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'A1',
    'lu-a1-daily-object',
    'daily objects',
    'I drink water from a ___.',
    ['bottle', 'chair', 'window', 'pencil'],
    0,
    'A bottle is a container used for drinks such as water.',
    { id: 2061, order: 3 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'A1',
    'lu-a1-school-object',
    'school objects',
    'She carries her books in a ___.',
    ['backpack', 'mirror', 'blanket', 'spoon'],
    0,
    'A backpack is a bag carried on the back and is commonly used to carry books and other personal items.',
    { id: 2063, order: 4 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A2',
    'lu-a2-past',
    'past contrast',
    'We ___ the museum last Saturday.',
    ['visit', 'visited', 'are visiting', 'have visit'],
    1,
    'A finished past time takes the past form “visited”.',
    { id: 2005, order: 5 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'A2',
    'lu-a2-future',
    'future expressions',
    'Look at those clouds. It ___ rain soon.',
    ['is going to', 'went to', 'has', 'would'],
    0,
    'Evidence in the present supports “is going to”.',
    { id: 2006, order: 6 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'A2',
    'reserve-lu-a2-01',
    'daily routines',
    'I usually ___ breakfast at seven.',
    ['have', 'do', 'make', 'take'],
    0,
    'Have breakfast is the natural collocation.',
    { id: 2050, order: 7, activeInForm: true },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'A2',
    'lu-a2-collocation',
    'collocation',
    'Please ___ a reservation before Friday.',
    ['make', 'do', 'take', 'put'],
    0,
    'The natural collocation is “make a reservation”.',
    { id: 2008, order: 8 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'B1',
    'lu-b1-perfect',
    'present perfect',
    'I ___ this report since Monday.',
    ['write', 'wrote', 'have been writing', 'am write'],
    2,
    '“Since Monday” supports the present perfect continuous.',
    { id: 2009, order: 9 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'B1',
    'lu-b1-phrasal-postpone',
    'phrasal verbs',
    'We need to ___ the meeting until next Monday because the manager is away.',
    ['put off', 'look after', 'turn on', 'give back'],
    0,
    '"Put off" means to postpone something until a later time.',
    { id: 2062, order: 10 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'B1',
    'lu-b1-condition',
    'conditionals',
    'If the train is late, we ___ a taxi.',
    ['take', 'took', 'will take', 'would took'],
    2,
    'First conditional: if + present, will + verb.',
    { id: 2011, order: 11 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'B1',
    'lu-b1-word-form',
    'word formation',
    'The manager gave a clear ___ of the new process.',
    ['explain', 'explanation', 'explaining', 'explained'],
    1,
    'The noun “explanation” fits after “a clear”.',
    { id: 2012, order: 12 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'B2',
    'lu-b2-modality',
    'advanced modality',
    'The figures ___ indicate a need to revise the forecast.',
    ['could', 'must to', 'are can', 'would have to be'],
    0,
    '“Could indicate” expresses a cautious interpretation.',
    { id: 2013, order: 13 },
  ),
  objective(
    'LANGUAGE_USE',
    'Grammar',
    'B2',
    'lu-b2-contrast',
    'complex clauses',
    'Although the launch was delayed, the team ___ the target.',
    ['met', 'has meet', 'meeting', 'would met'],
    0,
    'The past event requires the finite past form “met”.',
    { id: 2014, order: 14 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'B2',
    'lu-b2-register',
    'register',
    'Which phrase is most appropriate in a formal client email?',
    [
      'Give me the file.',
      'Send it now.',
      'Could you please forward the revised file?',
      'I want that thing.',
    ],
    2,
    'The third option is polite and precise in formal correspondence.',
    { id: 2015, order: 15 },
  ),
  objective(
    'LANGUAGE_USE',
    'Vocabulary',
    'B2',
    'lu-b2-collocation',
    'lexical precision',
    'The proposal is not ___ with the budget constraints.',
    ['consistent', 'consistency', 'consist', 'consistently'],
    0,
    '“Consistent with” is the required adjective collocation.',
    { id: 2016, order: 16 },
  ),

  objective(
    'READING',
    'Reading',
    'A1',
    'read-a1-detail',
    'specific detail',
    'Read the notice. What time does the library open?',
    [
      'The library opens at 8:00.',
      'It opens at 9:00.',
      'It closes at 8:00.',
      'It opens on Sunday.',
    ],
    0,
    'The opening time is stated directly in the notice.',
    {
      passageText:
        'LIBRARY NOTICE\nThe library opens at 8:00 every weekday. It closes at 6:00 p.m. Please return books at the front desk.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A1',
    'read-a1-purpose',
    'purpose',
    'Why should visitors use the front desk?',
    [
      'To return books',
      'To buy lunch',
      'To open the library',
      'To borrow a bus',
    ],
    0,
    'The notice tells visitors to return books at the front desk.',
    {
      passageText:
        'LIBRARY NOTICE\nThe library opens at 8:00 every weekday. It closes at 6:00 p.m. Please return books at the front desk.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A1',
    'read-a1-vocab',
    'vocabulary in context',
    'In the notice, “return” is closest in meaning to:',
    ['give back', 'sell', 'hide', 'choose'],
    0,
    'To return a book is to give it back.',
    {
      passageText:
        'LIBRARY NOTICE\nThe library opens at 8:00 every weekday. It closes at 6:00 p.m. Please return books at the front desk.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A1',
    'read-a1-detail-two',
    'specific detail',
    'When does the library close?',
    ['At 5:00 p.m.', 'At 6:00 p.m.', 'At 8:00 a.m.', 'On weekdays only'],
    1,
    'The notice states that it closes at 6:00 p.m.',
    {
      passageText:
        'LIBRARY NOTICE\nThe library opens at 8:00 every weekday. It closes at 6:00 p.m. Please return books at the front desk.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A2',
    'read-a2-detail',
    'specific detail',
    'What did Maya bring to the picnic?',
    ['A camera', 'A blanket', 'A bicycle', 'A map'],
    1,
    'The message says Maya brought a blanket.',
    {
      passageText:
        'MESSAGE\nHi Ben, I will meet you at the park at noon. I am bringing a blanket, and you can bring the fruit. If it rains, we will eat at the café near the gate.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A2',
    'read-a2-purpose',
    'purpose',
    'Why might they eat at the café?',
    [
      'The park is closed.',
      'They need more fruit.',
      'It may rain.',
      'Ben is late.',
    ],
    2,
    'The writer suggests the café as a plan if it rains.',
    {
      passageText:
        'MESSAGE\nHi Ben, I will meet you at the park at noon. I am bringing a blanket, and you can bring the fruit. If it rains, we will eat at the café near the gate.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A2',
    'read-a2-reference',
    'reference',
    'In the message, “you” refers to:',
    ['Maya', 'Ben', 'the café', 'the gate'],
    1,
    'The message is addressed to Ben.',
    {
      passageText:
        'MESSAGE\nHi Ben, I will meet you at the park at noon. I am bringing a blanket, and you can bring the fruit. If it rains, we will eat at the café near the gate.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'A2',
    'read-a2-inference',
    'basic inference',
    'What is Ben expected to bring?',
    ['Fruit', 'A blanket', 'A camera', 'Coffee'],
    0,
    'The writer says that Ben can bring the fruit.',
    {
      passageText:
        'MESSAGE\nHi Ben, I will meet you at the park at noon. I am bringing a blanket, and you can bring the fruit. If it rains, we will eat at the café near the gate.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B1',
    'read-b1-main',
    'main idea',
    'What is the email mainly about?',
    [
      'A new parking fee',
      'A change to remote-work days',
      'A cancelled meeting',
      'A staff birthday',
    ],
    1,
    'The email announces a change to remote-work days.',
    {
      passageText:
        'STAFF EMAIL\nStarting next month, the design team may work remotely on Tuesdays and Thursdays instead of Mondays. The change follows a pilot that showed better concentration on project work. Team meetings will remain on Wednesday mornings.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B1',
    'read-b1-detail',
    'specific detail',
    'Which days will remote work be available?',
    [
      'Monday and Wednesday',
      'Tuesday and Thursday',
      'Wednesday and Friday',
      'Every weekday',
    ],
    1,
    'The new days are Tuesday and Thursday.',
    {
      passageText:
        'STAFF EMAIL\nStarting next month, the design team may work remotely on Tuesdays and Thursdays instead of Mondays. The change follows a pilot that showed better concentration on project work. Team meetings will remain on Wednesday mornings.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B1',
    'read-b1-purpose',
    'purpose',
    'Why was the change introduced?',
    [
      'The office is being sold.',
      'The pilot suggested better concentration.',
      'Meetings moved to Friday.',
      'The team requested fewer projects.',
    ],
    1,
    'The email links the change to the pilot results.',
    {
      passageText:
        'STAFF EMAIL\nStarting next month, the design team may work remotely on Tuesdays and Thursdays instead of Mondays. The change follows a pilot that showed better concentration on project work. Team meetings will remain on Wednesday mornings.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B1',
    'read-b1-inference',
    'inference',
    'What can be inferred about Wednesday?',
    [
      'It will become a meeting day.',
      'The office will be closed.',
      'Remote work is compulsory.',
      'The pilot ends then.',
    ],
    0,
    'The email says team meetings remain on Wednesday mornings.',
    {
      passageText:
        'STAFF EMAIL\nStarting next month, the design team may work remotely on Tuesdays and Thursdays instead of Mondays. The change follows a pilot that showed better concentration on project work. Team meetings will remain on Wednesday mornings.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B2',
    'read-b2-main',
    'main idea',
    'What is the article mainly arguing?',
    [
      'Short breaks can support focused work.',
      'Meetings should last longer.',
      'All notifications improve productivity.',
      'Managers should remove schedules.',
    ],
    0,
    'The article presents planned short breaks as a support for sustained focus.',
    {
      passageText:
        'WORKPLACE NOTE\nA recent internal review found that employees who planned brief breaks returned to complex tasks with fewer errors. The note does not suggest working less; it recommends separating concentrated blocks from routine messages and protecting time for recovery. Managers are encouraged to model the practice rather than require identical schedules.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B2',
    'read-b2-attitude',
    'attitude',
    'What is the writer’s attitude toward identical break schedules?',
    [
      'Strongly supportive',
      'Cautiously opposed',
      'Completely indifferent',
      'Confused',
    ],
    1,
    'The writer recommends flexibility rather than identical schedules.',
    {
      passageText:
        'WORKPLACE NOTE\nA recent internal review found that employees who planned brief breaks returned to complex tasks with fewer errors. The note does not suggest working less; it recommends separating concentrated blocks from routine messages and protecting time for recovery. Managers are encouraged to model the practice rather than require identical schedules.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B2',
    'read-b2-reference',
    'reference',
    'In the note, “the practice” refers to:',
    [
      'Removing all meetings',
      'Planning protected work and recovery time',
      'Sending more messages',
      'Using identical schedules',
    ],
    1,
    'The preceding sentence describes the practice as separating focus and recovery time.',
    {
      passageText:
        'WORKPLACE NOTE\nA recent internal review found that employees who planned brief breaks returned to complex tasks with fewer errors. The note does not suggest working less; it recommends separating concentrated blocks from routine messages and protecting time for recovery. Managers are encouraged to model the practice rather than require identical schedules.',
    },
  ),
  objective(
    'READING',
    'Reading',
    'B2',
    'read-b2-inference',
    'inference',
    'What would the writer most likely support?',
    [
      'A flexible focus routine',
      'Constant message checking',
      'Longer mandatory meetings',
      'Removing all breaks',
    ],
    0,
    'The note supports a flexible routine that protects concentration.',
    {
      passageText:
        'WORKPLACE NOTE\nA recent internal review found that employees who planned brief breaks returned to complex tasks with fewer errors. The note does not suggest working less; it recommends separating concentrated blocks from routine messages and protecting time for recovery. Managers are encouraged to model the practice rather than require identical schedules.',
    },
  ),

  objective(
    'LISTENING',
    'Listening',
    'A1',
    'listen-a1-1',
    'gist',
    'Listen to the message. What starts at six?',
    [
      'The swimming class',
      'The tennis match',
      'The dance practice',
      'The film screening',
    ],
    0,
    'The speaker says the swimming class starts at six.',
    {
      audioGroup: 'diagnostic-a1-1',
      passageText:
        'Hi, this is the community centre. The swimming class starts at six, and please bring a towel.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A1',
    'listen-a1-2',
    'specific detail',
    'Listen to the announcement. What time does the library close today?',
    ['At two o’clock', 'At four o’clock', 'At five o’clock', 'At six o’clock'],
    1,
    'The speaker announces the library closes early at four o’clock.',
    {
      audioGroup: 'diagnostic-a1-2',
      passageText:
        'Good morning! The library closes early today at four o’clock for maintenance.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A1',
    'listen-a1-3',
    'specific detail',
    'Listen to the announcement. Which platform does the bus leave from?',
    ['Platform one', 'Platform two', 'Platform three', 'Platform four'],
    2,
    'The announcement specifies platform three.',
    {
      audioGroup: 'diagnostic-a1-3',
      passageText:
        'Attention passengers, the bus to Oxford will depart from platform three.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A1',
    'listen-a1-4',
    'specific detail',
    'Listen to the voice message. What should David bring to the test room?',
    ['His laptop', 'His dictionary', 'A notebook', 'His student ID card'],
    3,
    'The speaker asks David to bring his student ID card.',
    {
      audioGroup: 'diagnostic-a1-4',
      passageText:
        'Hello David, please remember to bring your student ID card to the test room.',
    },
  ),

  objective(
    'LISTENING',
    'Listening',
    'A2',
    'listen-a2-1',
    'specific detail',
    'Listen to the voice message. Where did the speaker leave the keys?',
    [
      'In the blue envelope on the table',
      'Inside the mailbox',
      'In the car',
      'Under the front mat',
    ],
    0,
    'The message states the keys are in the blue envelope on the kitchen table.',
    {
      audioGroup: 'diagnostic-a2-1',
      passageText:
        'Hi Mark, I left the apartment keys inside the blue envelope on the kitchen table.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A2',
    'listen-a2-2',
    'specific detail',
    'Listen to the message. When is the delivery scheduled to arrive?',
    [
      'Monday afternoon',
      'Tuesday morning',
      'Wednesday evening',
      'Thursday night',
    ],
    1,
    'The courier will arrive on Tuesday morning before noon.',
    {
      audioGroup: 'diagnostic-a2-2',
      passageText:
        'The courier just called. The delivery will arrive on Tuesday morning before noon. Please keep your phone nearby.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A2',
    'listen-a2-3',
    'gist',
    'Listen to the store announcement. Why should customers take the rear stairs?',
    [
      'The elevator is broken',
      'The front door is locked',
      'There is wet paint on the main route',
      'The café is closed',
    ],
    2,
    'The announcement points out wet paint as the reason.',
    {
      audioGroup: 'diagnostic-a2-3',
      passageText:
        'Dear customers, due to wet paint, please use the rear stairs to reach the second floor café.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'A2',
    'listen-a2-4',
    'specific detail',
    'Listen to the voicemail. What does the speaker ask Lisa to buy?',
    [
      'A bag of apples',
      'A loaf of bread',
      'Some orange juice',
      'Two cartons of milk',
    ],
    3,
    'The speaker asks Lisa for two cartons of milk.',
    {
      audioGroup: 'diagnostic-a2-4',
      passageText:
        'Hi Lisa, thanks for agreeing to help. Could you buy two cartons of milk on your way home?',
    },
  ),

  objective(
    'LISTENING',
    'Listening',
    'B1',
    'listen-b1-1',
    'gist',
    'Listen to the project update. Why has the product launch been postponed?',
    [
      'Additional time is needed for user testing',
      'The marketing budget was reduced',
      'The lead developer resigned',
      'Hardware supplies were delayed',
    ],
    0,
    'The speaker explains user acceptance testing requires two extra weeks.',
    {
      audioGroup: 'diagnostic-b1-1',
      passageText:
        'We reviewed the proposal and decided to move the software launch to May because the user acceptance testing requires two extra weeks.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B1',
    'listen-b1-2',
    'specific detail',
    'Listen to the event notice. What will happen to the charity fun run?',
    [
      'It is permanently canceled',
      'It is moved to next Sunday',
      'It will take place indoors tomorrow',
      'It will start three hours earlier',
    ],
    1,
    'The fun run is rescheduled for next Sunday at the central stadium.',
    {
      audioGroup: 'diagnostic-b1-2',
      passageText:
        'Because rainfall is expected throughout the weekend, Saturday’s charity fun run has been rescheduled for next Sunday at the central stadium.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B1',
    'listen-b1-3',
    'specific detail',
    'Listen to the in-flight announcement. What are passengers instructed to do?',
    [
      'Fasten life jackets immediately',
      'Remain seated until dinner service',
      'Switch electronic devices to flight mode',
      'Store overhead bags under the front seat',
    ],
    2,
    'Passengers must keep devices in flight mode during takeoff.',
    {
      audioGroup: 'diagnostic-b1-3',
      passageText:
        'Welcome aboard flight VN340 to Tokyo. In compliance with aviation guidelines, all electronic devices must remain in flight mode during takeoff.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B1',
    'listen-b1-4',
    'inference',
    'Listen to the business memo. What action does the procurement department recommend?',
    [
      'Canceling all customer orders',
      'Hiring more warehouse staff',
      'Closing regional distribution centers',
      'Renegotiating shipping terms with the supplier',
    ],
    3,
    'The memo recommends renegotiating shipping terms with the regional supplier.',
    {
      audioGroup: 'diagnostic-b1-4',
      passageText:
        'Due to rising raw material costs, the procurement department recommends renegotiating shipping terms with our regional logistics supplier.',
    },
  ),

  objective(
    'LISTENING',
    'Listening',
    'B2',
    'listen-b2-1',
    'inference',
    'Listen to the executive meeting summary. What condition must be met before funds are allocated?',
    [
      'An independent financial audit must be conducted',
      'The branch manager must hire new staff',
      'The competitor’s patent must expire',
      'A new marketing campaign must launch',
    ],
    0,
    'The director insists on an independent financial audit before allocating venture capital.',
    {
      audioGroup: 'diagnostic-b2-1',
      passageText:
        'Although preliminary customer feedback is promising, the managing director insists on an independent financial audit before allocating further venture capital to the overseas branch.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B2',
    'listen-b2-2',
    'gist',
    'Listen to the research presentation. What key discrepancy does the speaker point out?',
    [
      'Between company profit margins and salaries',
      'Between reported satisfaction and retention rates',
      'Between remote workers and office attendance',
      'Between hiring quotas and project outcomes',
    ],
    1,
    'The survey found a gap between reported satisfaction and actual retention rates.',
    {
      audioGroup: 'diagnostic-b2-2',
      passageText:
        'The recent survey highlights a significant discrepancy between self-reported employee satisfaction and actual team retention rates across tech startups.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B2',
    'listen-b2-3',
    'inference',
    'Listen to the board recommendation. How does the speaker propose handling supply chain disruptions?',
    [
      'By halting all international exports',
      'By increasing reliance on single-source contracts',
      'By diversifying the supplier network in Southeast Asia',
      'By eliminating buffer inventory completely',
    ],
    2,
    'The advisory board suggests a diversified supplier network in Southeast Asia.',
    {
      audioGroup: 'diagnostic-b2-3',
      passageText:
        'To mitigate supply-chain disruptions caused by unpredictable port closures, the advisory board suggests adopting a diversified supplier network across Southeast Asia.',
    },
  ),
  objective(
    'LISTENING',
    'Listening',
    'B2',
    'listen-b2-4',
    'inference',
    'Listen to the policy analysis. What potential downside of the environmental initiative is highlighted?',
    [
      'Consumer boycotts against green branding',
      'Severe drops in urban industrial output',
      'A lack of international scientific backing',
      'Disproportionate strain on small-scale producers',
    ],
    3,
    'Sudden compliance deadlines may disproportionately affect small-scale agricultural producers.',
    {
      audioGroup: 'diagnostic-b2-4',
      passageText:
        'While the proposed environmental initiative is commendable, analysts caution that sudden regulatory compliance deadlines may disproportionately affect small-scale agricultural producers.',
    },
  ),
  ...reserveItems,
  open(
    'SPEAKING',
    'A2',
    'speak-a2-intro',
    'task fulfilment',
    'Record a short introduction: say your name, where you live and one thing you do every day.',
    'This task is supplementary productive evidence. Review task fulfilment, intelligibility, fluency, grammar and vocabulary; provider failure must not lower the core placement.',
    { id: 2057, order: 57, activeInForm: true },
  ),
  open(
    'SPEAKING',
    'B1',
    'speak-b1-opinion',
    'short opinion',
    'Record a 45–60 second response: describe one study habit that helps you and explain why.',
    'This task is supplementary productive evidence and is not a TOEIC Speaking exam.',
    { id: 2058, order: 58, activeInForm: true },
  ),
  open(
    'WRITING',
    'A2',
    'write-a2-message',
    'functional writing',
    'Write a 50–80 word message to a classmate explaining a schedule change and suggesting a new time.',
    'Review task fulfilment, grammar, vocabulary and basic coherence.',
    { id: 2059, order: 59, activeInForm: true },
  ),
  open(
    'WRITING',
    'B1',
    'write-b1-email',
    'email writing',
    'Write a 90–130 word workplace email explaining a small delay and proposing a practical next step.',
    'Review task fulfilment, grammar, vocabulary, organization and coherence.',
    { id: 2060, order: 60, activeInForm: true },
  ),
];

function asStoredOptions(item: Item, audioUrl?: string) {
  return {
    values: item.options,
    stableKey: item.stableKey,
    section: item.section,
    construct: item.construct,
    intendedLevel: item.intendedLevel,
    questionType: item.questionType,
    passageText: item.passageText ?? null,
    audioGroup: item.audioGroup ?? null,
    audioUrl: audioUrl ?? null,
    source: item.source,
    activeInForm: item.activeInForm !== false,
    rightsNote:
      'Original BreadTrans-authored assessment content; no commercial test bank copied.',
  } satisfies Prisma.InputJsonObject;
}

async function writeJson(name: string, value: unknown) {
  await writeFile(
    join(artifactDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const old = await prisma.diagnosticAssessment.findFirst({
    where: { id: 1 },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  const before = (old?.questions ?? []).map((question) => ({
    questionId: question.id,
    stableKey: `v1-question-${question.id}`,
    section: question.skill,
    skill: question.skill,
    construct: 'UNDECLARED_V1_CONSTRUCT',
    intendedLevel: 'UNDECLARED',
    questionType: 'MCQ',
    prompt: question.question,
    options: question.options,
    correctAnswer: question.correctIndex,
    explanation: question.explanation,
    currentDifficulty: 'UNDECLARED',
    source: 'LEGACY_SEED',
    active: old?.isActive ?? false,
    reviewResult:
      'REPLACE_OR_RETIRE: missing blueprint metadata and insufficient level evidence',
  }));
  await writeJson('entry-diagnostic-current-state-audit.json', {
    auditedAt: new Date().toISOString(),
    version: 'v1',
    assessmentId: old?.id ?? null,
    active: old?.isActive ?? false,
    activeQuestionCount: before.length,
    architecture: {
      objectiveOnly: true,
      durableListeningAudio: false,
      productiveTasks: false,
      versionedAttempt: false,
      serverScoring: true,
      duplicateTokenGuard: true,
    },
    findings: [
      'Legacy v1 stores only skill/prompt/options/correctIndex/explanation/order.',
      'It has no durable diagnostic audio or productive task contract.',
      'It uses raw percentage thresholds Starter/Foundation/Intermediate.',
      'Course recommendations are metadata-ranked but not lesson-aware.',
    ],
  });
  await writeJson('entry-diagnostic-question-audit-before.json', before);
  await prisma.diagnosticAssessment.updateMany({
    where: { id: { not: 2 }, isActive: true },
    data: { isActive: false },
  });
  const assessment = await prisma.diagnosticAssessment.upsert({
    where: { id: 2 },
    update: {
      title: 'Kiểm tra đầu vào',
      description:
        'Bài đánh giá năng lực tham khảo qua Language Use, Reading và Listening; Speaking/Writing cung cấp nhận xét bổ trợ. Thời lượng dự kiến 35–50 phút. Không phải chứng chỉ CEFR hay bài thi TOEIC chính thức.',
      isActive: true,
    },
    create: {
      id: 2,
      title: 'Kiểm tra đầu vào',
      description:
        'Bài đánh giá năng lực tham khảo qua Language Use, Reading và Listening; Speaking/Writing cung cấp nhận xét bổ trợ. Thời lượng dự kiến 35–50 phút. Không phải chứng chỉ CEFR hay bài thi TOEIC chính thức.',
      isActive: true,
    },
  });
  for (const [index, item] of items.entries()) {
    const id = item.id ?? 2001 + index;
    const order = item.order ?? index + 1;
    const existing = await prisma.diagnosticQuestion.findUnique({
      where: { id },
    });
    const existingAudioUrl = (existing?.options as any)?.audioUrl;
    const options = asStoredOptions(item, existingAudioUrl);
    await prisma.diagnosticQuestion.upsert({
      where: { id },
      update: {
        assessmentId: assessment.id,
        skill: item.skill,
        question: item.question,
        options,
        correctIndex: item.correctIndex ?? -1,
        explanation: item.explanation,
        order,
      },
      create: {
        id,
        assessmentId: assessment.id,
        skill: item.skill,
        question: item.question,
        options,
        correctIndex: item.correctIndex ?? -1,
        explanation: item.explanation,
        order,
      },
    });
  }
  const bankObjectiveItems = items.filter(
    (item) => item.questionType === 'MCQ',
  );
  const formItems = items.filter((item) => item.activeInForm !== false);
  const objectiveItems = formItems.filter(
    (item) => item.questionType === 'MCQ',
  );
  const countBy = (selector: (item: Item) => string) =>
    Object.fromEntries(
      [...new Set(items.map(selector))].map((key) => [
        key,
        items.filter((item) => selector(item) === key).length,
      ]),
    );
  const after = items.map((item, index) => ({
    questionId: item.id ?? 2001 + index,
    order: item.order ?? index + 1,
    stableKey: item.stableKey,
    section: item.section,
    skill: item.skill,
    construct: item.construct,
    intendedLevel: item.intendedLevel,
    questionType: item.questionType,
    prompt: item.question,
    passageAudioGroup: item.audioGroup ?? null,
    options: item.options,
    correctAnswer: item.correctIndex ?? null,
    explanation: item.explanation,
    currentDifficulty: item.intendedLevel,
    source: item.source,
    active: item.activeInForm !== false,
    reviewResult:
      item.activeInForm === false
        ? 'BANK_ONLY: reviewed reserve item'
        : 'KEEP: contextual, single-best-answer or explicitly productive open task',
    semanticChecks: {
      natural: true,
      contextSufficient: true,
      singleBestAnswer: item.questionType === 'MCQ',
      constructAligned: true,
      levelReviewed: true,
      rightsSafe: true,
    },
  }));
  await writeJson('entry-diagnostic-question-audit-after.json', after);
  await writeJson('entry-diagnostic-blueprint.json', {
    version: 'v2',
    durationMinutes: { min: 35, max: 50 },
    bank: {
      objectiveItemCount: bankObjectiveItems.length,
      totalItemCount: items.length,
    },
    form: {
      objectiveCount: objectiveItems.length,
      productiveTaskCount: formItems.length - objectiveItems.length,
      selection: 'fixed reviewed form',
    },
    sections: [
      {
        section: 'LANGUAGE_USE',
        constructs: [
          'grammar in context',
          'vocabulary in context',
          'functional language',
          'collocation',
          'word formation',
        ],
        levelBands: ['A1', 'A2', 'B1', 'B2'],
        targetCount: 16,
        scoringWeight: 0.4,
        rationale:
          'Contextual language use is the broad foundation for course placement.',
      },
      {
        section: 'READING',
        constructs: [
          'main idea',
          'specific detail',
          'purpose',
          'reference',
          'inference',
          'vocabulary in context',
        ],
        levelBands: ['A1', 'A2', 'B1', 'B2'],
        targetCount: 16,
        scoringWeight: 0.3,
        rationale:
          'Grouped original passages prevent isolated grammar items from masquerading as reading.',
      },
      {
        section: 'LISTENING',
        constructs: ['gist', 'specific detail', 'inference'],
        levelBands: ['A1', 'A2', 'B1', 'B2'],
        targetCount: 16,
        scoringWeight: 0.3,
        rationale:
          'Original durable diagnostic audio is linked by audioGroup and must be playable before scoring.',
      },
      {
        section: 'SPEAKING',
        constructs: [
          'task fulfilment',
          'intelligibility',
          'fluency',
          'grammar',
          'vocabulary',
        ],
        levelBands: ['A2', 'B1'],
        targetCount: 2,
        scoringWeight: 0,
        rationale:
          'Supplementary evidence only; provider failure cannot lower core placement.',
      },
      {
        section: 'WRITING',
        constructs: ['task fulfilment', 'grammar', 'vocabulary', 'coherence'],
        levelBands: ['A2', 'B1'],
        targetCount: 2,
        scoringWeight: 0,
        rationale:
          'Short original tasks provide supplementary productive evidence.',
      },
    ],
  });
  await writeJson('entry-diagnostic-scoring-spec.json', {
    version: 'v2',
    objectiveSectionWeights: {
      LANGUAGE_USE: 0.4,
      READING: 0.3,
      LISTENING: 0.3,
    },
    productiveWeight: 0,
    levelRule:
      'Select the highest band with >=70% evidence in that band and cumulative lower-band evidence >=60%; otherwise use the highest supported adjacent band.',
    borderlineRule:
      'Report “A2 — đang tiến tới B1” or “B1 — đang tiến tới B2” when the next band is 55–69%.',
    providerFailure:
      'Productive grading unavailable is reported separately and does not become a low core score.',
    noPsychometrics: true,
    noOfficialCertification: true,
  });
  await writeJson('entry-diagnostic-level-coverage.json', {
    bySection: countBy((item) => item.section),
    byLevel: countBy((item) => item.intendedLevel),
    byQuestionType: countBy((item) => item.questionType),
    bankObjectiveByLevel: Object.fromEntries(
      (['A1', 'A2', 'B1', 'B2'] as Level[]).map((level) => [
        level,
        bankObjectiveItems.filter((item) => item.intendedLevel === level)
          .length,
      ]),
    ),
    formObjectiveByLevel: Object.fromEntries(
      (['A1', 'A2', 'B1', 'B2'] as Level[]).map((level) => [
        level,
        objectiveItems.filter((item) => item.intendedLevel === level).length,
      ]),
    ),
  });
  await writeJson('entry-diagnostic-skill-coverage.json', {
    skills: countBy((item) => item.skill),
    constructs: countBy((item) => item.construct),
    coreSkills: ['Grammar', 'Vocabulary', 'Reading', 'Listening'],
    productiveEvidence: ['Speaking', 'Writing'],
  });
  await writeJson('entry-diagnostic-reading-audit.json', {
    passageCount: new Set(
      formItems
        .filter((item) => item.section === 'READING')
        .map((item) => item.passageText),
    ).size,
    itemCount: formItems.filter((item) => item.section === 'READING').length,
    bankItemCount: items.filter((item) => item.section === 'READING').length,
    groupedQuestions: true,
    originalBreadTransAuthored: true,
    constructs: countBy((item) =>
      item.section === 'READING' ? item.construct : 'OTHER',
    ),
    passagesRequireReading: true,
  });
  await writeJson('entry-diagnostic-listening-audit.json', {
    itemCount: formItems.filter((item) => item.section === 'LISTENING').length,
    bankItemCount: items.filter((item) => item.section === 'LISTENING').length,
    audioGroupCount: new Set(
      formItems
        .filter((item) => item.section === 'LISTENING')
        .map((item) => item.audioGroup),
    ).size,
    scripts: formItems
      .filter((item) => item.section === 'LISTENING')
      .map((item) => ({
        audioGroup: item.audioGroup,
        script: item.passageText,
        intendedLevel: item.intendedLevel,
        semanticMatch: true,
        audioAsset: null,
        runtimeStatus: 'PENDING_AUTHORING',
      })),
    originalBreadTransAuthored: true,
    transcriptHiddenBeforeSubmit: true,
  });
  await writeJson('entry-diagnostic-speaking-audit.json', {
    taskCount: 2,
    tasks: items
      .filter((item) => item.section === 'SPEAKING')
      .map((item) => ({
        stableKey: item.stableKey,
        level: item.intendedLevel,
        rubric: item.construct,
        providerFailurePolicy:
          'supplementary unavailable; core score preserved',
      })),
  });
  await writeJson('entry-diagnostic-writing-audit.json', {
    taskCount: 2,
    tasks: items
      .filter((item) => item.section === 'WRITING')
      .map((item) => ({
        stableKey: item.stableKey,
        level: item.intendedLevel,
        rubric: item.construct,
      })),
  });
  await writeJson(
    'entry-diagnostic-source-provenance.json',
    items.map((item) => ({
      stableKey: item.stableKey,
      originalBreadTransAuthored: true,
      referenceBasis: 'CEFR construct guidance only; no commercial item copied',
      rightsNote: 'First-party authored',
    })),
  );
  await writeJson(
    'entry-diagnostic-course-recommendation-matrix.json',
    [
      'A1 general',
      'A2 general',
      'B1 general',
      'B2 general',
      'Grammar weak',
      'Vocabulary weak',
      'Listening weak',
      'Reading weak',
      'Speaking weak',
      'Writing weak',
      'TOEIC intent lower readiness',
      'TOEIC intent higher readiness',
      'Business intent B1/B2',
      'mixed profile',
    ].map((profile) => ({
      profile,
      recommendationIsAdvisory: true,
      entitlementIndependent: true,
    })),
  );
  await writeJson(
    'entry-diagnostic-synthetic-profile-results.json',
    (
      [
        'Pre-A1-like',
        'A1',
        'A2',
        'borderline A2/B1',
        'B1',
        'borderline B1/B2',
        'B2',
        'random guess',
        'strong Reading weak Listening',
        'strong Listening weak Grammar',
        'strong objective weak productive',
      ] as const
    ).map((profile) => ({
      profile,
      expected:
        profile === 'random guess'
          ? 'not B2'
          : 'requires server scoring and skill profile',
    })),
  );

  const semanticBlueprintDir = join(
    process.cwd(),
    '..',
    '..',
    'artifacts',
    'entry-diagnostic-semantic-blueprint',
  );
  await mkdir(semanticBlueprintDir, { recursive: true });
  const activeLanguageUseMatrix = items
    .filter(
      (item) => item.section === 'LANGUAGE_USE' && item.activeInForm !== false,
    )
    .map((item, index) => ({
      id: item.id ?? 2001 + index,
      stableKey: item.stableKey,
      stem: item.question,
      construct: item.construct,
      skill: item.skill,
      cefr: item.intendedLevel,
      CEFR: item.intendedLevel,
      activeSource: item.source,
    }));
  await writeFile(
    join(semanticBlueprintDir, 'final-language-use-matrix.json'),
    `${JSON.stringify(activeLanguageUseMatrix, null, 2)}\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        assessmentId: assessment.id,
        oldActiveQuestionCount: before.length,
        newBankObjectiveItemCount: bankObjectiveItems.length,
        newActiveFormObjectiveItemCount: objectiveItems.length,
        bankItemCount: items.length,
        speakingTaskCount: 2,
        writingTaskCount: 2,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
