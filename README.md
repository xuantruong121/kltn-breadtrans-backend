# BreadTrans Backend 🍞

[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL 15](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma 6](https://img.shields.io/badge/Prisma-6-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Redis 7](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

**BreadTrans Backend** là API của BreadTrans, nền tảng tự học tiếng Anh. Học viên luyện Nghe, Nói, Đọc,
Viết, từ vựng và ngữ pháp, làm đề mô phỏng cấu trúc TOEIC, được AI chấm bài Viết và chấm phát âm bài Nói,
và giữ động lực học qua XP, Bánh Mì, bảng xếp hạng và thú ảo.

---

## 🏗️ Kiến trúc kỹ thuật

Dự án theo kiến trúc **modular monolith** trên NestJS 11. Có 30 module tính năng trong `src/modules/`,
mỗi module gồm controller, service, DTO và spec.

- **PostgreSQL + Prisma:** dữ liệu chính, gồm người dùng, nội dung học, bài làm, gói thành viên, sổ
  Bánh Mì và tiến độ.
- **Redis + BullMQ:** cache, hàng đợi chấm bài Nói và ghép trận đấu trường.
- **Socket.io:** đấu trường 1v1 và sự kiện thời gian thực.
- **Cloudflare R2:** ảnh, audio và PDF. Bản sao lưu CSDL nằm ở một bucket riêng, không công khai.
- **Worker chấm bài Nói:** chạy ở tiến trình riêng (`src/worker/`), nên việc chấm không làm chậm API.
- **Logic thuần:** phần tính điểm, xếp hạng và ánh xạ nội dung nằm trong các file `*.logic.ts`, không
  gọi CSDL, nên kiểm thử được mà không cần CSDL.

---

## ✨ Tính năng chính

### 🎧 Luyện bốn kỹ năng
- **Nghe:** audio theo từng câu, transcript, chép chính tả và giải thích đáp án.
- **Đọc:** bài đọc song ngữ theo mức, phân tích theo kỹ năng con.
- **Viết:** viết câu theo tranh, viết email, dịch câu; Google Gemini chấm và nhận xét.
- **Nói:** Azure AI Speech chấm phát âm ở mức âm vị, độ trôi chảy, độ chính xác và ngữ điệu.

### 🧭 Đánh giá đầu vào và lộ trình
- Bài đánh giá đầu vào xếp học viên vào một trong bốn mức luyện tập: Mất gốc, Cơ bản, Trung cấp, Nâng cao.
- Lộ trình mở mức theo từng kỹ năng, kế hoạch tuần theo mục tiêu và gợi ý bài luyện mỗi ngày.
- Kết quả học tập theo kỳ: thời gian học, số câu, số từ đã thuộc và XP.

### 📝 Luyện đề mô phỏng TOEIC
- Đề Listening & Reading và Speaking & Writing theo cấu trúc TOEIC; luyện riêng từng Part với đề L&R.
- AI soạn nháp đề, hai nhà cung cấp AI giải thử để kiểm định đáp án; nhập đề từ file PDF.
- Đề do BreadTrans tự soạn; điểm là chỉ số luyện tập nội bộ
  ([docs/toeic-product-contract.md](docs/toeic-product-contract.md)).

### 📚 Từ vựng và ngữ pháp
- Bộ từ theo lĩnh vực, flashcard, ôn từ đến hạn, kho từ điển.
- Ngữ pháp theo chủ đề và mức; sổ lỗi sai để ôn lại câu đã làm sai.

### 🎮 Trò chơi hoá
- XP, Bánh Mì, chuỗi ngày học và khiên giữ chuỗi, nhiệm vụ ngày.
- Bảng xếp hạng theo hạng tuần (Đồng, Bạc, Vàng, Bạch Kim, Kim Cương).
- Thú ảo, cửa hàng đổi quà, đấu trường 1v1 và hai trò chơi từ vựng chơi một mình.

### 💳 Gói thành viên
- Gói Free, Plus và Pro, dùng thử Plus, mã giảm giá, thanh toán qua PayOS, giới thiệu bạn bè.

### 🔔 Thông báo và hỗ trợ
- Chuông thông báo trên web, Web Push (VAPID) và email qua SMTP.
- Trợ lý AI trả lời học viên; học viên chuyển được sang nhắn tin trực tiếp với quản trị viên.

### 🛡️ Quản trị
- Trang tổng quan vận hành, CMS cho nội dung từng kỹ năng và đề thi, quản lý người dùng, thanh toán, cửa
  hàng, báo lỗi, góp ý, tin nhắn hỗ trợ, chi phí và hiệu năng.

### 🔐 Bảo mật
- JWT hai token: access token 1 giờ, refresh token 7 ngày, xoay vòng theo thiết bị; đăng nhập Google.
- Phân quyền theo vai trò `STUDENT` và `ADMIN`, giới hạn tần suất gọi AI, mật khẩu băm bằng bcrypt, OTP.
- Sao lưu CSDL hằng ngày bằng `pg_dump`, có bản sao trên R2 và diễn tập khôi phục.

---

## 🛠️ Công nghệ

| Lớp | Công nghệ |
| :--- | :--- |
| **Ngôn ngữ** | TypeScript 5, Node.js 22 |
| **Backend** | NestJS 11, Passport-JWT, class-validator, Swagger |
| **CSDL** | PostgreSQL 15, Prisma 6 |
| **Cache và hàng đợi** | Redis 7, BullMQ |
| **Thời gian thực** | Socket.io |
| **Lưu trữ** | Cloudflare R2 (S3) |
| **AI** | Google Gemini, Azure AI Speech, Cloudflare Workers AI |
| **Thanh toán và thông báo** | PayOS, Web Push, SMTP |
| **DevOps** | Docker, Docker Compose, Caddy, GitHub Actions |

---

## 🚀 Chạy ở máy

### Yêu cầu
- Node.js 22
- Docker Desktop

### Cài đặt

```bash
# 1. Cài thư viện
npm install

# 2. Tạo file môi trường từ mẫu, rồi điền giá trị
cp .env.example .env

# 3. Bật PostgreSQL, PostgreSQL shadow, sao lưu và Redis
docker-compose up -d

# 4. Sinh Prisma Client, áp migration, nạp dữ liệu mẫu
npx prisma generate
npm run db:migrate:deploy
npm run db:seed:safe

# 5. Chạy API (chế độ watch) và worker chấm bài Nói khi cần
npm run dev:backend
```

### Điểm truy cập
- **API:** http://localhost:3001
- **Swagger:** http://localhost:3001/api/docs

### Lệnh CSDL
Lệnh migrate luôn dùng bản có bước kiểm tra (`scripts/db-safety-guard.ts`), vì Prisma xoá và dựng lại CSDL
shadow mỗi lần chạy:

```bash
npm run db:migrate:dev:safe      # tạo migration mới
npm run db:migrate:deploy        # áp migration
npm run db:backup                # sao lưu ngay
npm run db:restore:verify        # khôi phục thử vào container riêng
```

Chi tiết: [docs/database-safety.md](docs/database-safety.md),
[docs/backup-and-media-architecture.md](docs/backup-and-media-architecture.md).

---

## 🧪 Kiểm thử

```bash
# Lint, typecheck, build và toàn bộ Jest
npm run ci:check

# Một module hoặc một test
npx jest src/modules/diagnostic
npx jest -t "grading stays correct"

# Kiểm thử end-to-end
npm run test:e2e
```

- **Unit test:** file `*.spec.ts` đặt cạnh mã nguồn, phần lớn kiểm các file logic thuần.
- **Test cần CSDL:** chạy khi có `TEST_DATABASE_URL` và `TEST_REDIS_URL` trỏ vào một CSDL test riêng.
- **E2E:** gọi API qua HTTP cho đăng ký, đăng nhập và mua gói (`test/`).

---

## 📂 Cấu trúc dự án

```bash
src/
├── main.ts          # Swagger, ValidationPipe, CORS, bọc phản hồi { statusCode, message, data }
├── app.module.ts    # Đăng ký các module
├── common/          # Guard, decorator, interceptor, filter, email, cấu hình
├── modules/         # 30 module tính năng (auth, diagnostic, toeic, speaking, gamification…)
├── jobs/            # Việc định kỳ: đồng bộ bản sao lưu lên R2, bảo trì
├── worker/          # Worker chấm bài Nói
└── prisma/          # PrismaService
prisma/
├── schema.prisma    # Lược đồ CSDL
├── migrations/      # Lịch sử migration
├── seed.ts          # Dữ liệu mẫu
└── data/            # Bộ nội dung mẫu và danh sách media trên R2
scripts/             # Kiểm tra CSDL, sao lưu, kiểm toán dữ liệu
test/                # E2E
docs/                # An toàn CSDL, sao lưu, hợp đồng TOEIC, CI/CD
```

---

## 🚢 CI/CD và triển khai

- **GitHub Actions** (`.github/workflows/ci.yml`) chạy khi push lên `develop` hoặc `main`, khi mở Pull
  Request vào `main`, hoặc khi bấm chạy tay ở tab Actions: dựng PostgreSQL và Redis riêng,
  `prisma migrate deploy`, lint, typecheck, build, Jest và e2e.
- **Triển khai** bằng `docker-compose.production.yml`: `postgres`, `redis`, `api`, `speaking-worker` và
  `caddy` (HTTPS tự động). Biến môi trường theo mẫu `.env.production.example`; container `api` tự áp
  migration khi khởi động.

```bash
docker compose -f docker-compose.production.yml up -d --build
```

---

## 📝 Giấy phép

Dự án khóa luận tốt nghiệp ngành Kỹ thuật Phần mềm tại IUH, dùng cho mục đích học tập.

---

*Thực hiện bởi nhóm BreadTrans.*
