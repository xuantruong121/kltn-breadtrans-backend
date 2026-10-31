# F10.1 regression report

Date: 2026-10-31. Harness: a clone of kltn_db in `harness-pg` (database `f10`), FE :3100, BE :3101, Redis :6392, fake S3
:9460, deterministic grader and mock speech. Nothing here wrote kltn_db.

```
HARNESS_SYSID=7700844886515650595
PROTECTED_SYSID=7674533776495505443
EXTERNAL_PROVIDERS=none
QA_ORPHAN_RECORDS_AFTER_CLEANUP=0
```

## Suites

The two `cp58` suites and the security phase's entitlement check were written before the F11.3 plan matrix, level locks
and paged catalogs. They were updated to the current rules and run again. The first run's failures came from that, apart
from the English titles below.

```
GLOBAL_BROWSER_ROUTES=30 PASS, 4 FAIL (see Accepted)
GLOBAL_SECURITY_IDOR=PASS
GLOBAL_SECURITY_EMPTY_STATES=PASS
GLOBAL_SECURITY_ENTITLEMENT_SMOKE=PASS
CP58_ENTITLEMENT_FAILURES=0
CP58_CATALOG_FAILURES=0
CP57_JOURNEY_FAILURES=0 in 2 of 3 runs; see Accepted
F15_API=PASS (lock, gate, progress, replay)
FE_RESPONSIVE_INVARIANTS=PASS
BACKEND_JEST=see Static checks
```

## Found and fixed

- The 48 published F8 items showed English titles in catalogs and on the dashboard, and recommendations skipped the title
  map. Titles were added and recommendations now use the map.
- Gate copy spelled "khoá" against "khóa" in the rest of the app.

## Accepted, not regressions

- Phase B fails `/courses`, `/courses/:id`, `/my-courses`, `/classes`: courses are hidden by `COURSES_ENABLED` (F1), so
  these show the not-found page. The API answers 404, as the entitlement suite now asserts.
- `cp57` failed once on "the result shows a score": the task was stored and the check's 6 second wait ended first, while
  the machine ran the full suite. Two reruns passed. A slow grade under load is not excluded.
- Responsive `offscreen` on `/speaking` at phone width (new since 2026-10-25): both controls are category chips inside an
  `overflow-x-auto` rail, measured directly. Horizontal page overflow is 0.
- Responsive `offscreen` on `/listening/1`, `/market`, `/arena`, `/exams`: same result recorded on 2026-10-25, overflow 0.
  Their controls were not inspected one by one.
- Back-navigation: `/listening` stays in the room because the exit guard holds the back action. `/exams` returns to the
  list at scroll 0; no exam page changed in this work. Neither was changed here.
- Harness `NoSuchKey` on audio: the fake bucket is empty.

## Not run

```
LIVE_AZURE_GEMINI_R2_IN_THIS_SUITE=NOT_RUN (providers are off on the harness)
OWNER_LISTENED_TO_NEW_AUDIO=PASS, reported by the owner on a sample, not all 17 clips
COURSE_ROUTES_WITH_FLAG_ON=NOT_RUN
```

## Static checks

Recorded in `Project/AGENT_STATE.md` for the final commits.
