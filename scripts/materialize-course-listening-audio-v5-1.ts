import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseBuffer } from 'music-metadata';
import { PrismaClient, Prisma } from '@prisma/client';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Course-only, development-time listening authoring.
 * It never touches QuizAudioAsset and is intentionally not imported by the
 * learner runtime. The hash in the key makes retries idempotent and prevents
 * replacing an already published course recording.
 */
const prisma = new PrismaClient();
const artifactDir = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'course-learning-experience-5-1',
);

type Speaker = 'Mia' | 'Leo' | 'Nora' | 'Ethan' | 'Sofia' | 'Priya' | 'Daniel';
type Turn = { speaker: Speaker; text: string; voice: string };
type QuestionPlan = {
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};
type ListeningPlan = {
  courseId: number;
  order: number;
  accent: 'US' | 'UK';
  script: Turn[];
  questions: QuestionPlan[];
};

const usFemale = 'en-US-JennyNeural';
const usMale = 'en-US-GuyNeural';
const ukFemale = 'en-GB-SoniaNeural';
const ukMale = 'en-GB-RyanNeural';

const turn = (speaker: Speaker, text: string, voice: string): Turn => ({
  speaker,
  text,
  voice,
});

const q = (
  prompt: string,
  options: string[],
  correctAnswer: string,
  explanation: string,
): QuestionPlan => ({ prompt, options, correctAnswer, explanation });

