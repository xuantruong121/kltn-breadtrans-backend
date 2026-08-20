<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
</p>

<h1 align="center">BreadTrans E-Learning Backend 🚀</h1>

<p align="center">
  Hệ thống Backend cho nền tảng học và luyện thi TOEIC 4 kỹ năng tích hợp AI — Khóa luận tốt nghiệp.<br/>
  Xây dựng với <strong>NestJS 11</strong>, <strong>PostgreSQL (Prisma ORM)</strong>, <strong>Redis</strong>, <strong>Cloudflare R2</strong>, <strong>Azure AI Speech (F0)</strong>, <strong>Google Gemini</strong> và <strong>Daily.co</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11-red?logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-15-blue?logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Redis-7-red?logo=redis" alt="Redis" />
  <img src="https://img.shields.io/badge/Cloudflare_R2-Storage-F38020?logo=cloudflare" alt="Cloudflare R2" />
  <img src="https://img.shields.io/badge/Azure_Speech-F0_Free-0089D6?logo=microsoftazure" alt="Azure AI Speech" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker" />
</p>

---

## 🌟 Tính Năng Chính

| Phân hệ / Tính năng | Chi tiết & Công nghệ sử dụng |
|---|---|
| **TOEIC 4 Kỹ Năng (ETS)** | Nghe, Nói, Đọc, Viết — đầy đủ các phần Part 1-7 và Part 1-3 Writing theo chuẩn ETS mới nhất. |
| **Azure AI Speech Grader** | Chấm điểm phát âm chuẩn mức **Âm vị (Phoneme-level)**, độ lưu loát (Fluency), độ chính xác (Accuracy), ngữ điệu (Prosody) qua Azure AI Speech SDK/REST (Gói F0 Free). |
| **AI Writing Tutor (Gemini)** | Chấm bài luận, phân tích lỗi ngữ pháp, gợi ý cấu trúc câu và từ vựng nâng cao tự động. |
| **AI ETS PDF Importer** | Tự động đọc file đề thi PDF + file âm thanh Audio, trích xuất cấu trúc câu hỏi đưa vào CSDL. |
| **Đấu Trường 1v1 (Arena)** | Matchmaking ngẫu nhiên qua Redis Queue, thi đấu đối kháng thời gian thực qua WebSocket (Socket.io). |
| **Phòng Học Trực Tuyến (Daily.co)** | Tự động sinh link và quản lý phòng học video nhúng trực tiếp vào Web (10.000 phút/tháng miễn phí). |
| **Vocabulary & Flashcard** | 4 bước học toàn diện (Flashcard 3D → Quiz → Typing → Speaking) tích hợp Text-To-Speech Neural. |
| **Hệ Thống Gamification** | Tích lũy Bánh Mì, chuỗi Streak, Cửa hàng vật phẩm, Thú cưng (Pet) và Bảng xếp hạng học tập. |
| **Lưu Trữ Đám Mây Cloudflare R2** | Lưu trữ vĩnh viễn Avatar, Audio luyện nói, file bài giảng PDF với chi phí băng thông egress 0đ. |
| **Admin & Teacher CMS** | Thống kê số liệu trực quan, quản lý lớp học, phân công giáo viên, duyệt học viên và quản lý ngân hàng câu hỏi. |

---

## 🛠️ Kiến Trúc Công Nghệ (Tech Stack)

- **Ngôn ngữ & Nền tảng:** Node.js (v20+), TypeScript 5.7
- **Core Framework:** NestJS 11 (Modular Architecture, Dependency Injection, Strategy Pattern)
- **Cơ sở dữ liệu & ORM:** PostgreSQL 15, Prisma ORM 6
- **Bộ nhớ đệm & Realtime Queue:** Redis 7 (`ioredis`)
- **Realtime Gateway:** `@nestjs/websockets`, `socket.io`
- **Xác thực & Phân quyền:** Passport-JWT, Bcrypt, Role Guard (`STUDENT`, `TEACHER`, `ADMIN`)
- **Lưu trữ đám mây:** Cloudflare R2 (`@aws-sdk/client-s3`)
- **Trí tuệ nhân tạo (AI):** 
  - Azure AI Speech (Pronunciation Assessment)
  - Google Gemini Flash (`@google/generative-ai`)
