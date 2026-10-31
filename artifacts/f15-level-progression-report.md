# F15 level progression: harness report

Date: 2026-10-31. Design: `Project/LEVEL_PROGRESSION_DESIGN.md`.
Backend `feature/level-gate`, frontend `feature/level-unlock-ui` `47f5706`. Nothing here ran against kltn_db.

```
HARNESS_DB=p3_rehearsal
HARNESS_SYSID=7700844886515650595
PROTECTED_SYSID=7674533776495505443
EXTERNAL_PROVIDERS=none (deterministic grader, MOCK_AZURE_SPEECH, fake S3)
```

## Lock

```
LOCKED_ITEM_DIRECT_URL=403 LEVEL_LOCKED skill=READING level=INTERMEDIATE unlockedLevel=BASIC
GUEST_DIRECT_URL=401
LIST_ROWS_LOCKED=B1, B2, C1 locked; A2, A1-A2 open (student1, READING at BASIC)
ITEM_LEVEL_USES_RANGE_MIN=A1-A2 reported as STARTER
BROWSER_LOCK_BUTTONS_READING=4
BROWSER_DIRECT_URL=lock screen "Chưa mở mức Trung cấp"
BROWSER_ESCAPE_CLOSES_DIALOG=PASS
REC_API_FIELDS=FREE learner planLocked true; learner with a plan planLocked false
REC_CARD_BROWSER_CLICK=NOT_RUN (the dashboard Today list had no level-locked item)
```

## Gate

```
GATE_QUESTIONS_SERVED=8
GATE_FIELDS=id, quizId, text, options, passage, hasAudio
GATE_RESPONSE_TEXT_MATCHES_KEY_TERMS=false (regex over correctIndex, correct, explanation, translation, transcript)
GATE_RESUME_SAME_ATTEMPT=true
GATE_FAIL=0/8, retryAt +24h
GATE_RESUBMIT_RIGHT_ANSWERS_AFTER_FAIL=score stays 0, passed false
GATE_START_DURING_WAIT=409 GATE_COOLDOWN
GATE_OTHER_LEARNER_SUBMIT=404
GATE_AFTER_WAIT=retryAt null, available (submittedAt moved back 25 hours in the harness database)
GATE_PASS=8/8, LevelUnlock GATE_TEST for STARTER, BASIC, INTERMEDIATE
ITEM_AFTER_PASS=200
SPEAKING_GATE=available false, reason PROGRESS_ONLY
GATE_AUDIO_OWN_ATTEMPT=200 audio/mpeg, bytes identical to the stored object
GATE_AUDIO_FOREIGN_QUESTION=404
GATE_AUDIO_OTHER_LEARNER=404
GATE_AUDIO_AFTER_SUBMIT=404
BROWSER_FAIL_THEN_PASS=PASS, the list drops from 4 locked items to 1 after the pass
BROWSER_AUDIO=loads from a blob URL, duration 3.4 s
BROWSER_EXIT_GUARD_DURING_GATE=PASS
```

## Progress

```
LISTENING_3_ITEMS_100=BASIC to INTERMEDIATE on the third item, LevelUnlock PATH_PROGRESS reason ITEMS
RESUBMIT_SAME_QUIZ=done stays 1
READING_REPLAY_SAME_CLIENT_ATTEMPT_ID=2 requests, 1 event
LIST_AFTER_UNLOCK=all six INTERMEDIATE items open
SPEAKING_LEGACY_POLLER=3 exercises at 8.1 recorded as 81, INTERMEDIATE opened, reason ITEMS
SPEAKING_BULLMQ_WORKER=same result through src/worker/speaking-worker.main.ts
SPEAKING_SCORE_SCALE=8.1 stored as 81
THETA_REPLAY_LEGACY=0.302329, 0.348468, 0.389712 observed, identical from theta 0.25, b -0.5
THETA_REPLAY_BULLMQ=0.298800, 0.342679, 0.382301 observed, identical continuing the same item
ITEM_DIFFICULTY_AFTER_6_ATTEMPTS=-0.563362 observed and replayed
```

## Exemptions

```
PLAIN_B1_WRITING=403 LEVEL_LOCKED (control)
SAME_QUIZ_WITH_COURSE_ID=403 FEATURE_NOT_INCLUDED, so the level check did not fire
EXAM_START_WITH_B2_WRITING_TASK=403 FEATURE_NOT_INCLUDED, so the level check did not fire
EXAM_SPEAKING_ROUTE=NOT_VERIFIED: GET /speaking/exercises/32 answers 404, covered by a unit spec only
EXAM_ATTEMPT_PAST_THE_ENTITLEMENT_CHECK=NOT_RUN: needs a learner holding the exam's plan
```

Both 403 results above show only that the plan check answered instead of the level check.

## Layout

```
OVERFLOW_390_CATALOGS=0 for reading, listening, writing, speaking
OVERFLOW_390_DIALOG=0
OVERFLOW_390_GATE=0
OVERFLOW_390_DASHBOARD=0
PAGE_ERRORS=0
DESIGN_LINT_ON_LOGGED_IN_SCREENS=NOT_RUN: the inspector cannot log in; screenshots were read by eye instead
```

## Static checks

```
BACKEND_LINT=0 errors, 1 older warning in course.service.spec.ts
BACKEND_TYPECHECK=PASS
BACKEND_BUILD=PASS
BACKEND_JEST=1948 passed, 30 skipped (disposable database and Redis port)
FRONTEND_LINT_TYPECHECK_TEST=PASS, tests 777 before the guard fix; npm run ci:check reached its build step after it
FRONTEND_BUILD_TURBOPACK=FAILED in the worktree: "Symlink [project]/node_modules is invalid", a junction limit
FRONTEND_BUILD_WEBPACK=PASS
```

## Wrong turns recorded

- The first browser run stalled on the lock screen's gate link. It was a real bug, not a test fault: the exit guard stayed
  active with no exercise loaded and swallowed every link, and that screen returns before the confirm dialog renders.
  `PlanLockedScreen` had the same fault. Fixed in frontend `47f5706`.
- The first gate audio check returned 500 because the fake bucket was empty, then again because the clip was placed in the
  public bucket while the key is private. The normal audio route gave the same 500 on the empty bucket.
- `qa-backend` seemed hung because the backend logs almost nothing on start. It needs a poll, not its log.

## Not deployed

The `LearnerProgressEvent` migration is on the harness only. kltn_db needs a verified backup and `migrate deploy` first,
then develop fast-forwards and the speaking worker restarts.
