# Cloudflare Workers AI: Parts 3, 4, 6, 7 accuracy and token fields (2026-11-06)

Script: `scripts/ai-reasoning-probe-parts.ts --live` (owner approved real calls on 2026-11-06).
Model `@cf/openai/gpt-oss-120b`, exam 1 (`examId=1`), first 3 groups of each part (39 questions).
The DB was only read. Input built with the production helpers (`solveRequestOf`, `solvePrompt`).

## Results

| Part | Questions | chat (messages) correct | chat Neurons | Responses `low` correct | `low` Neurons |
|---|---|---|---|---|---|
| 3 | 9 | 9/9 | 147.5 | 9/9 | 85.8 |
| 4 | 9 | 9/9 | 127.4 | 9/9 | 98.5 |
| 6 | 12 | 12/12 | 195.0 | 12/12 | 125.7 |
| 7 | 9 | 9/9 | 142.4 | 9/9 | 79.5 |
| Total | 39 | 39/39 | 612.3 | 39/39 | 389.5 |

All 8 replies returned HTTP 200 with valid JSON. In total, 8 calls used about 1,002 Neurons, against a free allocation of 10,000 per day.

## Token field names

```
TOKEN_FIELDS_CHAT=VERIFIED      usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, usage.neurons
TOKEN_FIELDS_RESPONSES=VERIFIED usage.input_tokens, usage.output_tokens, usage.total_tokens, usage.neurons
CLIENT_READS_BOTH=VERIFIED      cloudflare-workers-ai.client.ts:58-61 reads prompt_tokens ?? input_tokens, completion_tokens ?? output_tokens, neurons
```

## Accuracy of `low`

```
LOW_ACCURACY_P3_P4_P6_P7=PASS on this sample (39/39, same as chat)
```

Limits:
- 39 questions from one exam is a small sample. They are the first three groups of each part.
- Part 7 groups here are single passages, so double and triple passage sets were not covered.
- `medium` (the current `CLOUDFLARE_AI_REASONING_EFFORT` in the owner's `.env`) was not re-run on these parts.

## Recommendation (not applied)

`low` matched chat accuracy here and used 35–45% fewer Neurons than chat on these parts. Earlier, on Part 5, `low` used 31 Neurons against 46 for `medium` (`artifacts/ai-reasoning-probe-2026-11-04.md`).

Setting `CLOUDFLARE_AI_REASONING_EFFORT="low"` would save quota. It needs a backend restart to take effect, so it is left to the owner.
