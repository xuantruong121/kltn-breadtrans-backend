# Provider usage ledger (agent-run calls)

Durable record of third-party calls made by the agent for verification. Calls made by the owner's
own app on :3000/:3001 are NOT counted here; they are reconstructable from kltn_db
(`SpeakingSubmission.provider = 'azure'`, Diagnostic grading rows).

All accounts are free tier (owner-confirmed: Azure Speech F0, Gemini keys without billing).

| Date | Provider | Kind | Count | Size | Purpose | Exact? |
|---|---|---|---|---|---|---|
| 2026-10-26 | Azure Speech | STT sessions (C3 cap 6 / 210 s) | 5 | 153.9 s | Entry Diagnostic V2 real smoke | exact |
| 2026-10-26 | Azure Speech | STT session, unscripted | 1 | 34.5 s | Practice free-answer smoke (synthetic TTS voice) | exact |
| 2026-10-26 | Azure Speech | TTS | 4 | ~1,692 chars | Diagnostic V2 listening clips | exact |
| 2026-10-26 | Azure Speech | TTS | 30 | 2,753 chars | Speaking reference clips en-US | exact |
| 2026-10-26 | Azure Speech | TTS | 30 | 2,753 chars | Speaking reference clips en-GB | exact |
| 2026-10-26 | Gemini | structured grading | 2 | – | Entry Diagnostic V2 real smoke | exact |
| 2026-10-27 | Azure Speech | TTS | 7 | 722 chars | TOEIC Speaking exam question audio (Q5-11, shared by S&W and 4 Skills) | exact |
| 2026-10-26 | Gemini | structured grading | 3 grades | – | Writing practice real grading (quiz 3, quiz 17, duplicate test) | 3–6 requests: per-grade retries were not logged |
| 2026-10-27 | Gemini | TOEIC Writing grading (text + vision) | 8 tasks | – | One real S&W Writing section, assessment 1 (cap 12 incl. retries) | 8 sent by the script; key-rotation retries are not logged, so 8 or more |

Totals against the C3 smoke cap: Azure STT 6/6 sessions, 188.4/210 s (cap exhausted; any new
session needs a new owner-approved cap). Gemini: 5–8 of the C3 16 before TOEIC; TOEIC Writing used its own cap of 12 (8 sent).

From now on every agent-run provider call is appended here before the report that uses it.
Read-aloud real-voice evidence comes from the owner's own submission 294 (not an agent call).
