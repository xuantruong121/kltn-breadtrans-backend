# AI answer-review reasoning probe, 2026-11-04

Owner approved a few real provider calls to measure what the reasoning
setting costs. Script: `scripts/ai-reasoning-probe.ts --live` (one original
TOEIC Part 5 group of 3 items, `solvePrompt`, keys 1/2/0). Keys and account
ids were read from the owner `.env` and never printed.

## Results (one call each)

| Setting | Status | Input tok | Output tok | Neurons (reported) | Latency | JSON | Correct |
|---|---|---|---|---|---|---|---|
| Cloudflare chat `messages` (client default) | 200 | 353 | 701 | 59.03 | 12.5 s | yes | 3/3 |
| Cloudflare Responses, `reasoning.effort=low` | 200 | 353 | 301 | 31.25 | 4.2 s | yes | 3/3 |
| Cloudflare Responses, `reasoning.effort=medium` | 200 | 353 | 519 | 46.11 | 11.2 s | yes | 3/3 |
| Groq `openai/gpt-oss-120b`, `reasoning_effort=low` | 200 | 506 | 404 (160 reasoning) | n/a | 1.6 s | yes | 3/3 |
| Groq `openai/gpt-oss-120b`, `reasoning_effort=medium` | 200 | 554 | 740 (588 reasoning) | n/a | 1.9 s | yes | 3/3 |

After the client change, one more call went through
`CloudflareWorkersAiClient.generateJsonDetailed` with
`CLOUDFLARE_AI_REASONING_EFFORT=medium`. It also sent `temperature` and
`max_output_tokens`. Result: 200, 288 input / 299 output tokens, 29.04
Neurons, 4.4 s, correct choice.

## Findings

- Cloudflare chat replies carry `usage.prompt_tokens`,
  `usage.completion_tokens` and `usage.neurons`. The client already read the
  token names, so the token names do not explain the missing token counts in
  the 2026-11-04 live-run telemetry. That cause is NOT_VERIFIED. Telemetry
  now also records `neurons` from Cloudflare itself.
- On this item the Responses format with `medium` used 22% fewer Neurons than
  the chat default, and `low` used 47% fewer.
- Output stays at 300 to 740 tokens, far under the 8,000 cap, so per-Part
  `max_tokens` caps would save nothing. Not implemented.

## Limits

Five calls on three easy grammar items prove the formats work and show the
direction of the cost change. They do not prove that `low` keeps accuracy on
Part 3/4/6/7 items, which need longer reasoning. Measuring that takes a full
L&R run with each setting.

```
CLOUDFLARE_RESPONSES_FORMAT_WORKS=PASS          (3 calls, all valid JSON)
CLOUDFLARE_USAGE_HAS_NEURONS=PASS               (all 4 Cloudflare calls)
REASONING_LOW_ACCURACY_ON_HARD_PARTS=NOT_VERIFIED
TELEMETRY_TOKEN_GAP_CAUSE=NOT_VERIFIED
```

## Setting

`CLOUDFLARE_AI_REASONING_EFFORT` (low | medium | high) turns on the Responses
format. Unset keeps the chat format, so behaviour does not change until the
owner sets it. Suggested start: `medium`. Move to `low` only after a full L&R
run shows refusals do not rise.
