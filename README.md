# BreadTrans Backend

API của BreadTrans, nền tảng tự học tiếng Anh (khóa luận tốt nghiệp). Học viên luyện Nghe, Nói, Đọc,
Viết, từ vựng, ngữ pháp và làm đề mô phỏng cấu trúc TOEIC; có bài đánh giá đầu vào, gói Free/Plus/Pro,
Bánh Mì, thú ảo, bảng xếp hạng theo hạng và đấu trường 1v1.

- Hai vai trò: học viên (`STUDENT`) và quản trị viên (`ADMIN`).
- Không có khóa học, giáo viên, lớp học hay học phí. Phần này được gỡ ngày 01/11/2026. Cách khôi phục
  nằm ở [docs/courses-restore.md](docs/courses-restore.md).
- Đề thi do BreadTrans tự soạn theo cấu trúc TOEIC. BreadTrans không phải ETS, không cấp chứng chỉ, và
  điểm chỉ là chỉ số luyện tập nội bộ ([docs/toeic-product-contract.md](docs/toeic-product-contract.md)).

## Công nghệ

| Thành phần | Dùng cho |
|---|---|
| Node.js 22, TypeScript, NestJS 11 | API dạng modular monolith |
| PostgreSQL 15, Prisma 6 | Dữ liệu chính (`prisma/schema.prisma`, migration trong `prisma/migrations`) |
| Redis 7, BullMQ | Cache, hàng đợi chấm bài Nói, ghép trận đấu trường |
| Socket.io | Đấu trường 1v1 và sự kiện thời gian thực |
| Cloudflare R2 | Ảnh, audio, PDF; một bucket riêng, không công khai, cho bản sao lưu CSDL |
| Azure AI Speech | Chấm phát âm |
| Google Gemini | Chấm bài Viết, soạn nháp đề, nhập đề từ PDF |
| Cloudflare Workers AI, API chuẩn OpenAI (Groq) | Giải thử để kiểm định đáp án đề do AI soạn (tùy chọn) |
| Web Push (VAPID), SMTP | Thông báo trên trình duyệt và email |
| PayOS | Thanh toán gói Plus/Pro |
| Passport-JWT, Google Identity Services | Đăng nhập: access token 1 giờ, refresh token 7 ngày |

## Chạy ở máy

Cần Node.js 22, Docker Desktop và Git.

```bash
npm install
cp .env.example .env          # rồi điền giá trị; không commit .env
docker-compose up -d          # Postgres, shadow, backup, drill, Redis
npx prisma generate
npm run db:migrate:deploy     # áp các migration
npm run db:seed:safe          # chỉ cho CSDL mới, còn trống
npm run dev:backend           # API ở http://localhost:3001
```

`npm run dev:backend` chạy API ở chế độ watch, và chỉ bật worker bài Nói khi
`SPEAKING_PIPELINE_MODE=bullmq`. Có thể chạy riêng từng phần:

```bash
npm run start:dev                   # chỉ API, chế độ watch
npm run start:speaking-worker:dev   # worker bài Nói, tiến trình riêng
```

Worker là một tiến trình riêng. Sửa phần chấm bài Nói thì phải khởi động lại worker, không chỉ API.

Swagger: http://localhost:3001/api/docs

### Các container trong `docker-compose.yml`

| Container | CSDL | Cổng | Vai trò |
|---|---|---|---|
| `kltn-postgres` | `kltn_db` | 5432 | Dữ liệu phát triển thật |
| `kltn-postgres-shadow` | `kltn_shadow` | 5433 | Shadow cho Prisma, bị xóa và dựng lại mỗi lần chạy |
| `kltn-postgres-backup` | – | – | Sao lưu định kỳ bằng `pg_dump -Fc` |
| `kltn-postgres-drill` | – | – | Máy chủ dùng một lần cho diễn tập khôi phục, dữ liệu trên tmpfs |
| `kltn-redis` | – | 6379 | Redis |

### Biến môi trường

Mẫu đầy đủ, có chú thích từng biến, nằm trong `.env.example`. Các nhóm chính:

- CSDL và Redis: `DATABASE_URL`, `SHADOW_DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`
- Đăng nhập: `JWT_SECRET`, `OTP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- AI: `GEMINI_API_KEYS`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- Lưu trữ: `R2_*` (media), `R2_BACKUP_*` (bản sao lưu CSDL)
- Thông báo: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SMTP_*`
- Thanh toán: `PAYOS_*`
- Khác: `FRONTEND_URL`, `CRON_INTERNAL_ENABLED`, `SPEAKING_PIPELINE_MODE`

Có hai mẫu khác: `.env.production.example` cho máy chủ, `.env.test.example` cho môi trường kiểm thử.

## An toàn CSDL: đọc trước khi chạy lệnh Prisma

Ngày 23/10/2026 toàn bộ dữ liệu phát triển bị mất. Nguyên nhân là `DATABASE_URL` được truyền vào
`--shadow-database-url`, trong khi Prisma coi shadow là CSDL dùng một lần: nó xóa đi và dựng lại.
Chi tiết: [docs/database-safety.md](docs/database-safety.md).

```
KHÔNG BAO GIỜ đặt --shadow-database-url bằng DATABASE_URL.
KHÔNG BAO GIỜ trỏ CSDL shadow hay CSDL dùng một lần vào kltn_db.
Có bản sao lưu KHÔNG có nghĩa là được phép liều với CSDL.
```

