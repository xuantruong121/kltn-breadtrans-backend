import { harnessExec, harnessQuery } from './scripts/qa/harness-db';
const mode = process.argv[2];
if (mode === 'on') harnessExec(`begin; update "DiagnosticAssessment" set "isActive" = false, status = 'READY' where id = 1; update "DiagnosticAssessment" set "isActive" = true, status = 'ACTIVE' where id = 5; commit;`);
if (mode === 'off') harnessExec(`begin; update "DiagnosticAssessment" set "isActive" = false, status = 'DRAFT' where id = 5; update "DiagnosticAssessment" set "isActive" = true, status = 'ACTIVE' where id = 1; commit;`);
console.log(JSON.stringify(harnessQuery(`select id, "isActive", status from "DiagnosticAssessment" where id in (1,5) order by id`)));
