# Phase 3B Self-Enrollment — Implementation Audit Report

**Audit date:** 2026-09-05  
**Backend:** `develop` / `adb23e1`  
**Frontend:** `develop` / `c625aca`  
**Verdict:** **Implemented with remediation required** — chưa đủ điều kiện đánh dấu acceptance-complete.

## 1. Executive summary

Backend Phase 3B đã triển khai đúng các cơ chế cốt lõi:

- Student self-enrollment lấy identity từ JWT.
- FREE tạo `ACTIVE`; PAID tạo `PENDING_PAYMENT`.
- Capacity và sold-out dùng Enrollment `ACTIVE`.
- Tuition lock và hard-delete protection dùng ALL enrollment statuses.
- Admin override là option nội bộ, không nhận từ HTTP payload.
- PostgreSQL row lock dùng parameterized `$queryRaw` trong transaction.
- Public Course Detail chỉ trả class `UPCOMING`.
- `PENDING_PAYMENT` không cấp private learning access.
- Migration thêm `tuitionFeeVnd Int @default(0)`.

Các remediation còn bắt buộc:

1. Admin/Teacher UI vẫn còn fallback `_count.enrollments` hoặc `studentCount`, làm trộn active count và total count.
2. E2E pending-access chưa assert trực tiếp đủ video URL, material URL, assignment và submission payload.
3. Admin override test matrix thiếu explicit cases cho duplicate, UPCOMING và COMPLETED.
4. Concurrency E2E có trong source nhưng phải được chạy trên PostgreSQL test database cô lập.

## 2. Compliance matrix

| # | Requirement | Result | Evidence / gap |
|---|---|---|---|
| 1 | Separate enrollment count semantics | Partial pass | Backend đúng; management UI còn ambiguous fallbacks. |
| 2 | Explicit DTO/metadata for tuition lock | Partial pass | `activeEnrollmentCount`, `totalEnrollmentCount`, `hasEnrollments` có ở CourseService; AdminService list response chưa chuẩn hóa đầy đủ. |
| 3 | Test layer responsibilities | Partial pass | Service/controller/E2E đã phân lớp đúng; thiếu một số HTTP private-payload assertions. |
| 4 | Admin override semantics | Pass with test gaps | Option nội bộ; không bypass duplicate/capacity/completed/cancelled; paid class được tạo ACTIVE. |
| 5 | Safe row lock | Pass | Tagged `$queryRaw`, đúng transaction order, không `$queryRawUnsafe`. |
| 6 | PENDING_PAYMENT access | Pass in code, partial E2E | Class detail 403, meeting link null, lessons hidden, assignment guards đúng; coverage chưa đủ. |
| 7 | Public detail only UPCOMING | Pass | Backend query lọc UPCOMING; frontend không thêm historical-class branches. |
| 8 | Migration data effect | Pass | Existing Class nhận 0 VND; không suy diễn học phí lịch sử. |
| 9 | Locked phase boundary | Pass | Không có payment confirmation/gateway/webhook/expiry/soft-delete trong Phase 3B. |

## 3. Enrollment count semantics

### ACTIVE-only seat occupancy

`CourseService` sử dụng `EnrollmentStatus.ACTIVE` cho:

- `currentEnrollmentCount`;
- `remainingSeats`;
- `isSoldOut`;
- self-enrollment capacity check;
- minimum capacity trong `updateClass()`.

Public Course Detail chỉ select active enrollments trước khi tính chỗ còn lại.

### ALL-status historical existence

Backend không lọc status khi:

- kiểm tra tuition fee có được thay đổi hay không;
- kiểm tra hard-delete Class;
- tạo `totalEnrollmentCount`;
- tạo `hasEnrollments`.

### Remaining UI gap

`AdminService.getAdminCourses()` và `getAllClasses()` hiện chủ yếu trả `_count.enrollments` tổng mọi trạng thái. Admin UI lại fallback:

```ts
activeEnrollmentCount ?? _count.enrollments ?? 0
```

Nếu class chỉ có `PENDING_PAYMENT`, UI có thể xem total count như active count và khóa giảm capacity quá mức. Backend vẫn authoritative và xử lý BR-07 đúng.

Teacher UI có explicit metadata từ `CourseService.getUserClasses()`, nhưng tuition lock vẫn fallback sang `studentCount`. Trong contract hiện tại `studentCount` là active count nên không đủ điều kiện quyết định tuition lock.

Required remediation:

- Admin responses trả rõ `activeEnrollmentCount`, `totalEnrollmentCount`, `hasEnrollments`.
- Capacity UI chỉ dùng `activeEnrollmentCount`.
- Tuition lock chỉ dùng `hasEnrollments` hoặc `totalEnrollmentCount > 0`.
- Không dùng `studentCount` trong quyết định tuition.

## 4. Self-enrollment and ENR13

Endpoint:

```text
POST /courses/classes/:classId/enroll
```

Security behavior:

- `CourseController` có `JwtAuthGuard` và `RolesGuard`.
- Method có `@Roles(Role.STUDENT)`.
- `classId` lấy từ route; `userId` lấy từ `req.user.id`.
- Method không nhận request body.
- Production dùng `ValidationPipe({ whitelist: true, transform: true })`.

