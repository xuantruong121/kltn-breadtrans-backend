# Biểu đồ Thực thể Liên kết (ERD) - CSDL KLTN

> Bạn có thể copy khối code Mermaid bên dưới dán vào các phần mềm hỗ trợ Mermaid (như Obsidian, Notion, Github, hoặc trang web `mermaid.live`) để hiển thị thành hình ảnh đẹp mắt cho báo cáo.

```mermaid:

erDiagram
    User ||--o{ Profile : "has"
    User ||--o{ Enrollment : "enrolls"
    User ||--o{ ClassEntity : "teaches"
    User ||--o{ Submission : "submits"
    User ||--o{ PointHistory : "earns"
    User ||--o{ UserBadge : "achieves"
    User ||--o| Leaderboard : "has_rank"

    Course ||--o{ ClassEntity : "contains"
    Course ||--o{ Quiz : "has"

    ClassEntity ||--o{ Enrollment : "includes"
    ClassEntity ||--o{ Lesson : "contains"

    Lesson ||--o{ Material : "has"

    Quiz ||--o{ Question : "has"
    Quiz ||--o{ Submission : "receives"

    Submission ||--o{ Result : "has"

    Badge ||--o{ UserBadge : "awarded_to"

    User {
        Int id PK
        String email
        String password
        String role
        String createdAt
    }
    Profile {
        Int id PK
        Int userId FK
        String fullName
        String avatar
        String phone
    }
    Course {
        Int id PK
        String title
        String description
        Float price
    }
    ClassEntity {
        Int id PK
        Int courseId FK
        Int teacherId FK
        String name
        String startDate
        String endDate
    }
    Enrollment {
        Int id PK
        Int userId FK
        Int classId FK
        Float progress
    }
    Lesson {
        Int id PK
        Int classId FK
        String title
        Int order
    }
    Material {
        Int id PK
        Int lessonId FK
        String title
        String fileUrl
    }
    Quiz {
        Int id PK
        Int courseId FK
        String title
        String type
        Int timeLimit
    }
    Question {
        Int id PK
        Int quizId FK
        String type
        String content
        Int order
    }
    Submission {
        Int id PK
        Int quizId FK
        Int userId FK
        Float score
        String aiFeedback
    }
    Result {
        Int id PK
        Int submissionId FK
        Int questionId FK
        String isCorrect
        Float score
    }
    Badge {
        Int id PK
        String name
        String description
        String criteria
    }
    PointHistory {
        Int id PK
        Int userId FK
        Int points
        String reason
    }
    Leaderboard {
        Int id PK
        Int userId FK
        Int totalPoints
        Int rank
    }
    UserBadge {
        Int id PK
        Int userId FK
        Int badgeId FK
    }