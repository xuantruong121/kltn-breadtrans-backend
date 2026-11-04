# Kiểm tra nội dung 3 đề TOEIC học viên đang thấy (2026-11-04)

Đọc `kltn_db` ở chế độ chỉ đọc (`default_transaction_read_only=on`); không sửa dữ liệu nào.
Ảnh Part 1, Speaking và Writing được tải từ kho public (chỉ GET) và xem từng ảnh.

```
SCOPE=ToeicExamSet 1 (L&R Đề 01), assessment 1 (S&W: exam-3-speaking + writing set 1),
      assessment 3 (4 Skills: ToeicExamSet 3 + exam-5-speaking + writing set 3)
OUT_OF_SCOPE=ToeicExamSet 2 (DRAFT), assessment 2 (ARCHIVED: exam-4-speaking, writing set 2)
LR_QUESTIONS_READ=400 of 400 (đọc từng câu cùng transcript/đoạn văn)
LR_KEY_WRONG=0
LR_KEY_DISPUTED=1 (đề 3 câu 96)
PART1_IMAGES_CHECKED=12 of 12, all match the key
SPEAKING_TASKS_READ=22 of 22; WRITING_TASKS_READ=16 of 16
STRUCTURE: 200 câu mỗi đề, đánh số liền 1-200, số câu mỗi Part 6/25/39/30/30/16/54,
           Part 2 có 3 lựa chọn, các Part khác 4, correctIndex hợp lệ, không có lựa chọn trùng
EXPOSURE: Part 1-2 không gửi chữ câu hỏi/lựa chọn khi làm bài; Part 1-4 không gửi passageText
          (trừ biểu đồ) — đã đọc code toeic.service.ts:990-1008, không chạy thử
```

## Cần sửa (ảnh hưởng học viên)

| # | Đề | Câu | Vấn đề | Đề xuất |
|---|---|---|---|---|
| 1 | L&R 3 (4 Skills) | 96 | Quảng cáo nói ưu đãi "this week only" là giảm 20%; đáp án là "Free delivery" (không gắn với tuần này), và không có phương án "giảm 20%". | Đổi phương án B thành "A 20 percent discount" hoặc đổi câu hỏi thành "What is offered on online orders over fifty dollars?" |
| 2 | S&W (assessment 1) | Speaking 9 | "I heard the afternoon workshop was moved. Can you tell me who is leading it now?" — lịch không có buổi nào bị dời; buổi "workshop" duy nhất ở 10:30 sáng. | Viết lại theo mẫu TOEIC: "I heard the writing review is in the morning. Is that right?" (đáp: không, 15:00 phòng B2, Mr. Khoa). |
| 3 | L&R 1 | 101-200 + 1-31 (131 câu) | Lời giải thích viết bằng tiếng Anh, ngắn một câu; Part 3-4 thì tiếng Việt. Đề 3 toàn bộ tiếng Việt. | Viết lại 131 lời giải thích bằng tiếng Việt. |
| 4 | L&R 1 | 19, 22 | Giải thích nói "The first response…" nhưng đáp án là C. | Sửa câu giải thích (đi cùng mục 3). |
| 5 | L&R 3 | 161 | Giải thích viết "đáp án A software demonstration" — "A" là mạo từ, đáp án đúng là B; dễ hiểu nhầm. | "đáp án B (A software demonstration)". |

## Lệch so với cấu trúc TOEIC thật (không sai đáp án)

- **Part 3 (cả hai đề):** toàn hội thoại 2 người; không có hội thoại 3 người, không có câu hỏi kèm biểu đồ, không có câu hỏi hàm ý ("What does the man mean when he says…").
- **Part 4 (cả hai đề):** không có câu hỏi kèm biểu đồ.
- **Part 7:** đề 3 câu 176-200 là 5 bài đọc đơn, mỗi bài 5 câu — không có bài đọc kép/ba. Đề 1 có 5 cụm ba văn bản (176-200), không có cụm đọc kép (176-185 đúng ra là 2 cụm hai văn bản).
- **Speaking 5-7 (cả hai bộ):** ba câu ba chủ đề khác nhau; TOEIC thật dùng chung một chủ đề.
- **Writing bộ 3:** câu 1-5 yêu cầu 3 từ khoá (TOEIC: 2); câu 6-7 bắt viết email mới thay vì trả lời một email cho sẵn; bài luận 250-300 từ (TOEIC khuyến nghị từ 300).
- **Writing bộ 1:** câu 6-7 "ít nhất 25 từ", bài luận "ít nhất 150 từ" — thấp hơn chuẩn.

## Chất lượng phương án nhiễu và nội dung

- **L&R 1 Part 5-6:** nhiều phương án nhiễu sai ngữ pháp hoặc không có thật, loại được ngay: 107 "betterly", 113 "expanding after plans", 119 "therefore of", 128 "addition of", 130 "whose company"/"which place", 135 "was been", 137 "are visit", 139 "has begun yesterday", 140 "has agreeing".
- **L&R 3 câu 103:** "within next month" — tự nhiên phải là "within the next month".
- **L&R 3 Part 5:** 7/30 câu cùng dạng điền trạng từ cách thức (101, 102, 109, 119, 127, 128, 129).
- **L&R 3 câu 34:** câu hỏi "What is the man told to do next?" nhưng B-D là thông tin, không phải hành động.
- **L&R 3 câu 47:** "A missing parcel" cho một bưu kiện chỉ bị trễ.
- **Tên và số lặp lại:** "Apex" (4 công ty ở đề 1, thêm Apex Airlines/Shipping/Marketing/Office Supplies ở đề 3), Sarah Jenkins (2 lần đề 1, 1 lần đề 3), David Miller, mã 405 (gói hàng đề 1, chuyến bay đề 3), Grand Plaza Hotel (3 lần đề 3). Ba hội thoại giao hàng trễ trong Part 3 đề 1 (nhóm 34, 40, 44).
- **Ảnh Speaking 4 Skills:** câu 3 chỉ 500×315 px; câu 4 là cảnh đêm rất tối, khó mô tả chi tiết.
- **Writing bộ 1:** 3 ảnh dùng lại đúng ảnh Part 1 của đề L&R 1 (folders-cabinet, departure-board, bicycle-rack).
- `imageBrief` của Part 1 đề 3 là mô tả ảnh dự kiến ban đầu, không khớp ảnh thật đang dùng; ảnh thật và đáp án khớp nhau. Trường này chỉ dành cho admin.

## Không kiểm

```
AUDIO_CONTENT=NOT_VERIFIED (không nghe lại audio từng câu; Part 3 đề 1 và 3 đã dựng lại hôm nay và chủ dự án nghe mẫu 1 nhóm mỗi đề)
SPEAKING_PICTURES_SW=NOT_VERIFIED (office-meeting, cafe-counter chưa mở xem)
WRITING_SET3_IMAGES=4 of 5 viewed (ảnh câu 4 chưa mở; trang nguồn là "receptionists-phone-call-hotel")
```