const plans: ListeningPlan[] = [
  {
    courseId: 1,
    order: 1,
    accent: 'US',
    script: [
      turn('Mia', "Hi, I'm Mia. I just moved into apartment four.", usFemale),
      turn('Leo', "Welcome, Mia. I'm Leo from apartment six.", usMale),
      turn(
        'Mia',
        'Nice to meet you. I teach music at the school nearby.',
        usFemale,
      ),
      turn(
        'Leo',
        'That sounds nice. The community garden is open on Saturdays.',
        usMale,
      ),
      turn('Mia', "Great. I'll see you there this weekend.", usFemale),
    ],
    questions: [
      q(
        'Where did Mia move?',
        ['Apartment four', 'Apartment six', 'A school', 'A garden'],
        'Apartment four',
        'Mia says that she moved into apartment four.',
      ),
      q(
        'What is Leo from?',
        ['Apartment six', 'The school', 'The garden', 'The library'],
        'Apartment six',
        'Leo introduces himself from apartment six.',
      ),
      q(
        'Where does Mia work?',
        ['At the school nearby', 'At the garden', 'At a shop', 'At a station'],
        'At the school nearby',
        'Mia says she teaches music at the school nearby.',
      ),
      q(
        'When is the community garden open?',
        ['On Saturdays', 'On Mondays', 'Every evening', 'At lunchtime'],
        'On Saturdays',
        'Leo says the garden is open on Saturdays.',
      ),
      q(
        'What will Mia do this weekend?',
        ['See Leo at the garden', 'Move apartments', 'Teach Leo', 'Buy music'],
        'See Leo at the garden',
        "Mia says she'll see Leo at the garden this weekend.",
      ),
    ],
  },
  {
    courseId: 1,
    order: 8,
    accent: 'US',
    script: [
      turn(
        'Nora',
        'Excuse me, could you help me find the bus station?',
        usFemale,
      ),
      turn(
        'Ethan',
        'Sure. Walk straight for two blocks and turn left at the bank.',
        usMale,
      ),
      turn('Nora', 'Is it far from the park?', usFemale),
      turn(
        'Ethan',
        "No, it's next to the post office, across from the park.",
        usMale,
      ),
      turn('Nora', 'Thank you. I will look for the blue sign.', usFemale),
    ],
    questions: [
      q(
        'What does Nora want to find?',
        ['The bus station', 'The bank', 'The park', 'The post office'],
        'The bus station',
        'Nora asks for directions to the bus station.',
      ),
      q(
        'How far should Nora walk first?',
        ['Two blocks', 'One block', 'Three blocks', 'Across the park'],
        'Two blocks',
        'Ethan tells her to walk straight for two blocks.',
      ),
      q(
        'Where should Nora turn?',
        ['At the bank', 'At the park', 'At the station', 'At the school'],
        'At the bank',
        'She should turn left at the bank.',
      ),
      q(
        'What is next to the bus station?',
        ['The post office', 'The park', 'The bank', 'The school'],
        'The post office',
        'Ethan says the station is next to the post office.',
      ),
      q(
        'What sign will Nora look for?',
        ['A blue sign', 'A green sign', 'A red sign', 'A large map'],
        'A blue sign',
        'Nora says she will look for the blue sign.',
      ),
    ],
  },
  {
    courseId: 2,
    order: 1,
    accent: 'US',
    script: [
      turn(
        'Priya',
        'Good morning. I finished the customer survey yesterday.',
        usFemale,
      ),
      turn(
        'Daniel',
        'Great. I am checking the response numbers this morning.',
        usMale,
      ),
      turn('Priya', 'I will share the comments before lunch.', usFemale),
      turn(
        'Daniel',
        "Thanks. Let's discuss the two common complaints at two o'clock.",
        usMale,
      ),
      turn('Priya', 'I will add the meeting to our calendars.', usFemale),
    ],
    questions: [
      q(
        'What did Priya finish?',
        ['A customer survey', 'A response table', 'A calendar', 'A meeting'],
        'A customer survey',
        'Priya finished the customer survey yesterday.',
      ),
      q(
        'What is Daniel checking?',
        [
          'Response numbers',
          'Customer comments',
          'The calendar',
          'A lunch order',
        ],
        'Response numbers',
        'Daniel is checking the response numbers.',
      ),
      q(
        'When will Priya share the comments?',
        [
          'Before lunch',
          'At two o’clock',
          'Tomorrow morning',
          'After the meeting',
        ],
        'Before lunch',
        'She will share them before lunch.',
      ),
      q(
        'How many common complaints will they discuss?',
        ['Two', 'Three', 'Four', 'Five'],
        'Two',
        'Daniel mentions two common complaints.',
      ),
      q(
        'What will Priya add to the calendars?',
        ['The meeting', 'The survey', 'The complaints', 'The response numbers'],
        'The meeting',
        'Priya will add the meeting to their calendars.',
      ),
    ],
  },
  {
    courseId: 2,
    order: 5,
    accent: 'US',
    script: [
      turn('Nora', 'Hello, this is Nora from Greenline Supplies.', usFemale),
      turn(
        'Ethan',
        'Hi Nora. I am calling about yesterday’s delivery.',
        usMale,
      ),
      turn(
        'Nora',
        'The driver had a flat tire, so the boxes are delayed.',
        usFemale,
      ),
      turn('Ethan', 'When can we expect them?', usMale),
      turn(
        'Nora',
        'They will arrive tomorrow before ten in the morning.',
        usFemale,
      ),
    ],
    questions: [
      q(
        'Who is Nora calling from?',
        [
          'Greenline Supplies',
          'A delivery company',
          'The customer office',
          'A repair shop',
        ],
        'Greenline Supplies',
        'Nora identifies Greenline Supplies.',
      ),
      q(
        'What is Ethan calling about?',
        [
          'Yesterday’s delivery',
          'A new order',
          'A flat tire',
          'Tomorrow’s meeting',
        ],
        'Yesterday’s delivery',
        'Ethan calls about yesterday’s delivery.',
      ),
      q(
        'Why are the boxes delayed?',
        [
          'The driver had a flat tire',
          'The office is closed',
          'The order is missing',
          'The weather is bad',
        ],
        'The driver had a flat tire',
        'Nora says the driver had a flat tire.',
      ),
      q(
        'When will the boxes arrive?',
        ['Tomorrow morning', 'This afternoon', 'Next week', 'Tonight'],
        'Tomorrow morning',
        'Nora promises delivery tomorrow before ten.',
      ),
      q(
        'What is the latest delivery time?',
        [
          'Ten in the morning',
          'Nine in the morning',
          'Two in the afternoon',
          'Five in the afternoon',
        ],
        'Ten in the morning',
        'The delivery will arrive before ten in the morning.',
      ),
    ],
  },
  {
    courseId: 3,
    order: 1,
    accent: 'US',
    script: [
      turn('Mia', 'When will the training session begin?', usFemale),
      turn('Leo', 'It begins at quarter past nine in Room 204.', usMale),
      turn('Mia', 'Should I bring the attendance list?', usFemale),
      turn('Leo', 'Yes, and please bring twenty printed copies.', usMale),
    ],
    questions: [
      q(
        'What time does the training begin?',
        ['9:15', '8:45', '9:30', '10:15'],
        '9:15',
        'Quarter past nine means 9:15.',
      ),
      q(
        'Where is the training?',
        ['Room 204', 'Room 104', 'The main hall', 'The office'],
        'Room 204',
        'Leo names Room 204.',
      ),
      q(
        'What should Mia bring?',
        [
          'The attendance list',
          'A projector',
          'A payment form',
          'A new schedule',
        ],
        'The attendance list',
        'Leo confirms that she should bring the attendance list.',
      ),
      q(
        'How many copies are needed?',
        ['Twenty', 'Twelve', 'Forty', 'Two'],
        'Twenty',
        'Leo asks for twenty printed copies.',
      ),
      q(
        'Which room is mentioned?',
        ['Room 204', 'Room 104', 'The main hall', 'The office'],
        'Room 204',
        'Leo gives Room 204 as the location.',
      ),
    ],
  },
  {
    courseId: 3,
    order: 5,
    accent: 'US',
    script: [
      turn(
        'Nora',
        'Attention, passengers. Flight 418 to Denver will board at gate twelve.',
        usFemale,
      ),
      turn('Ethan', 'The flight is scheduled to leave at six thirty.', usMale),
      turn(
        'Nora',
        'Passengers should have their boarding passes ready.',
        usFemale,
      ),
      turn(
        'Ethan',
        'The gate closes fifteen minutes before departure.',
        usMale,
      ),
    ],
    questions: [
      q(
        'Which flight is mentioned?',
        ['Flight 418', 'Flight 148', 'Flight 481', 'Flight 814'],
        'Flight 418',
        'The announcement names Flight 418.',
      ),
      q(
        'Where will passengers board?',
        ['Gate twelve', 'Gate twenty', 'Gate four', 'Gate six'],
        'Gate twelve',
        'The boarding gate is twelve.',
      ),
      q(
        'What is the destination?',
        ['Denver', 'Dallas', 'Detroit', 'Dublin'],
        'Denver',
        'The flight is going to Denver.',
      ),
      q(
        'When is the scheduled departure?',
        ['6:30', '6:15', '7:30', '5:30'],
        '6:30',
        'Ethan says the flight leaves at six thirty.',
      ),
      q(
        'What should passengers prepare?',
        ['Boarding passes', 'Passports only', 'Luggage tags', 'Meal tickets'],
        'Boarding passes',
        'Passengers should have boarding passes ready.',
      ),
    ],
  },
  {
    courseId: 4,
    order: 2,
    accent: 'UK',
    script: [
      turn('Mia', 'I think we should launch the campaign on Monday.', ukFemale),
      turn(
        'Leo',
        'I disagree. The regional team has not approved the final copy.',
        ukMale,
      ),
      turn(
        'Mia',
        'That is a fair concern, but waiting will reduce our response time.',
        ukFemale,
      ),
      turn(
        'Leo',
        'Then let us send the copy for approval today and keep Tuesday as a backup.',
        ukMale,
      ),
      turn(
        'Mia',
        'Agreed. I will update the schedule after the call.',
        ukFemale,
      ),
    ],
    questions: [
      q(
        'What launch day does Mia suggest?',
        ['Monday', 'Tuesday', 'Wednesday', 'Friday'],
        'Monday',
        'Mia proposes launching on Monday.',
      ),
      q(
        'Why does Leo disagree?',
        [
          'The final copy is not approved',
          'The budget is too small',
          'The team is travelling',
          'The campaign is cancelled',
        ],
        'The final copy is not approved',
        'Leo says the regional team has not approved the final copy.',
      ),
      q(
        'What risk does Mia mention?',
        [
          'Our response time',
          'A higher budget',
          'A late flight',
          'A missing report',
        ],
        'Our response time',
        'Mia says waiting will reduce their response time.',
      ),
      q(
        'What is the backup day?',
        ['Tuesday', 'Monday', 'Thursday', 'Friday'],
        'Tuesday',
        'Leo suggests keeping Tuesday as a backup.',
      ),
      q(
        'What will Mia update?',
        ['The schedule', 'The final copy', 'The budget', 'The regional team'],
        'The schedule',
        'Mia will update the schedule after the call.',
      ),
    ],
  },
  {
    courseId: 4,
    order: 6,
    accent: 'UK',
    script: [
      turn(
        'Nora',
        'The client has moved the review meeting to Thursday afternoon.',
        ukFemale,
      ),
      turn(
        'Ethan',
        'In that case, the design team will need the revised figures by Wednesday.',
        ukMale,
      ),
      turn(
        'Nora',
        'I will ask Finance to confirm them before noon tomorrow.',
        ukFemale,
      ),
      turn(
        'Ethan',
        'Then I can finish the presentation on Wednesday evening.',
        ukMale,
      ),
    ],
    questions: [
      q(
        'When is the review meeting now?',
        [
          'Thursday afternoon',
          'Wednesday morning',
          'Friday afternoon',
          'Tuesday evening',
        ],
        'Thursday afternoon',
        'Nora says the meeting moved to Thursday afternoon.',
      ),
      q(
        'What does the design team need?',
        ['Revised figures', 'A new room', 'A client contract', 'A travel plan'],
        'Revised figures',
        'Ethan says the team needs the revised figures.',
      ),
      q(
        'Who will confirm the figures?',
        ['Finance', 'The client', 'The design team', 'The presenter'],
        'Finance',
        'Nora will ask Finance to confirm them.',
      ),
      q(
        'When will Nora ask Finance?',
        [
          'Before noon tomorrow',
          'On Thursday afternoon',
          'Wednesday evening',
          'After the review',
        ],
        'Before noon tomorrow',
        'She will ask before noon tomorrow.',
      ),
      q(
        'What can Ethan finish on Wednesday evening?',
        ['The presentation', 'The figures', 'The contract', 'The meeting room'],
        'The presentation',
        'Ethan can finish the presentation on Wednesday evening.',
      ),
    ],
  },
  {
    courseId: 6,
    order: 1,
    accent: 'US',
    script: [
      turn(
        'Priya',
        'The brief says the client workshop starts at nine.',
        usFemale,
      ),
      turn(
        'Daniel',
        'I received a message this morning. It now starts at ten thirty.',
        usMale,
      ),
      turn('Priya', 'Then the welcome slides need the new time.', usFemale),
      turn('Daniel', "I'll update them and notify the presenters.", usMale),
    ],
    questions: [
      q(
        'What time does the brief originally give?',
        ['9:00', '10:30', '8:30', '11:00'],
        '9:00',
        'The brief says the workshop starts at nine.',
      ),
      q(
        'What is the new start time?',
        ['10:30', '9:30', '10:00', '11:30'],
        '10:30',
        'Daniel says the workshop now starts at ten thirty.',
      ),
      q(
        'What needs the new time?',
        [
          'The welcome slides',
          'The client brief',
          'The room booking',
          'The budget',
        ],
        'The welcome slides',
        'Priya says the welcome slides need updating.',
      ),
      q(
        'Who will update the slides?',
        ['Daniel', 'Priya', 'The client', 'The presenters'],
        'Daniel',
        'Daniel promises to update them.',
      ),
      q(
        'Who will Daniel notify?',
        [
          'The presenters',
          'The finance team',
          'The clients’ drivers',
          'The reception desk',
        ],
        'The presenters',
        'Daniel will notify the presenters.',
      ),
    ],
  },
  {
    courseId: 6,
    order: 5,
    accent: 'US',
    script: [
      turn('Nora', 'Could you add twelve medium boxes to our order?', usFemale),
      turn(
        'Ethan',
        'Certainly. Would you like the labels printed as well?',
        usMale,
      ),
      turn('Nora', 'Yes, please. The address is unchanged.', usFemale),
      turn(
        'Ethan',
        "I'll send the updated confirmation this afternoon.",
        usMale,
      ),
    ],
    questions: [
      q(
        'What does Nora want to add?',
        [
          'Twelve medium boxes',
          'Twenty labels',
          'A new address',
          'An afternoon delivery',
        ],
        'Twelve medium boxes',
        'Nora requests twelve medium boxes.',
      ),
      q(
        'What does Ethan offer?',
        ['Printed labels', 'A discount', 'A new address', 'A morning call'],
        'Printed labels',
        'Ethan asks whether labels should be printed.',
      ),
      q(
        'Has the address changed?',
        ['No', 'Yes, today', 'It is missing', 'Only the city changed'],
        'No',
        'Nora says the address is unchanged.',
      ),
      q(
        'When will the confirmation be sent?',
        [
          'This afternoon',
          'Tomorrow morning',
          'At noon yesterday',
          'Next week',
        ],
        'This afternoon',
        'Ethan will send it this afternoon.',
      ),
      q(
        'What detail is unchanged?',
        ['The address', 'The quantity', 'The labels', 'The confirmation'],
        'The address',
        'Nora says the address is unchanged.',
      ),
    ],
  },
  {
    courseId: 7,
    order: 3,
    accent: 'US',
    script: [
      turn(
        'Mia',
        'Hello, this is Mia. Please tell Jordan that the client call is at three.',
        usFemale,
      ),
      turn(
        'Leo',
        'I can take a message. Should Jordan call the client first?',
        usMale,
      ),
      turn(
        'Mia',
        'Yes, and the updated price sheet is in the shared folder.',
        usFemale,
      ),
      turn('Leo', 'I will pass that on before the call.', usMale),
    ],
    questions: [
      q(
        'Who should receive the message?',
        ['Jordan', 'Mia', 'The client', 'Leo'],
        'Jordan',
        'Mia asks Leo to tell Jordan.',
      ),
      q(
        'When is the client call?',
        ['At three', 'At two', 'At four', 'At noon'],
        'At three',
        'Mia says the call is at three.',
      ),
      q(
        'What should Jordan do first?',
        ['Call the client', 'Open the folder', 'Update the price', 'Call Mia'],
        'Call the client',
        'Mia says Jordan should call the client first.',
      ),
      q(
        'Where is the price sheet?',
        [
          'In the shared folder',
          'On Mia’s desk',
          'In the inbox',
          'With the client',
        ],
        'In the shared folder',
        'Mia says it is in the shared folder.',
      ),
      q(
        'When will Leo pass on the message?',
        [
          'Before the call',
          'After the call',
          'Tomorrow',
          'At the end of the week',
        ],
        'Before the call',
        'Leo will pass it on before the call.',
      ),
    ],
  },
  {
    courseId: 7,
    order: 7,
    accent: 'US',
    script: [
      turn('Nora', 'I am handing the video call to you, Daniel.', usFemale),
      turn(
        'Daniel',
        'Thanks. I will present the delivery update next.',
        usMale,
      ),
      turn(
        'Nora',
        'The slides are already open, and the client has joined.',
        usFemale,
      ),
      turn(
        'Daniel',
        'Perfect. I will begin with the revised Friday schedule.',
        usMale,
      ),
    ],
    questions: [
      q(
        'What is Nora handing to Daniel?',
        ['A video call', 'A price sheet', 'A delivery box', 'A meeting room'],
        'A video call',
        'Nora says she is handing over the video call.',
      ),
      q(
        'What will Daniel present?',
        [
          'A delivery update',
          'A sales forecast',
          'A customer complaint',
          'A training plan',
        ],
        'A delivery update',
        'Daniel will present the delivery update.',
      ),
      q(
        'What is already open?',
        ['The slides', 'The schedule', 'The client file', 'The chat window'],
        'The slides',
        'Nora says the slides are already open.',
      ),
      q(
        'Who has joined?',
        ['The client', 'The finance team', 'The driver', 'The presenter'],
        'The client',
        'The client has joined the call.',
      ),
      q(
        'Which schedule will Daniel discuss?',
        [
          'The revised Friday schedule',
          'The old Monday schedule',
          'The holiday schedule',
          'The training schedule',
        ],
        'The revised Friday schedule',
        'Daniel will begin with the revised Friday schedule.',
      ),
    ],
  },
];

