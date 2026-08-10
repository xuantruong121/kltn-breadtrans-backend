# Sơ đồ Tuần tự (Sequence Diagram) - Luồng AI chấm bài Writing

> Copy khối code từ chữ `sequenceDiagram` trở xuống và dán vào công cụ hỗ trợ Mermaid.

```text
sequenceDiagram
    autonumber
    actor S as Học viên
    participant FE as Frontend (Web/Mobile)
    participant BE as Backend (NestJS)
    participant DB as Database (PostgreSQL)
    participant AI as Google Gemini API
    participant Event as Event Emitter (Gamification)

    S->>FE: Hoàn thành bài Writing và bấm "Nộp bài"
    FE->>BE: POST /quizzes/:id/submit (Kèm đáp án JSON)
    activate BE
    
    BE->>DB: Truy vấn dữ liệu Bài Quiz & Câu hỏi
    activate DB
    DB-->>BE: Trả về thông tin Quiz
    deactivate DB
    
    BE->>AI: Gửi Prompt yêu cầu chấm bài & Payload của Học viên
    activate AI
    Note right of BE: System Prompt: Bạn là 1 giám khảo IELTS.<br>Chấm điểm bài viết sau dựa trên 4 tiêu chí...
    AI-->>BE: Trả về Feedback chi tiết và Điểm số (Score)
    deactivate AI
    
    BE->>DB: Lưu Submission, Điểm, và AI Feedback
    activate DB
    DB-->>BE: Lưu thành công
    deactivate DB
    
    BE->>Event: emit('quiz.submitted', { userId, score })
    activate Event
    Note over Event,DB: Chạy ngầm logic cộng điểm & xét huy hiệu
    Event->>DB: Cập nhật Bảng xếp hạng (Leaderboard)
    deactivate Event
    
    BE-->>FE: Trả về HTTP 201 Created (Kèm ID bài nộp)
    deactivate BE
    
    FE-->>S: Hiển thị màn hình kết quả và Feedback của AI
```
