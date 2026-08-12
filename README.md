<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
</p>

<h1 align="center">BreadTrans E-Learning Backend 🚀</h1>

<p align="center">
  Backend cho nền tảng luyện thi TOEIC 4 kỹ năng tích hợp AI — Khóa luận tốt nghiệp.<br/>
  Xây dựng với <strong>NestJS</strong>, <strong>PostgreSQL (Prisma)</strong>, <strong>Redis</strong>, <strong>Cloudflare R2</strong> và <strong>Google Gemini</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11-red?logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-15-blue?logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" alt="Docker" />
</p>

---

## 🌟 Tính năng chính

| Tính năng | Mô tả |
|-----------|-------|
| **TOEIC 4 Kỹ năng** | Nghe, Nói, Đọc, Viết — đầy đủ dạng bài theo chuẩn ETS |
| **AI Speaking Grader** | Chấm điểm phát âm tự động qua Google Gemini |
| **AI Writing Checker** | Chấm lỗi ngữ pháp, chính tả, gợi ý cải thiện bằng AI |
| **AI ETS PDF Importer** | Upload PDF đề thi + Audio → AI tự bóc tách câu hỏi vào DB |
| **Vocabulary Learning** | 4 bước học (Flashcard → Quiz → Typing → Speaking) + TTS |
| **Gamification** | Bánh rắn currency, streak, bảng xếp hạng lớp |
| **Cloudflare R2 Storage** | Lưu trữ audio, hình ảnh — không tốn phí egress |
| **Cloudflare Tunnel** | Expose local backend ra internet cho FE dev (không cần VPS) |

---

## 🛠️ Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Framework | NestJS 11 (TypeScript) |
| Database | PostgreSQL 15 via Prisma ORM |
| Cache | Redis 7 |
| File Storage | Cloudflare R2 (S3-compatible) |
| AI | Google Gemini Flash |
| Auth | JWT + Passport |
| Docs | Swagger / OpenAPI |
| Containerization | Docker + Docker Compose |
| Reverse Proxy | Caddy (production, auto HTTPS) |
| Tunnel (dev) | Cloudflare Tunnel (`cloudflared`) |

---

## 🚀 Cài đặt & Chạy Local

### Yêu cầu
- [Node.js](https://nodejs.org/) >= 20
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- Git

### 1. Clone & cài dependencies

```bash
git clone <repo-url>
cd kltn-breadtrans-backend
npm install
```

### 2. Cấu hình biến môi trường

```bash
cp .env.example .env
```

Mở file `.env` và điền các giá trị:

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/kltn_db?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your_secret_key_here

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key_here

# Cloudflare R2 Storage
R2_ACCOUNT_ID=your_account_id
R2_BUCKET_NAME=breadtrans-files
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_PUBLIC_URL=https://your-r2-public-url
```

### 3. Khởi chạy (1 lệnh)

```bash
# Windows — khởi động Docker + Backend + Cloudflare Tunnel cùng lúc
..\start-dev.ps1
```

Hoặc khởi động thủ công:

```bash
# Terminal 1: Database
docker-compose up -d

# Terminal 2: Backend
npx prisma generate
npx prisma migrate dev
npm run start:dev

# Terminal 3: Expose ra internet (cho FE dev)
cloudflared tunnel --url http://localhost:3000
```

### 4. Đồng bộ & xem Database

```bash
# Tạo/cập nhật bảng theo schema
npx prisma migrate dev --name init

# Mở Prisma Studio (giao diện quản lý DB)
npx prisma studio
# → Truy cập: http://localhost:5555
```

---

## 📖 API Documentation

Sau khi backend chạy, truy cập Swagger UI:

👉 **Local:** [http://localhost:3001/api/docs](http://localhost:3001/api/docs)  
👉 **Production:** [https://breadtrans.edu.vn/api/docs](https://breadtrans.edu.vn/api/docs)

---

## 🌐 Expose Local Backend (Development)

Dùng **Cloudflare Tunnel** để FE developer (khác mạng) có thể gọi vào backend đang chạy trên máy bạn:

```powershell
# Cài cloudflared (1 lần)
winget install --id Cloudflare.cloudflared

# Chạy tunnel (mở terminal mới sau khi cài)
cloudflared tunnel --url http://localhost:3001

# URL dạng https://xxxx.trycloudflare.com sẽ hiện sau ~5 giây
# Gửi URL đó cho FE dev để dùng làm VITE_API_URL / NEXT_PUBLIC_API_URL
```

> CORS đã được cấu hình tự động: `NODE_ENV=development` → mở toàn bộ origin, không cần config thêm.

---

## 🧪 Testing

```bash
# Unit tests
npm run test

# Unit tests (watch mode)
npm run test:watch

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e
```

---

## 🐳 Production Deployment

Xem file [`docker-compose.production.yml`](./docker-compose.production.yml) và [`COMMANDS.md`](../COMMANDS.md) (mục 7) để biết chi tiết deploy lên Oracle Cloud Free Tier với Caddy HTTPS tự động.

```bash
# Deploy stack production (chạy trên VPS)
docker compose -f docker-compose.production.yml up -d --build
```

---

## 👨‍💻 Tác giả

Phát triển bởi nhóm sinh viên KLTN — Khoa Công nghệ Thông tin.
