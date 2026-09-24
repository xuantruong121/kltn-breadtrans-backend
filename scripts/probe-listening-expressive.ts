import 'dotenv/config';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

type ProbeCase = {
  name: string;
  voice: string;
  ssml: string;
  requiredBookmarks?: string[];
};

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) {
  console.error('AZURE_SPEECH_KEY/AZURE_SPEECH_REGION are required.');
  process.exit(2);
}

const wrap = (voice: string, body: string) =>
  `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name="${voice}">${body}</voice></speak>`;

const cases: ProbeCase[] = [
  {
    name: 'Jenny friendly',
    voice: 'en-US-JennyNeural',
    requiredBookmarks: ['friendly-start'],
    ssml: wrap('en-US-JennyNeural', '<mstts:express-as style="friendly" styledegree="0.9"><bookmark mark="friendly-start"/>Hello there.<break time="120ms"/></mstts:express-as>'),
  },
  {
    name: 'Jenny chat',
    voice: 'en-US-JennyNeural',
    ssml: wrap('en-US-JennyNeural', '<mstts:express-as style="chat" styledegree="0.9">How is your day?</mstts:express-as>'),
  },
  {
    name: 'Jenny cheerful',
    voice: 'en-US-JennyNeural',
    ssml: wrap('en-US-JennyNeural', '<mstts:express-as style="cheerful" styledegree="0.85">That is wonderful news.</mstts:express-as>'),
  },
  {
    name: 'Guy friendly',
    voice: 'en-US-GuyNeural',
    ssml: wrap('en-US-GuyNeural', '<mstts:express-as style="friendly" styledegree="0.9">Thanks for checking.</mstts:express-as>'),
  },
  {
    name: 'Guy cheerful',
    voice: 'en-US-GuyNeural',
    ssml: wrap('en-US-GuyNeural', '<mstts:express-as style="cheerful" styledegree="0.85">That sounds great.</mstts:express-as>'),
  },
  {
    name: 'Guy emphasis',
    voice: 'en-US-GuyNeural',
    ssml: wrap('en-US-GuyNeural', 'The <emphasis level="moderate">north</emphasis> entrance is easier.'),
  },
  {
    name: 'Multi voice + bookmarks',
    voice: 'en-US-JennyNeural',
    requiredBookmarks: ['a-start', 'a-end', 'b-start', 'b-end'],
    ssml: `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name="en-US-JennyNeural"><bookmark mark="a-start"/>Hello there, this is a longer sentence for timing<bookmark mark="a-end"/>. <break time="120ms"/></voice><voice name="en-US-GuyNeural"><bookmark mark="b-start"/>Hi there, thanks for the update<bookmark mark="b-end"/>. </voice></speak>`,
  },
];

function runProbe(item: ProbeCase): Promise<{ ok: boolean; bookmarks: string[]; bytes: number; error?: string }> {
  return new Promise((resolve) => {
    const config = SpeechSDK.SpeechConfig.fromSubscription(key!, region!);
    config.speechSynthesisOutputFormat = SpeechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;
    let bytes = 0;
    const bookmarks: string[] = [];
    const stream = SpeechSDK.PushAudioOutputStream.create({
      write: (data: ArrayBuffer) => {
        bytes += data.byteLength;
      },
      close: () => undefined,
    });
    const audio = SpeechSDK.AudioConfig.fromStreamOutput(stream);
    const synthesizer = new SpeechSDK.SpeechSynthesizer(config, audio);
    synthesizer.bookmarkReached = (_sender, event) => bookmarks.push(event.text);
    synthesizer.speakSsmlAsync(
      item.ssml,
      (result) => {
        const synthesisOk = result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted && bytes > 0;
        const missingBookmarks = (item.requiredBookmarks ?? []).filter(
          (mark) => !bookmarks.includes(mark),
        );
        const ok = synthesisOk && missingBookmarks.length === 0;
        const error = ok ? undefined : result.errorDetails || SpeechSDK.ResultReason[result.reason];
        setTimeout(() => {
          synthesizer.close();
          resolve({
            ok,
            bookmarks,
            bytes,
            ...(missingBookmarks.length
              ? { error: `${error ?? 'bookmark validation failed'}; missing: ${missingBookmarks.join(', ')}` }
              : error
                ? { error }
                : {}),
          });
        }, 300);
      },
      (error) => {
        synthesizer.close();
        resolve({ ok: false, bookmarks, bytes, error: String(error) });
      },
    );
  });
}

async function main() {
  const results: Record<string, Awaited<ReturnType<typeof runProbe>>> = {};
  for (const item of cases) {
    results[item.name] = await runProbe(item);
  }
  console.log(JSON.stringify({ region, results }, null, 2));
  if (Object.values(results).some((result) => !result.ok)) process.exitCode = 1;
}

void main();