E2E source đã kiểm tra:

- Guest → 401.
- Teacher → 403.
- Admin gọi student route → 403.
- Malicious body không override `userId`, `status`, `tuitionFeeVnd`, `isAdminOverride`.
- Database record thuộc authenticated student và paid class vẫn là `PENDING_PAYMENT`.

## 5. Admin override

Flow:

```text
POST /admin/enroll
 -> AdminController (ADMIN guard)
 -> AdminService.enrollUserInClass()
 -> CourseService.enrollInClass(..., { isAdminOverride: true })
```

`isAdminOverride` không được expose qua body/query/params.

Current behavior:

- UPCOMING và ONGOING được phép.
- Tạo trực tiếp `ACTIVE`, kể cả lớp trả phí.
- Không bypass duplicate.
- Không bypass capacity.
- Không bypass COMPLETED/CANCELLED.

Đây là privileged assignment, không phải payment confirmation.

Test nên bổ sung explicit cases:

- paid/free UPCOMING override → ACTIVE;
- duplicate override → 409;
- COMPLETED override → 400.

## 6. Row lock and concurrency

Transaction order hiện tại:

```text
BEGIN
 -> SELECT Class ... FOR UPDATE
 -> validate class/status
 -> duplicate check
 -> count ACTIVE enrollments
 -> capacity validation
 -> determine enrollment status
 -> create Enrollment
COMMIT
```

Query sử dụng Prisma tagged template với `${classId}` parameter. Không có `$queryRawUnsafe` hoặc SQL string concatenation.

`test/enrollment.e2e-spec.ts` có real HTTP/database concurrency case: hai request tranh một chỗ, kỳ vọng một 200, một 409 và database có đúng một active enrollment.

Suite này không được chạy trong lượt audit vì setup tạo/xóa dữ liệu qua `DATABASE_URL`. Phải chạy trên database test cô lập trước release.

## 7. PENDING_PAYMENT access isolation

Static audit xác nhận:

- Pending được phép xuất hiện trong `/courses` và `/my-courses` dưới dạng metadata.
- `/courses/classes/:classId` chỉ chấp nhận ACTIVE/COMPLETED; pending nhận 403.
- `/courses` trả `meetingLink: null` cho pending.
- `/courses` trả `lessons: []` cho pending nên không lộ private video URL.
- Material URLs không được query trong pending list response.
- Assignment list yêu cầu ACTIVE/COMPLETED.
- Assignment submission yêu cầu ACTIVE.

E2E hiện mới assert class-detail 403 và meeting-link null. Cần bổ sung HTTP assertions cho video, material, assignment và submission.

## 8. Public Course Detail

`GET /public/courses/:id`:

- chỉ lấy Course `PUBLISHED`;
- chỉ lấy Class `UPCOMING`;
- chỉ đếm Enrollment `ACTIVE`;
- không trả meeting link, private video, material URL hoặc quizzes;
- tính remaining seats và sold-out từ active count.

Frontend chỉ render “Lịch mở lớp sắp tới”. Các nhánh ACTIVE/PENDING_PAYMENT/free/paid là enrollment state, không phải historical Class branches.

## 9. Migration data effect

Migration:

```sql
ALTER TABLE "Class"
ADD COLUMN "tuitionFeeVnd" INTEGER NOT NULL DEFAULT 0;
```

Effect:

- Mọi Class hiện hữu nhận `0 VND` sau migration.
- Không có historical tuition data để suy diễn/backfill.
- Không được tự đặt giá lịch sử giả định.

Audit verification:

- Không chạy migration hoặc seed.
- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS — standard Prisma Client v6.2.1.
- Standard client connection với PostgreSQL `DATABASE_URL`: PASS.
- Backend TypeScript: PASS.

**Không dùng `prisma generate --no-engine` cho local PostgreSQL runtime.** Tùy chọn đó sinh client cho Data Proxy/Accelerate và có thể gây `P6001` yêu cầu URL `prisma://`.

## 10. Quality gates

| Gate | Result |
|---|---|
| Backend ESLint without `--fix` | PASS |
| Course service/controller/public controller tests | PASS — 3 suites, 72 tests |
| Backend TypeScript | PASS |
| Prisma validate | PASS |
| Standard Prisma Client generation | PASS |
| Frontend targeted ESLint | PASS with 2 existing effect warnings |
| Frontend TypeScript | PASS |
| Frontend production build | PASS — 44 routes |
| Real database enrollment E2E | NOT EXECUTED — requires isolated test DB |

## 11. Acceptance decision

Phase 3B có thể xem là code-complete có điều kiện, nhưng chưa acceptance-complete cho tới khi:

1. management count semantics được chuẩn hóa;
2. PENDING_PAYMENT private-payload E2E được bổ sung;
3. concurrency E2E chạy thành công trên PostgreSQL test database cô lập.

Sau đó Phase 3B phải dừng. Mọi payment confirmation và `PENDING_PAYMENT -> ACTIVE` tiếp tục thuộc Phase 3C.
