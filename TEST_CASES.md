# Bảng Danh sách Test Case (Kịch bản Kiểm thử)

| STT | Module | Tên Test Case (Mô tả) | Đầu vào (Input) | Kết quả mong đợi (Expected Output) | Kết quả thực tế |
|---|---|---|---|---|---|
| 1 | Auth | Đăng nhập với mật khẩu sai | Email đúng, Mật khẩu sai | Hệ thống ném ra lỗi `UnauthorizedException` (401), báo sai mật khẩu. | Pass |
| 2 | Auth | Đăng nhập với email không tồn tại | Email chưa từng đăng ký | Hệ thống ném ra lỗi `UnauthorizedException` (401), báo sai tài khoản. | Pass |
| 3 | Auth | Trích xuất thông tin người dùng từ JWT Token hợp lệ | Gửi request có chứa JWT Header | Trả về `req.user` chứa `id` và `role` chính xác. | Pass |
| 4 | User | Xem Profile của người dùng khác (Không có quyền) | Truy cập endpoint `/users/:id` với token của một user khác | Ném ra lỗi `ForbiddenException` (403) vì Guard chặn. | Pass |
| 5 | Course | Tạo khóa học mới (Quyền Admin) | Payload hợp lệ, Token Admin | Khóa học được tạo thành công, trả về HTTP 201. | Pass |
| 6 | Course | Học viên xem bài học nằm ngoài khóa học đã đăng ký | ID bài học không thuộc Enrollment | Hệ thống chặn và báo lỗi `ForbiddenException`. | Pass |
| 7 | Quiz | Lấy bài Quiz hợp lệ | Gọi `GET /quizzes/1` | Trả về thông tin Quiz kèm danh sách Questions (được sắp xếp theo `order`). | Pass |
| 8 | Quiz | Nộp bài rỗng | Payload câu trả lời rỗng | Báo lỗi Validation `BadRequestException` (400). | Pass |
| 9 | Quiz | AI chấm bài Writing lỗi timeout | Quá tải Gemini API | Hệ thống bắt lỗi (try/catch), báo cho User "Hệ thống AI đang bận". | Pass |
| 10 | Gamification | Sự kiện cộng điểm tự động khi nộp bài điểm tuyệt đối | Nộp bài trắc nghiệm đúng 100% | Bảng `PointHistory` tự sinh record mới, `Leaderboard` được cập nhật. | Pass |
| 11 | Upload | Tải file > 10MB | File MP4 50MB | Bị chặn bởi `ParseFilePipe`, báo lỗi `Payload Too Large`. | Pass |
| 12 | Upload | Upload ảnh hợp lệ | File JPG 2MB | Upload thành công lên Cloudinary, trả về URL HTTPS. | Pass |
