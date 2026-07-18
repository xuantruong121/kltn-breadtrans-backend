"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient({ log: ['info', 'warn', 'error'] });
async function clearDB() {
    console.log('Clearing old data...');
    await prisma.speakingSubmission.deleteMany();
    await prisma.speakingExercise.deleteMany();
    await prisma.userBadge.deleteMany();
    await prisma.pointHistory.deleteMany();
    await prisma.leaderboard.deleteMany();
    await prisma.result.deleteMany();
    await prisma.submission.deleteMany();
    await prisma.question.deleteMany();
    await prisma.quiz.deleteMany();
    await prisma.material.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.class.deleteMany();
    await prisma.course.deleteMany();
    await prisma.badge.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.user.deleteMany();
}
async function main() {
    await clearDB();
    console.log('Seeding fake data (10+ records per table)...');
    const passwordHash = await bcrypt.hash('123456', 10);
    const users = [];
    users.push(await prisma.user.create({
        data: { email: 'admin@breadtrans.com', password: passwordHash, role: client_1.Role.ADMIN, profile: { create: { fullName: 'Admin System' } } }
    }));
    for (let i = 1; i <= 3; i++) {
        users.push(await prisma.user.create({
            data: { email: `teacher${i}@breadtrans.com`, password: passwordHash, role: client_1.Role.TEACHER, profile: { create: { fullName: `Teacher ${i}` } } }
        }));
    }
    for (let i = 1; i <= 6; i++) {
        users.push(await prisma.user.create({
            data: { email: `student${i}@breadtrans.com`, password: passwordHash, role: client_1.Role.STUDENT, profile: { create: { fullName: `Student ${i}`, targetScore: `IELTS ${6.0 + i * 0.5}` } } }
        }));
    }
    const teachers = users.filter(u => u.role === client_1.Role.TEACHER);
    const students = users.filter(u => u.role === client_1.Role.STUDENT);
    const badges = [];
    for (let i = 1; i <= 10; i++) {
        badges.push(await prisma.badge.create({
            data: {
                name: `Huy hiệu Cấp ${i}`,
                description: `Dành cho học viên đạt ${i * 100} điểm`,
                criteria: { type: 'POINTS', threshold: i * 100 },
                iconUrl: `https://example.com/badge${i}.png`
            }
        }));
    }
    const courses = [];
    for (let i = 1; i <= 10; i++) {
        courses.push(await prisma.course.create({
            data: {
                title: `Khóa học Tiếng Anh Chuyên Sâu ${i}`,
                description: `Mô tả chi tiết cho khóa học ${i}`,
                price: 500000 + i * 50000,
                thumbnail: `https://example.com/course${i}.jpg`
            }
        }));
    }
    const classes = [];
    for (let i = 0; i < 10; i++) {
        const course = courses[i];
        const teacher = teachers[i % teachers.length];
        classes.push(await prisma.class.create({
            data: {
                courseId: course.id,
                teacherId: teacher.id,
                name: `Lớp ${course.title} - Ca tối`,
                meetingLink: `https://meet.google.com/xyz-123-${i}`
            }
        }));
    }
    for (let i = 0; i < 10; i++) {
        const cls = classes[i];
        const lesson = await prisma.lesson.create({
            data: {
                classId: cls.id,
                title: `Bài giảng ${i + 1}`,
                description: `Nội dung bài giảng ${i + 1}`,
                order: 1,
                videoUrl: `https://youtube.com/watch?v=vid${i}`
            }
        });
        await prisma.material.create({
            data: {
                lessonId: lesson.id,
                title: `Tài liệu PDF cho bài ${i + 1}`,
                fileUrl: `https://example.com/doc${i + 1}.pdf`,
                fileType: 'PDF'
            }
        });
    }
    for (let i = 0; i < 10; i++) {
        const student = students[i % students.length];
        const cls = classes[i];
        await prisma.enrollment.create({
            data: {
                userId: student.id,
                classId: cls.id,
                progress: Math.floor(Math.random() * 100),
            }
        });
    }
    const quizTypes = [client_1.QuizType.GENERAL, client_1.QuizType.IELTS, client_1.QuizType.TOEIC, client_1.QuizType.VSTEP];
    for (let i = 0; i < 10; i++) {
        const course = courses[i];
        await prisma.quiz.create({
            data: {
                courseId: course.id,
                title: `Đề thi trắc nghiệm ${i + 1}`,
                description: `Bài kiểm tra đánh giá năng lực ${i + 1}`,
                timeLimit: 45,
                type: quizTypes[i % quizTypes.length],
                questions: {
                    create: [
                        {
                            type: 'MULTIPLE_CHOICE',
                            order: 1,
                            content: { text: `Câu hỏi trắc nghiệm số 1 của đề ${i + 1}?`, options: ['A', 'B', 'C', 'D'], correct: 'A' }
                        },
                        {
                            type: 'WRITING',
                            order: 2,
                            content: { text: `Viết một đoạn văn ngắn về chủ đề ${i + 1}.` }
                        }
                    ]
                }
            }
        });
    }
    const speakingData = [
        { title: 'Basic Greetings', targetText: 'Hello! My name is Nam. I am a student. Nice to meet you!', difficulty: 'BEGINNER', category: 'GENERAL' },
        { title: 'Numbers and Days', targetText: 'Today is Monday. There are seven days in a week. The first month of the year is January.', difficulty: 'BEGINNER', category: 'GENERAL' },
        { title: 'Daily Routine', targetText: 'I wake up at six o\'clock every morning. Then I brush my teeth, have breakfast, and go to school.', difficulty: 'BEGINNER', category: 'GENERAL' },
        { title: 'TOEIC: Office Communication', targetText: 'The meeting has been rescheduled to Thursday afternoon. Please bring your project reports and performance summaries.', difficulty: 'INTERMEDIATE', category: 'TOEIC' },
        { title: 'TOEIC: Business Travel', targetText: 'I would like to book a single room for three nights, from the fifteenth to the eighteenth of November.', difficulty: 'INTERMEDIATE', category: 'TOEIC' },
        { title: 'Environmental Issues', targetText: 'Climate change is one of the most pressing challenges of our time. We must reduce carbon emissions to protect the planet for future generations.', difficulty: 'INTERMEDIATE', category: 'GENERAL' },
        { title: 'Technology in Education', targetText: 'Digital learning platforms have transformed the way students access information. Online education offers flexibility and a wide range of resources.', difficulty: 'INTERMEDIATE', category: 'GENERAL' },
        { title: 'IELTS: Problem & Solution', targetText: 'Although urbanization brings economic growth, it also leads to overcrowding and environmental degradation. Governments should invest in sustainable infrastructure and promote green spaces within cities.', difficulty: 'ADVANCED', category: 'IELTS' },
        { title: 'IELTS: Technology & Society', targetText: 'The rapid advancement of artificial intelligence raises significant ethical concerns regarding privacy, employment, and decision-making. Society must establish regulatory frameworks to ensure responsible development.', difficulty: 'ADVANCED', category: 'IELTS' },
        { title: 'IELTS: Global Economy', targetText: 'International trade agreements foster economic interdependence, yet they can expose developing nations to exploitation. Policymakers must strike a balance between liberalization and the protection of domestic industries.', difficulty: 'ADVANCED', category: 'IELTS' },
    ];
    for (const ex of speakingData) {
        await prisma.speakingExercise.create({ data: ex });
    }
    console.log(`✓ Seeded ${speakingData.length} Speaking Exercises`);
    console.log('Seeding finished successfully.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map