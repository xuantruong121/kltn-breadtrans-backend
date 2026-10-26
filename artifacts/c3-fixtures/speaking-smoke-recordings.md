# Phase C3 live smoke — Speaking recordings to supply

These recordings are **not** in the repository. For the bounded live smoke test they must be recorded
by the developer themselves, with their consent, and placed in a local folder passed as `--audio-dir`.
No learner audio and no third-party voice may be used. Any common format works (`.webm`, `.m4a`, `.ogg`,
`.wav`); the server normalizer converts it to 16 kHz mono PCM before Azure sees it.

| File name | Task | Length | What to say | Expected outcome |
|---|---|---|---|---|
| `S1_ON_TASK_45.*` | SPK_TASK_01 (45 s) | 35–45 s | Answer the prompt naturally: where you study, when, why it suits you | `GRADED`; transcript close to what was said |
| `S2_ON_TASK_PAUSES_60.*` | SPK_TASK_02 (60 s) | 50–60 s | Answer with a reason and an example, leaving two or three real pauses of 1–2 s | `GRADED`; `longPauseCount` ≥ 1 |
| `S3_SILENCE_10.*` | SPK_TASK_01 | about 10 s | Stay silent (room noise only) | `GRADING_FAILED` with `INSUFFICIENT_EVIDENCE`; the language model is **not** called |
| `S4_OFF_TOPIC_45.*` | SPK_TASK_01 | 35–45 s | Talk fluently about something unrelated (for example a film) | `GRADED`; `task_fulfilment` low |

Prompts, from the approved content:

- **SPK_TASK_01** — "Talk about a place where you usually study or work. Say where it is, when you normally
  go there, and why it suits you."
- **SPK_TASK_02** — "Some people prefer to study with other people; others prefer to study alone. Which do
  you think works better, and why? Give at least one reason and one example from your own experience."

For each recording, also write down what you actually said (a plain-text transcript in a file with the
same name and `.txt`). The smoke run compares it with Azure's transcript to estimate whether single-pass
unscripted recognition is accurate enough, which decides between the current design and the two-pass
upgrade described in the C3 report.
