# Entry Diagnostic fixtures

These immutable JSON fixtures are the validated outputs used by
src/modules/diagnostic/diagnostic-ux-repair.spec.ts.

| File | Source artifact | SHA-256 |
| --- | --- | --- |
| final-language-use-matrix.json | D:\\Study\\KLTN\\artifacts\\entry-diagnostic-semantic-blueprint\\final-language-use-matrix.json | DCC52766BD4940F9AEC404F7DE83AB763875511113104DA1204613374F4000E2 |
| entry-diagnostic-question-audit-after.json | D:\\Study\\KLTN\\artifacts\\entry-diagnostic-2\\entry-diagnostic-question-audit-after.json | 2BF0CA135A845C4DF42668FF023F71E49CA048EC41AEBB9777459F336548D103 |

The source artifacts were generated and validated by the Entry Diagnostic materialization/audit workflow before being copied into this repository. The first JSON source had no final newline (source SHA-256: BB2AF3DFB9DB36180E2886FE50861CD4E58FBB34B143BD9A1FA3BAEA26D7D224); the committed fixture is the same parsed JSON with the repository-standard final newline. The fixtures are version-controlled so a clean clone and GitHub Actions run do not depend on a developer workspace outside the repository.

To update them safely, run the existing materializer/audit workflow against an isolated development or test database, validate the resulting counts, CEFR metadata, stable keys, option correctness, and collision checks, then replace the fixtures and update the checksums above. CI must never run scripts/materialize-entry-diagnostic-v2.ts; that script mutates business data.