`schema.prisma` đọc `SHADOW_DATABASE_URL` từ môi trường, nên không cần truyền cờ shadow. Dùng các
lệnh có bước kiểm tra (`scripts/db-safety-guard.ts`) chạy trước:

```bash
npm run db:safety-check          # chỉ chạy bước kiểm tra
npm run db:migrate:dev:safe      # kiểm tra rồi prisma migrate dev
npm run db:migrate:diff:safe
npm run db:migrate:reset:safe
npm run db:migrate:deploy        # không dùng shadow, an toàn với dữ liệu thật
npm run db:seed:safe
```

Sao lưu và khôi phục ([docs/backup-and-media-architecture.md](docs/backup-and-media-architecture.md)):

```bash
npm run db:backup                # pg_dump ngay, trước mọi thao tác ghi vào kltn_db
npm run db:backup:offsite        # đẩy bản sao lưu lên bucket R2 riêng
npm run db:restore:verify        # khôi phục thử vào container riêng và đối chiếu
npm run db:restore:drill:r2      # diễn tập khôi phục từ bản trên R2
```

## Kiểm thử

```bash
npm run ci:check     # lint:check, typecheck, build, toàn bộ Jest
npm run lint:check
npm run typecheck
npx jest src/modules/diagnostic                  # một thư mục
npx jest -t "grading stays correct"              # theo tên test
npm run test:e2e
```

Spec nằm cạnh mã nguồn (`*.spec.ts`). Khi không có `TEST_DATABASE_URL` và `TEST_REDIS_URL`, Jest bỏ
qua các spec cần CSDL hoặc Redis. Muốn chạy đủ như CI thì đặt `TEST_DATABASE_URL`, `TEST_REDIS_URL`
(và `DATABASE_URL`, `REDIS_URL` cùng giá trị) trỏ vào một CSDL test dùng một lần, rồi chạy
`npx prisma migrate deploy` cho CSDL đó trước. Không bao giờ trỏ chúng vào `kltn_db`.

GitHub Actions (`.github/workflows/ci.yml`) chạy `prisma generate`, `prisma validate`,
`prisma migrate deploy` trên Postgres riêng của CI, rồi `lint:check`, `typecheck`, `build`, Jest và
e2e.

## Cấu trúc thư mục

```
src/
├── main.ts            # Swagger, ValidationPipe, CORS, bọc phản hồi
├── app.module.ts      # đăng ký các module
├── common/            # guard, decorator, interceptor, filter, email, cấu hình
├── modules/           # mỗi tính năng một thư mục: controller, service, module, dto/, spec
├── jobs/              # việc chạy định kỳ trong tiến trình API (đồng bộ sao lưu lên R2, bảo trì)
├── worker/            # worker chấm bài Nói, tiến trình riêng
└── prisma/            # PrismaService
prisma/
├── schema.prisma
├── migrations/
├── seed.ts            # dữ liệu mẫu, kèm seed-data/, seed-assets/, data/
scripts/               # kiểm tra an toàn CSDL, sao lưu, kiểm toán, backfill (xem package.json)
test/                  # e2e
docs/                  # an toàn CSDL, sao lưu, hợp đồng TOEIC, CI/CD, khôi phục khóa học
load-tests/            # kịch bản đo tải
artifacts/             # bằng chứng kiểm thử và audio nguồn của đề Nghe
docker/                # cấu hình container sao lưu và MinIO cục bộ
```

Module chính trong `src/modules/`: `auth`, `user`, `account`, `diagnostic`, `learning-path`,
`learning-track`, `quiz`, `reading`, `writing`, `speaking`, `vocab`, `grammar`, `toeic`, `content`,
`gamification`, `market`, `dungeon`, `word-blaster`, `events`, `notifications`, `mistakes`,
`subscription`, `payment`, `support`, `suggestion`, `issue-report`, `upload`, `location`, `ai`,
`admin`.

Logic thuần, không có Prisma và không I/O (ví dụ `diagnostic.logic.ts`, `ranking.logic.ts`), được
tách ra file riêng để kiểm thử mà không cần CSDL.

## Quy ước

- Mọi phản hồi được `TransformInterceptor` bọc thành `{ statusCode, message, data }`. Endpoint tải
  file hoặc webhook dùng `@SkipResponseTransform()` để bỏ lớp bọc.
- `ValidationPipe` chạy với `whitelist: true`. Trường không có decorator trong DTO bị bỏ đi mà không
  báo lỗi.
- Mỗi endpoint có Swagger (`@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`).
- CORS mở hoàn toàn khi `NODE_ENV` khác `production`. Ở production chỉ nhận các origin trong
  `CORS_ORIGIN`, phân tách bằng dấu phẩy.
- Commit theo Conventional Commits (`feat(auth): …`). Nhánh `feature/*`, `bugfix/*`, `hotfix/*` tách
  từ `develop`.

## Triển khai

`docker-compose.production.yml` chạy `postgres`, `redis`, `api`, `speaking-worker` và `caddy`. Caddy
cấp HTTPS tự động; tên miền đặt trong `Caddyfile`. Biến môi trường lấy từ mẫu
`.env.production.example`. Khi khởi động, container `api` chạy `scripts/entrypoint.sh`, áp migration
trước khi mở API.

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Hướng dẫn CI/CD: [docs/CI_CD_SETUP.md](docs/CI_CD_SETUP.md).
