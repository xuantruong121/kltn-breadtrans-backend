# Backend Progress & Architecture (KLTN BreadTrans)

Tài liệu này ghi chép lại tiến độ, kiến trúc và các tính năng đã được xây dựng ở Backend (NestJS) để các Session AI sau nắm bắt nhanh cấu trúc hệ thống và luồng dữ liệu hiện hành.

## 1. Tech Stack & Architecture
- **Framework:** NestJS 11
- **Database:** PostgreSQL (với Prisma ORM)
- **Kiến trúc (Architecture):** Module-based. Mỗi tính năng được đặt trong thư mục `src/modules/<tên-module>/`.
- **Luồng xử lý:** `Controller` -> `Service` -> `Prisma`.
- **Xác thực (Authentication):** JWT & Passport (Access Token + Refresh Token). Vai trò (Role) được định nghĩa bằng enum `Role` trong Prisma.

## 2. Các Module Đã Hoàn Thành (Tính đến hiện tại)

### A. Hệ thống Người dùng (User & Profile)
- Đã cấu hình xác thực `auth.module` với chiến lược JWT.
- Khi tạo User mới, hệ thống tự động tạo một bảng liên kết `Profile` chứa (fullName, avatar, phone, address, targetScore).
- Đã phát triển `user.module` hỗ trợ API `GET /users/profile` và `PATCH /users/profile` để cập nhật dữ liệu.
- Chức năng đăng nhập `auth.service` đã được nâng cấp để trả về đối tượng `profile` trong response login nhằm tăng tốc độ tải Frontend.

### B. Hệ thống Khóa học (Courses & Classes)
Thay vì sử dụng Class làm khối trung tâm như cũ, hệ thống đã chuyển dịch sang kiến trúc **Hybrid Course Model**:
- **Khóa học (Course):** Cấu trúc cha, chứa thông tin tổng quan, giá tiền, ảnh bìa (`thumbnail`), do Giáo viên (`teacherId`) tạo ra. 
  - Khóa học có các trạng thái: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `REJECTED`. 
  - Admin sử dụng API `POST /courses/:id/status` để duyệt khóa học.
  - Hỗ trợ xóa Khóa học (`DELETE /courses/:id`).
- **Lớp học (Class/Session):** Được lồng vào bên trong Khóa học. Khi Giáo viên dạy qua Google Meet, họ không tạo một lớp đơn lẻ mà tạo các **Buổi học (Session)** bên trong Khóa học. Mỗi Session có link Meet và khoảng thời gian riêng biệt.
  - (Đã khắc phục lỗi xung đột Route: `@Get('classes')` phải đặt trước `@Get(':id')` trong `course.controller.ts`).

### C. Đảo Luyện Tập & TOEIC
- Các module đã thiết lập: `toeic`, `vocab`, `reading`, `speaking`, `writing`.
- Sẵn sàng mở rộng chấm điểm bằng AI (Gemini).

## 3. Quy Ước Kiến Trúc (Architecture Rules)
- Mọi thay đổi về Database bắt buộc phải cập nhật vào `prisma/schema.prisma` và sau đó chạy `npx prisma db push` hoặc tạo migration. Không sửa DB bằng tay.
- Mọi hàm trong `Controller` đều phải khai báo Swagger (`@ApiOperation`, `@ApiTags`, `@ApiBearerAuth`) để phục vụ Frontend Developer.
- Phân quyền phải bọc API qua `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles(...)` để tránh truy cập trái phép.

## 4. Work in Progress / Next Steps
- Tích hợp thêm các luồng xử lý AI (Gemini) cho việc chấm điểm Speaking/Writing.
- Xây dựng hệ thống Import Đề thi TOEIC từ PDF.
