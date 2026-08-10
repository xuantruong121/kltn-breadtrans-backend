# Sơ đồ Kiến trúc Hệ thống (System Architecture) - Cấu trúc Modular Monolith

> Sơ đồ dưới đây thể hiện rõ kiến trúc **Modular Monolith** được áp dụng trong Backend NestJS. Các module được chia theo Bounded Context (Domain-Driven Design) và hoàn toàn độc lập với nhau.

```mermaid
architecture-beta
    group client(Internet)[Học viên / Giáo viên / Admin]
    group server(Render.com)[KLTN Backend Server]
    group db(Database)[Dữ liệu & Bộ nhớ đệm]
    group external(3rd Party)[Dịch vụ ngoài]

    service api_gateway(server)[NestJS Core (app.module)] in server
    
    %% Bounded Contexts (Modular Monolith)
    service auth(server)[AuthModule (Đăng nhập, JWT)] in server
    service user(server)[UserModule (Profile, Quyền)] in server
    service course(server)[CourseModule (Khóa học, Lớp)] in server
    service quiz(server)[QuizModule (Bài thi, Câu hỏi)] in server
    service gamification(server)[GamificationModule (Điểm, Huy hiệu)] in server
    service ai(server)[AiModule (AI Tutor)] in server

    %% Database Services
    service postgres(database)[PostgreSQL (Prisma)] in db
    service redis(database)[Redis Cache (Session, Leaderboard)] in db

    %% External Services
    service gemini(cloud)[Google Gemini (LLM)] in external
    service cloudinary(cloud)[Cloudinary (Media Storage)] in external

    %% Connections
    client:R -- L:api_gateway
    api_gateway:T -- B:auth
    api_gateway:T -- B:user
    api_gateway:B -- T:course
    api_gateway:B -- T:quiz
    api_gateway:R -- L:gamification
    api_gateway:R -- L:ai

    %% Module inter-communications (Loosely coupled via Event Emitter or Service Export)
    quiz:R -- L:ai
    quiz:T -- B:gamification

    %% Database Connections
    server:B -- T:postgres
    gamification:R -- L:redis

    %% External Connections
    ai:B -- T:gemini
    api_gateway:B -- T:cloudinary
```
