# 📖 Backend Development Guide - Breadtrans

## 🏗️ Cấu trúc thư mục (Modular Monolith)
Dự án được xây dựng trên **NestJS** và chia theo domain:

```
src/
├── common/        # Decorators, Filters, Guards, Interceptors dùng chung
├── modules/       # Các logic nghiệp vụ chính
│   ├── auth/      # Xử lý Đăng ký, Đăng nhập, JWT
│   ├── user/      # Xử lý Profile
│   ├── course/    # Quản lý Khóa học, Buổi học, Tài liệu
│   ├── quiz/      # Quản lý Bài kiểm tra, nộp bài, chấm điểm
│   ├── ai/        # Tích hợp Google Gemini AI
│   └── gamification/ # Điểm thưởng, Huy hiệu, Bảng xếp hạng
├── prisma/        # Kết nối CSDL và Seed data
└── app.module.ts  # Module gốc liên kết toàn bộ
```

## 🔧 Quy định Code
1. **Controllers**: Chỉ xử lý HTTP Request/Response, Guards và Swagger Docs. Không viết logic nghiệp vụ phức tạp ở đây.
2. **Services**: Chứa toàn bộ business logic.
3. **Data Access**: Gọi CSDL thông qua `PrismaService`.
4. **Bảo mật**: Dùng `@UseGuards(JwtAuthGuard, RolesGuard)` để phân quyền API. Nhớ thêm `@ApiBearerAuth()` cho Swagger.

## 🚀 Lệnh quan trọng
- `npm run start:dev`: Chạy server dev (Watch mode).
- `npm run lint`: Kiểm tra lỗi code.
- `npx prisma studio`: Mở giao diện web quản lý Database.