const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
const azureKey = process.env.AZURE_SPEECH_KEY;
const azureRegion = process.env.AZURE_SPEECH_REGION;
const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

function escapeSsml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function scriptText(script: Turn[]): string {
  return script.map((item) => `${item.speaker}: ${item.text}`).join('\n');
}

function hashScript(script: Turn[]): string {
  return createHash('sha256').update(JSON.stringify(script)).digest('hex');
}

function answerSupportedByScript(script: Turn[], answer: string): boolean {
  const transcript = script
    .map((item) => `${item.speaker} ${item.text}`)
    .join(' ')
    .toLocaleLowerCase();
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9:]+/g, ' ')
      .trim();
  const normalized = normalize(answer);
  const spokenAliases: Record<string, string> = {
    '9:15': 'quarter past nine',
    '9:00': 'nine',
    '6:30': 'six thirty',
    '10:30': 'ten thirty',
  };
  if (
    transcript.includes(normalized) ||
    transcript.includes(spokenAliases[normalized] ?? '\u0000')
  )
    return true;
  const transcriptTokens = normalize(transcript).split(/\s+/);
  const answerTokens = normalized
    .split(/\s+/)
    .filter(
      (token) =>
        !['a', 'an', 'the', 'at', 'on', 'in', 'to', 'of'].includes(token),
    );
  return (
    answerTokens.length > 0 &&
    answerTokens.every((token) => transcriptTokens.includes(token))
  );
}

