<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
</p>

<h1 align="center">Breadtrans E-Learning Backend (KLTN) 🚀</h1>

<p align="center">
  Hệ thống Backend phục vụ Khóa luận tốt nghiệp: Nền tảng luyện thi TOEIC 4 Kỹ năng tích hợp Trí tuệ nhân tạo (AI). Được xây dựng dựa trên <strong>NestJS</strong>, <strong>PostgreSQL (Prisma)</strong>, <strong>Redis</strong> và sức mạnh từ <strong>Google Gemini / Azure Speech API</strong>.
</p>

---

## 🌟 Tính năng nổi bật (Core Features)

1. **TOEIC 4 Kỹ năng (Nghe, Nói, Đọc, Viết):**
   - Hỗ trợ đầy đủ các dạng bài trắc nghiệm thông thường (Listening, Reading).
   - Luyện nói (Speaking) tự động chấm điểm phát âm qua AI (Azure Speech / Gemini).
   - Luyện viết (Writing) tích hợp AI chấm lỗi ngữ pháp, chính tả tự động.

2. **🤖 AI ETS Importer (Siêu việt):**
   - Hỗ trợ **Multi-modal AI**: Khả năng tải lên cùng lúc 1 file PDF/Ảnh đề thi và 1 file Audio (.mp3).
   - Trí tuệ nhân tạo Gemini 3.5 tự động đọc tài liệu, nghe âm thanh, bóc tách toàn bộ câu hỏi (A, B, C, D) kèm **Timestamps** và lưu thẳng vào Database chỉ trong vài chục giây.

3. **☁️ Cloud Uploads:**
   - Quản lý toàn bộ tài nguyên hình ảnh, âm thanh trực tiếp trên **Cloudinary** (Tối đa 10MB/file).

4. **⚙️ Kiến trúc linh hoạt:**
   - Áp dụng **Strategy Pattern** cho phép dễ dàng chuyển đổi giữa các mô hình AI khác nhau (Gemini, ChatGPT).
   - Database Prisma Schema được thiết kế linh hoạt (lưu trữ JSON cho `content`), hỗ trợ chèn đa phương tiện vào bài thi mà không cần sửa cấu trúc cơ sở dữ liệu.

---

## 🛠️ Công nghệ sử dụng (Tech Stack)

- **Framework:** [NestJS](https://nestjs.com/) (TypeScript)
- **Cơ sở dữ liệu:** PostgreSQL
- **ORM:** [Prisma](https://www.prisma.io/)
- **Caching & Queue:** Redis
- **Containerization:** Docker & Docker Compose
- **Tích hợp AI:** Google Gemini 3.5 Flash, Azure AI Speech
- **File Storage:** Cloudinary

---

## 🚀 Hướng dẫn Cài đặt & Chạy dự án

### 1. Yêu cầu hệ thống (Prerequisites)
- [Node.js](https://nodejs.org/en/) (phiên bản >= 18.x)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (Để chạy Postgres & Redis)
- Git

### 2. Cấu hình biến môi trường (`.env`)
Tạo file `.env` ở thư mục gốc và cung cấp các khóa API cần thiết:

```env
# Database (Postgres)
DATABASE_URL="postgresql://postgres:password@localhost:5432/breadtrans?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Cổng chạy Backend
PORT=3000

# API Keys AI
GEMINI_API_KEY="your_gemini_api_key_here"
AZURE_SPEECH_KEY="your_azure_speech_key_here"
AZURE_SPEECH_REGION="eastus"

# Cloudinary
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
```

### 3. Cài đặt Dependencies & Khởi chạy

Chạy các lệnh sau trong Terminal (khuyến nghị mở 3 terminal riêng biệt):

**Terminal 1 (Khởi động Database):**
```bash
docker-compose up -d
```

**Terminal 2 (Đồng bộ CSDL & Mở giao diện DB):**
```bash
npm install
npx prisma generate
npx prisma db push
npx prisma studio
```
*(Prisma Studio sẽ chạy ở `http://localhost:5555` giúp bạn xem và chỉnh sửa data trực tiếp).*

**Terminal 3 (Chạy Server Backend):**
```bash
npm run start:dev
```
*(Backend sẽ chạy ở `http://localhost:3000`).*

---

## 📖 API Documentation (Swagger)

Hệ thống tích hợp sẵn Swagger để test API. Sau khi khởi động thành công, vui lòng truy cập:
👉 **[http://localhost:3000/api/docs](http://localhost:3000/api/docs)**



## 👨‍💻 Tác giả
- Phát triển bởi: **Khóa luận tốt nghiệp (KLTN)**
- Bản quyền thuộc về tác giả dự án.
