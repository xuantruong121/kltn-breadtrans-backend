/**
 * One real independent-solve call to Cloudflare Workers AI with
 * response_format json_schema, validated by the same fail-closed checks the
 * backend uses. Prints no credential.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/ai-exam-review-smoke.ts <out.json>
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { CloudflareWorkersAiClient } from '../../src/modules/ai/cloudflare-workers-ai.client';
import { solvePrompt } from '../../src/modules/ai/toeic-answer-review-prompt';
import {
  judgeSolve,
  solveRequestOf,
  validateSolveOutput,
} from '../../src/modules/toeic/toeic-answer-review.logic';

const part3 = {
  transcript:
    'W: Hi Tom, the projector in room B is not working again.\nM: I know. I already called the maintenance office, and they will send someone at two o’clock.\nW: Good. Then we can move the sales meeting to room C until then.',
  questions: [
    {
      text: 'What will happen at two o’clock?',
      options: [
        'A technician will arrive',
        'A sales meeting will end',
        'A new projector will be delivered',
        'Room C will be cleaned',
      ],
      correctIndex: 0,
      explanation: 'unused',
    },
  ],
};

async function main() {
  const out = process.argv[2];
  const client = new CloudflareWorkersAiClient();
  const result: Record<string, unknown> = {
    at: new Date().toISOString(),
    configured: client.configured(),
    model: client.textModel(),
  };
  if (!client.configured()) {
    result.status = 'BLOCKED';
    result.reason = 'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN not set';
  } else {
    const request = solveRequestOf(3, [{ group: part3, firstQuestionNumber: 32 }]);
    const prompt = solvePrompt(request);
    const startedAt = Date.now();
    try {
      const reply = await client.generateJsonDetailed(prompt);
      const checked = validateSolveOutput(
        [{ id: 'q32', optionCount: 4, part: 3 }],
        reply.data,
      );
      result.latencyMs = Date.now() - startedAt;
      result.usage = reply.usage ?? null;
      result.validation = checked.ok ? 'VALID' : `INVALID: ${checked.reason}`;
      if (checked.ok) {
        const answer = checked.answers.get('q32')!;
        result.answer = answer;
        result.verdict = judgeSolve({
          part: 3,
          stimulus: part3.transcript,
          questionText: part3.questions[0].text,
          key: 0,
          answer,
        });
      } else result.raw = reply.data;
      result.status = checked.ok ? 'OK' : 'INVALID';
    } catch (error) {
      result.latencyMs = Date.now() - startedAt;
      result.status = 'ERROR';
      result.error = String((error as Error)?.message ?? error).slice(0, 300);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
}

void main();
