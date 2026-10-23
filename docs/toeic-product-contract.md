# BreadTrans TOEIC product contract

This document records the product baseline used by BreadTrans. BreadTrans
creates original practice material that simulates TOEIC structure; it is not
ETS, does not issue ETS certificates, and its results are internal practice
indicators rather than official ETS scores.

## Authoritative format references

- ETS Listening & Reading overview: https://www.ets.org/toeic/about/listening-reading.html
- ETS Listening & Reading examinee handbook: https://www.ets.org/content/dam/ets-org/fr/pdfs/toeic/toeic-listening-reading-test.pdf
- ETS Speaking & Writing overview: https://www.ets.org/content/ets-org/ca/en/toeic/test-takers/about/speaking-writing.html
- IIBC Speaking & Writing format reference: https://www.iibc-global.org/english/toeic/test/sw/about/format.html
- IIG Vietnam TOEIC overview: https://toeic.iigvietnam.com/gioi-thieu-bai-thi/?test=toeic_cat
- IIG Vietnam candidate guide: https://iigvietnam.com/wp-content/uploads/2025/07/HUONG-DAN-DU-THI-TOEIC-BAN-TV-_Jul.25-upw.pdf

## BreadTrans L&R baseline for Vietnam

BreadTrans L&R full practice tests model 200 questions in approximately 120
minutes: Listening 100 questions / about 45 minutes, then Reading 100
questions / about 75 minutes. The canonical part counts are P1 6, P2 25,
P3 39, P4 30, P5 30, P6 16, P7 54.

Listening source semantics are explicit:

- P1 has one image and four original spoken statements; one statement is
  correct. The TTS script is all four statements in A–D order.
- P2 has one original spoken prompt and three original spoken responses; one
  response is correct. The TTS script is the prompt followed by A–C.
- P3 TTS receives the complete dialogue, and P4 TTS receives the complete
  talk. Question text, explanations, and metadata are never substituted into
  the spoken script.

## Speaking, Writing, and 4 Skills terminology

Speaking and Writing remain their own skill-test contracts in BreadTrans. The
current product vocabulary uses the familiar Vietnam-targeted composition of
L&R plus S&W for “TOEIC 4 Skills”. This is BreadTrans orchestration, not a
claim to reproduce a different ETS Global single-session/adaptive 4-Skills
offering. ETS Global does document TOEIC 4-Skills in some markets; BreadTrans
must never claim that ETS has no official 4-Skills offering.

## Scope boundary

Official content/format rules are separate from BreadTrans strict-mode policy.
Fullscreen, device checks, microphone preflight, continuous playback, and
attempt navigation rules are BreadTrans runtime decisions, not claimed ETS
requirements. They are intentionally outside the Phase 0 media contract.

## Media provenance and readiness

Every newly generated Listening artifact receives a stable SHA-256 fingerprint
of the script-builder version, Part, canonical accent, and exact spoken script.
Readiness fails closed when a generated artifact lacks or mismatches that
fingerprint. Legacy authored media remains compatible when it has no generated
AI provenance; it is not rewritten merely to adopt the new contract.