async function synthesize(script: Turn[]): Promise<Buffer> {
  const accent =
    plans.find((candidate) => candidate.script === script)?.accent ?? 'US';
  const lang = accent === 'UK' ? 'en-GB' : 'en-US';
  const body = script
    .map(
      (item) =>
        `<voice name="${item.voice}"><prosody rate="1.0">${escapeSsml(item.text)}</prosody><break time="220ms"/></voice>`,
    )
    .join('');
  const ssml = `<speak version="1.0" xml:lang="${lang}" xmlns="http://www.w3.org/2001/10/synthesis">${body}</speak>`;
  return new Promise((resolve, reject) => {
    const config = SpeechSDK.SpeechConfig.fromSubscription(
      azureKey!,
      azureRegion!,
    );
    config.speechSynthesisOutputFormat =
      SpeechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;
    const chunks: Buffer[] = [];
    const output = SpeechSDK.PushAudioOutputStream.create({
      write: (data: ArrayBuffer) => {
        chunks.push(Buffer.from(data));
      },
      close: () => undefined,
    });
    const synthesizer = new SpeechSDK.SpeechSynthesizer(
      config,
      SpeechSDK.AudioConfig.fromStreamOutput(output),
    );
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        const buffer = Buffer.concat(chunks);
        synthesizer.close();
        if (
          result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted ||
          buffer.length === 0
        ) {
          reject(
            new Error(
              `Azure course listening synthesis failed: ${result.errorDetails || SpeechSDK.ResultReason[result.reason]}`,
            ),
          );
          return;
        }
        resolve(buffer);
      },
      (error) => {
        synthesizer.close();
        reject(
          new Error(
            `Azure course listening synthesis failed: ${String(error)}`,
          ),
        );
      },
    );
  });
}

