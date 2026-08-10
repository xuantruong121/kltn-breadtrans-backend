# Tài Liệu Đặc Tả Yêu Cầu Kỹ Thuật (System Requirements Specification - SRS)
# Dự án: KLTN Breadtrans (E-Learning)

## 1. MỤC TIÊU DỰ ÁN VÀ PHẠM VI
**Mục tiêu:** Xây dựng một hệ thống E-Learning toàn diện, kết hợp Trí tuệ nhân tạo (AI - Google Gemini) để hỗ trợ cá nhân hóa lộ trình học, tự động chấm điểm bài tự luận (Writing) và ứng dụng Gamification (Điểm, Huy hiệu) nhằm tăng động lực học tập.
**Phạm vi:** Hệ thống tập trung vào việc giảng dạy ngoại ngữ (IELTS, TOEIC), cung cấp môi trường tương tác giữa Học viên và Giáo viên.

## 2. YÊU CẦU CHỨC NĂNG (Functional Requirements)

### 2.1. Đối với Học viên (Student)
- **Quản lý tài khoản:** Đăng ký, đăng nhập, xem và cập nhật hồ sơ cá nhân.
- **Học tập:** Đăng ký tham gia khóa học/lớp học. Xem video bài giảng và tải tài liệu đính kèm.
- **Làm bài kiểm tra (Quiz):** Làm bài trắc nghiệm, điền khuyết và nộp bài Writing.
- **Tương tác AI:** Nhận feedback tự động từ AI sau khi nộp bài Writing. Trò chuyện với Chatbot AI để giải đáp thắc mắc.
- **Gamification:** Xem điểm tích lũy, huy hiệu đạt được và xem bảng xếp hạng (Leaderboard) của lớp/trường.

### 2.2. Đối với Giáo viên (Teacher)
- **Quản lý khóa học/lớp học:** Tạo mới khóa học, mở lớp, gán link học trực tuyến (Meet/Zoom).
- **Quản lý tài liệu:** Tải giáo trình (PDF/Video) lên hệ thống.
- **Quản lý bài tập:** Tạo ngân hàng câu hỏi đa dạng (Trắc nghiệm, Tự luận), set thời gian làm bài.
- **Theo dõi học viên:** Xem tiến độ và kết quả làm bài của học viên trong lớp mình quản lý.

### 2.3. Đối với Quản trị viên (Admin)
- **Quản lý người dùng:** Block/Unblock tài khoản, cấp quyền Giáo viên cho người dùng.
- **Quản lý danh mục:** Quản lý toàn bộ khóa học trên hệ thống.
- **Quản trị Gamification:** Cấu hình các loại Huy hiệu (Badges) và các mốc điểm thưởng.

## 3. YÊU CẦU PHI CHỨC NĂNG (Non-functional Requirements)
- **Bảo mật:** 
  - Mật khẩu phải được băm (hash) bằng `bcrypt`.
  - Mọi API (ngoài đăng nhập/đăng ký) đều phải được xác thực bằng JWT (JSON Web Token). Phân quyền chặt chẽ bằng Role-based Access Control (RBAC).
- **Hiệu năng & Tối ưu:** 
  - File/Ảnh phải được upload trực tiếp qua Stream lên Cloudinary để giảm tải cho máy chủ.
  - Các dữ liệu thường xuyên truy xuất (Bảng xếp hạng) phải được lưu đệm (cache) trong Redis.
- **Thời gian phản hồi AI:** AI Gemini xử lý văn bản chấm bài không được vượt quá 10 giây để đảm bảo trải nghiệm người dùng.
- **Tính mở rộng (Scalability):** Hệ thống Backend thiết kế theo chuẩn Modular Monolith, có thể dễ dàng tách thành Microservices trong tương lai. Dữ liệu câu hỏi lưu dưới dạng `JSONB` trong PostgreSQL để đáp ứng linh hoạt các chuẩn đề thi mới.

## 4. KIẾN TRÚC HỆ THỐNG
- **Ngôn ngữ:** TypeScript.
- **Framework:** NestJS.
- **Cơ sở dữ liệu:** PostgreSQL (Prisma ORM).
- **Caching:** Redis.
- **Triển khai:** Render.com (Docker).

## 5. CÁC THIẾT KẾ MẪU (DESIGN PATTERNS) ĐƯỢC ÁP DỤNG TRONG ĐỒ ÁN
Để chứng minh năng lực kỹ thuật và giải quyết các bài toán phức tạp, hệ thống áp dụng các Design Patterns sau:

### 5.1. Kiến trúc Modular Monolith
Toàn bộ source code được chia thành các module hoàn toàn độc lập theo nghiệp vụ (Domain-Driven Design). Mỗi module (`UserModule`, `CourseModule`, `QuizModule`, `AiModule`, `GamificationModule`) sở hữu Controller, Service riêng. Các module không gọi trực tiếp vào database của nhau mà giao tiếp qua các Service được export. Điều này giúp code gọn gàng, tránh "Spaghetti code", và rất dễ dàng để tách thành Microservices bằng Python/Go sau này nếu cần.

### 5.2. Strategy Pattern (Mẫu Chiến lược)
**Áp dụng vào AI chấm bài:** Hệ thống thiết kế Interface `IAIEvaluator` với hàm `evaluate()`. Thay vì code "cứng" (hard-code) API của Google Gemini, hệ thống triển khai class `GeminiEvaluatorStrategy`. Trong tương lai, nếu cần chuyển sang ChatGPT, chỉ cần tạo thêm `OpenAIEvaluatorStrategy` mà không phải đập đi viết lại logic cốt lõi.

### 5.3. Observer Pattern (Mẫu Quan sát / Event-Driven)
**Áp dụng vào hệ thống Gamification:** Để hệ thống không bị "kịch kim" (tightly coupled), khi học viên nộp bài thi thành công (`QuizModule`), thay vì gọi trực tiếp hàng loạt hàm để cộng điểm, hệ thống chỉ phát (emit) một sự kiện: `QuizSubmittedEvent`. 
Các "Người quan sát" (Observers) đứng chờ sẵn sẽ tự động thực thi công việc của mình:
- `LeaderboardListener`: Lấy điểm để cộng vào bảng xếp hạng.
- `AchievementListener`: Kiểm tra xem có đạt điều kiện phát Huy hiệu hay không.
- `NotificationListener`: Gửi thông báo chúc mừng user.

### 5.4. Repository Pattern
**Áp dụng vào việc tách biệt CSDL:** Tầng xử lý nghiệp vụ (Service) được tách biệt hoàn toàn khỏi tầng truy xuất cơ sở dữ liệu (Prisma). Controller không được phép truy vấn Database. Nhờ đó, việc viết Unit Test trở nên dễ dàng (có thể giả lập - Mock được Database).

### 5.5. Singleton Pattern (Mẫu Độc bản)
Đảm bảo một class chỉ có duy nhất một instance trong suốt vòng đời của ứng dụng. Nhờ sử dụng cơ chế **Dependency Injection (DI)** mặc định của NestJS, các lớp như `PrismaService` (Quản lý Connection Pool CSDL) hoặc `AiService` luôn tự động hoạt động dưới dạng Singleton, giúp tối ưu hóa bộ nhớ và hiệu năng cực tốt.