- **Tài liệu API:** Swagger / OpenAPI 3.0
- **Ghi log hệ thống:** Winston Logger (`nest-winston`)
- **Tự động hóa CI/CD:** GitHub Actions (Lint, Typecheck, Test, Prisma DB Push)

---

## 🚀 Cài Đặt & Chạy Môi Trường Phát Triển

### Yêu cầu tiên quyết
- [Node.js](https://nodejs.org/) >= 20.x
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (cho PostgreSQL & Redis)
- Git

### 1. Clone Source Code & Cài Dependencies

```bash
git clone <repo-url>
cd kltn-breadtrans-backend
npm install
```

### 2. Cấu Hình Biến Môi Trường (`.env`)

Sao chép file `.env.example` thành `.env`:

```bash
cp .env.example .env
```

Cập nhật các thông số cần thiết trong `.env`:

```env
# 1. Database & Cache
DATABASE_URL="postgresql://postgres:password@localhost:5432/kltn_db?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379

# 2. Authentication
JWT_SECRET="your_jwt_super_secret_key"

# 3. Google Gemini AI
GEMINI_API_KEY="your_gemini_api_key"

# 4. Cloudflare R2 Storage (Lưu trữ ảnh, audio, bài giảng)
R2_ACCOUNT_ID="your_cloudflare_account_id"
R2_ACCESS_KEY_ID="your_r2_access_key_id"
R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
R2_BUCKET_NAME="breadtrans-files"
R2_PUBLIC_URL="https://pub-your_id.r2.dev"

# 5. Azure AI Speech (Chấm phát âm F0)
AZURE_SPEECH_KEY="your_azure_speech_f0_key"
AZURE_SPEECH_REGION="southeastasia"

# 6. Daily.co (Phòng học trực tuyến video nhúng)
DAILY_DOMAIN="breadtrans-kltn.daily.co"
DAILY_API_KEY="your_daily_api_key"
```

### 3. Khởi Chạy Cơ Sở Dữ Liệu & Backend

```bash
# Bước 1: Khởi động container PostgreSQL và Redis qua Docker Compose
docker-compose up -d

# Bước 2: Sinh mã Prisma Client và đồng bộ DB Schema
npx prisma generate
npx prisma db push

# Bước 3: Nạp dữ liệu mẫu ban đầu (Seed data: Tài khoản, Từ vựng, Ngữ pháp)
npx ts-node prisma/seed.ts
npx ts-node prisma/seed-grammar.ts

# Bước 4: Chạy server ở chế độ Development (Watch Mode)
npm run start:dev
```

Server sẽ khởi chạy tại: **http://localhost:3001**

---

## 📖 Tài Liệu API (Swagger UI)

Khi Backend đang chạy, bạn có thể xem và thực thi trực tiếp toàn bộ REST API tại:

👉 **Swagger UI:** [http://localhost:3001/api/docs](http://localhost:3001/api/docs)

---

## 🧪 Kiểm Thử (Testing & Linting)

```bash
# Kiểm tra quy chuẩn mã nguồn (ESLint)
npm run lint

# Chạy Unit Tests
npm run test

# Chạy Unit Tests ở chế độ Watch
npm run test:watch

# Báo cáo độ phủ kiểm thử (Test Coverage)
npm run test:cov

# Kiểm thử E2E (End-to-End)
npm run test:e2e
```

---

## 🐳 Triển Khai Production (Deployment)

Dự án hỗ trợ triển khai bằng Docker Compose kèm Caddy Web Server (tự động cấu hình SSL/HTTPS miễn phí):

```bash
# Build & Khởi chạy cụm production container
docker compose -f docker-compose.production.yml up -d --build
```

---

## 👨‍💻 Tác Giả & Bản Quyền

Đồ án Khóa Luận Tốt Nghiệp — Nền tảng Giáo dục Trực tuyến BreadTrans E-Learning.  
Phát triển bởi nhóm sinh viên Khoa Công nghệ Thông tin.