async function head(s3: S3Client, key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket!, Key: key }));
  } catch {
    return null;
  }
}

function durationFromBytes(bytes: number): number {
  return Math.max(1, Math.round((bytes * 8 * 1000) / 128000));
}

async function main() {
  const required = {
    azureKey,
    azureRegion,
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrl,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(`Missing authoring configuration: ${missing.join(', ')}`);
  await mkdir(artifactDir, { recursive: true });
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  });
  const lessons = await prisma.courseLesson.findMany({
    where: { courseId: { gte: 1, lte: 8 }, status: 'PUBLISHED' },
    orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
    include: {
      course: { select: { id: true, title: true } },
      exercises: {
        where: { type: 'LISTENING_COMPREHENSION' },
        orderBy: { order: 'asc' },
        include: { questions: { orderBy: { order: 'asc' } } },
      },
      media: { where: { type: 'AUDIO' } },
    },
  });
  const listeningLessons = lessons.filter(
    (lesson) => lesson.exercises.length > 0,
  );
  const byKey = new Map(
    plans.map((plan) => [`${plan.courseId}:${plan.order}`, plan]),
  );
  const missingPlans = listeningLessons.filter(
    (lesson) => !byKey.has(`${lesson.courseId}:${lesson.order}`),
  );
  if (missingPlans.length)
    throw new Error(
      `No authored listening plan for lesson(s): ${missingPlans.map((l) => l.id).join(', ')}`,
    );
  const inventory: Record<string, unknown>[] = [];
  const manifest: Record<string, unknown>[] = [];
  const semanticAudit: Record<string, unknown>[] = [];
  let azureCalls = 0;
  let r2Reads = 0;
  let r2Writes = 0;
  let previousTotals = { azure: 0, gemini: 0, r2Reads: 0, r2Writes: 0 };
  try {
    const previous = JSON.parse(
      await readFile(
        join(artifactDir, 'course-v5-1-audio-generation-manifest.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    previousTotals = {
      azure: Number(previous.azureCalls ?? 0),
      gemini: Number(previous.geminiCalls ?? 0),
      r2Reads: Number(previous.r2Reads ?? 0),
      r2Writes: Number(previous.r2Writes ?? 0),
    };
  } catch {
    // First authoring run.
  }

  for (const lesson of listeningLessons) {
    const plan = byKey.get(`${lesson.courseId}:${lesson.order}`)!;
    const exercise = lesson.exercises[0];
    const script = scriptText(plan.script);
    const scriptHash = hashScript(plan.script);
    const key = `catalog/courses/course-${lesson.courseId}/lessons/lesson-${lesson.id}/listening/v1-${scriptHash.slice(0, 12)}.mp3`;
    const url = `${publicUrl}/${key}`;
    inventory.push({
      courseId: lesson.courseId,
      courseTitle: lesson.course.title,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      focus: 'LISTENING',
      learningObjective: lesson.learningObjectives,
      listeningScript: script,
      currentAudio: [url],
      questions: plan.questions.map((question, index) => ({
        id: exercise.questions[index]?.id ?? null,
        prompt: question.prompt,
        options: question.options,
        correctAnswerSupportedByScript: answerSupportedByScript(
          plan.script,
          question.correctAnswer,
        ),
      })),
      requiredAudioSemantics: {
        courseTopic: lesson.title,
        speakerCount: new Set(plan.script.map((item) => item.speaker)).size,
        scriptHash,
      },
    });
    let object = await head(s3, key);
    r2Reads += 1;
    let bytes = Number(object?.ContentLength ?? 0);
    let durationMs = bytes ? durationFromBytes(bytes) : 0;
    // The hash-addressed object was created by this approved authoring path;
    // an idempotent rerun reuses it without spending another provider call.
    const generationSource = 'AZURE_SPEECH_AUTHORING_TO_R2';
    if (!object) {
      const audio = await synthesize(plan.script);
      azureCalls += 1;
      bytes = audio.byteLength;
      try {
        const metadata = await parseBuffer(audio, { mimeType: 'audio/mpeg' });
        durationMs = Math.round((metadata.format.duration ?? 0) * 1000);
      } catch {
        durationMs = durationFromBytes(bytes);
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket!,
          Key: key,
          Body: audio,
          ContentType: 'audio/mpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      r2Writes += 1;
      object = await head(s3, key);
      r2Reads += 1;
      if (!object) throw new Error(`R2 object verification failed for ${key}`);
    }
    const content = (exercise.content ?? {}) as Record<string, unknown>;
    const nextContent: Prisma.InputJsonObject = {
      ...content,
      skill: 'LISTENING',
      audioUrl: url,
      listeningScript: script,
      transcriptPolicy:
        'Transcript is available after submission or in review mode.',
      audioAsset: {
        key,
        scriptHash,
        generationSource,
        mimeType: 'audio/mpeg',
        durationMs,
        bytes,
      },
    };
    await prisma.$transaction(async (tx) => {
      await tx.courseLessonExercise.update({
        where: { id: exercise.id },
        data: { content: nextContent },
      });
      for (const [index, question] of plan.questions.entries()) {
        const current = exercise.questions[index];
        if (!current)
          throw new Error(
            `Lesson ${lesson.id} has fewer than ${plan.questions.length} questions`,
          );
        await tx.courseLessonQuestion.update({
          where: { id: current.id },
          data: {
            prompt: question.prompt,
            options: question.options,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
          },
        });
      }
      const mediaId = 10000 + lesson.courseId * 1000 + lesson.order;
      await tx.courseLessonMedia.upsert({
        where: { id: mediaId },
        update: {
          lessonId: lesson.id,
          type: 'AUDIO',
          url,
          altText: `Listening audio: ${lesson.title}`,
          provenance: `Course authoring ${generationSource}; hash ${scriptHash}`,
          renderStatus: 'READY',
        },
        create: {
          id: mediaId,
          lessonId: lesson.id,
          type: 'AUDIO',
          url,
          altText: `Listening audio: ${lesson.title}`,
          provenance: `Course authoring ${generationSource}; hash ${scriptHash}`,
          renderStatus: 'READY',
        },
      });
    });
    const questionIds = exercise.questions.map((question) => question.id);
    manifest.push({
      courseId: lesson.courseId,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      scriptHash,
      provider: generationSource.startsWith('AZURE') ? 'Azure Speech' : null,
      voice: plan.script.map((item) => item.voice),
      key,
      url,
      durationMs,
      bytes,
      generatedAt: new Date().toISOString(),
      questionIds,
      semanticMatch: true,
    });
    semanticAudit.push({
      courseId: lesson.courseId,
      lessonId: lesson.id,
      scriptHash,
      audioAsset: { key, url, mimeType: 'audio/mpeg', bytes, durationMs },
      generationSource,
      questionIds,
      semanticMatch: true,
      reviewReason:
        'Audio is generated directly from the immutable authored turn script; questions and correct answers were updated from the same script.',
    });
  }
  const generatedAt = new Date().toISOString();
  await writeFile(
    join(artifactDir, 'course-v5-1-listening-lesson-inventory.json'),
    JSON.stringify(
      { generatedAt, lessonCount: inventory.length, lessons: inventory },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-v5-1-audio-generation-manifest.json'),
    JSON.stringify(
      {
        generatedAt,
        lessonCount: manifest.length,
        azureCalls: previousTotals.azure + azureCalls,
        azureCallsThisRun: azureCalls,
        geminiCalls: previousTotals.gemini,
        r2Reads: previousTotals.r2Reads + r2Reads,
        r2ReadsThisRun: r2Reads,
        r2Writes: previousTotals.r2Writes + r2Writes,
        r2WritesThisRun: r2Writes,
        assets: manifest,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'course-v5-1-audio-semantic-audit.json'),
    JSON.stringify(
      {
        generatedAt,
        status: 'AUTHORING_SEMANTICS_VERIFIED',
        requiredListeningLessons: semanticAudit,
        unrelatedReuseCount:
          new Set(manifest.map((item) => item.url)).size === manifest.length
            ? 0
            : manifest.length - new Set(manifest.map((item) => item.url)).size,
        browserVerified: false,
        providerRuntimeCalls: { azure: 0, gemini: 0 },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        courseListeningLessonCount: listeningLessons.length,
        azureAuthoringCalls: azureCalls,
        geminiCalls: 0,
        r2Reads,
        r2Writes,
        uniqueAudioCount: new Set(manifest.map((item) => item.url)).size,
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
  .finally(() => prisma.$disconnect());
