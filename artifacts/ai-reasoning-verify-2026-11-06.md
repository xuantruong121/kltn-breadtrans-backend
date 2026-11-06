# Cloudflare reasoning effort: low against medium, full run (2026-11-06)

Script: `scripts/ai-reasoning-verify-2026-11-06.ts --live` (owner approved real calls).
Raw rows: `artifacts/ai-reasoning-verify-2026-11-06.json`. Model `@cf/openai/gpt-oss-120b`,
production path `CloudflareWorkersAiClient.generateJsonDetailed`, effort switched per call.
The 2026-11-04 probe asked for "a full L&R run with each setting" before moving to `low`;
the 2026-11-06 parts probe compared `low` with the chat format only, not with `medium`.

## Answer review (independent solve), exam 3, Parts 2-7, one call per Part

| Part | Items | `low` correct | `medium` correct | `low` Neurons | `medium` Neurons |
|---|---|---|---|---|---|
| 2 | 25 | 25 | 25 | 221 | 315 |
| 3 | 39 | 38 (q37) | 39 | 336 | 493 |
| 4 | 30 | 29 (q96, graphic) | 30 | 290 | 410 |
| 5 | 30 | 30 | 30 | 195 | 294 |
| 6 | 16 | 16 | 16 | 161 | 214 |
| 7 | 54 | 51 (q186, q192, q199) | 53 (q192) | 426 | 614 |
| Total | 194 | 189 | 193 | 1,629 | 2,339 |

Part 1 is reviewed by vision and does not use this setting. Graphic groups were given their
`GRAPHIC:` passage from batch C data (the state after the pending graphic correction).

A wrong solve is not a harmless miss: the review marks the group REJECTED, so an admin must
look at it. `low` produced 5 such false rejections on one exam, 3 of them in Part 7 multi-passage
sets; `medium` produced 1. q192 (a cross-document price inference, key $24) was missed by both;
the key was re-checked by hand and holds.

## Stand-in exam generation (one call per setting, production validators)

| Request | `low` | `medium` |
|---|---|---|
| Part 3: one three-speaker group, one graphic group | refused: 2 speakers; no GRAPHIC passage; graphic question without graphic | refused: wrong group count |
| Part 7: one triple-passage group | passed | passed |

One call each is too few to rank the settings for generation; production retries a refused
batch with the reason. `low` missed both planned traits on Part 3.

## Verdict

```
LOW_ACCURACY_EQUALS_MEDIUM=FAIL            (189/194 against 193/194; Part 7 51/54 against 53/54)
LOW_SAVES_NEURONS=PASS                     (about 30% fewer on the full run)
GENERATION_LOW_VS_MEDIUM=NOT_VERIFIED      (1 call per setting per request)
GRAPHIC_REVIEW_WITH_PASSAGE=PASS on medium (q63-q99 graphic items solved; low missed q96)
```

Recommendation: keep `CLOUDFLARE_AI_REASONING_EFFORT="medium"`. A full exam review costs about
2,300 Neurons on `medium`, well inside the 10,000 daily allocation; the 700 saved by `low` do not
pay for four extra false rejections per exam. This reverses the recommendation of
`artifacts/ai-reasoning-probe-parts-2026-11-06.md`.
