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
const child_process_1 = require("child_process");
const prisma = new client_1.PrismaClient({ log: ['info', 'warn', 'error'] });
async function clearDB() {
    console.log('Clearing old data...');
    const tables = [
        'ToeicSpeakingWritingSubmission', 'ToeicAttemptAnswer', 'ToeicAttempt', 'ToeicQuestion', 'ToeicQuestionGroup', 'ToeicExamSet',
        'UserVocabWordProgress', 'VocabWord', 'VocabTopic',
        'AiUsage', 'WatchTracking', 'GameBattle', 'GamePlay', 'GameSettings',
        'MarketOrder', 'MarketProduct',
        'CurrencyRequest', 'CurrencyTransaction',
        'SpeakingEvalRetry', 'SpeakingSubmission', 'SpeakingExercise',
        'UserBookProgress', 'Leaderboard', 'UserBadge', 'Badge', 'PointHistory',
        'Attendance', 'Session', 'AssignmentSubmission', 'Assignment', 'Announcement',
        'Result', 'Submission', 'Question', 'Quiz', 'PracticeTopic',
        'Material', 'Lesson', 'Enrollment', 'Class', 'Course',
        'UserBilling', 'UserStats', 'Profile', 'User'
    ];
    for (const table of tables) {
        try {
            if (prisma[table.charAt(0).toLowerCase() + table.slice(1)]) {
                await prisma[table.charAt(0).toLowerCase() + table.slice(1)].deleteMany();
            }
        }
        catch (e) {
            console.warn(`Could not clear table ${table}`, e.message);
        }
    }
}
async function main() {
    await clearDB();
    console.log('Seeding comprehensive fake data...');
    const passwordHash = await bcrypt.hash('123456', 10);
    const users = [];
    users.push(await prisma.user.create({
        data: {
            email: 'admin@breadtrans.com', password: passwordHash, role: client_1.Role.ADMIN,
            profile: { create: { fullName: 'Admin System' } },
            stats: { create: { totalBanhRan: 1000000, countHeart: 999 } },
            billing: { create: { bankName: 'MBBank', bankAccountNumber: '123456789' } }
        }
    }));
    for (let i = 1; i <= 3; i++) {
        users.push(await prisma.user.create({
            data: {
                email: `teacher${i}@breadtrans.com`, password: passwordHash, role: client_1.Role.TEACHER,
                profile: { create: { fullName: `Teacher ${i}` } },
                stats: { create: { totalBanhRan: 5000 } },
                billing: { create: { bankName: 'Vietcombank', bankAccountNumber: `98765432${i}` } }
            }
        }));
    }
    for (let i = 1; i <= 6; i++) {
        users.push(await prisma.user.create({
            data: {
                email: `student${i}@breadtrans.com`, password: passwordHash, role: client_1.Role.STUDENT,
                profile: { create: { fullName: `Student ${i}`, targetScore: `IELTS ${6.0 + i * 0.5}`, phone: `090123456${i}` } },
                stats: { create: { totalBanhRan: 1000 + i * 150, countHeart: 5, streakCount: i } },
                billing: { create: { tuitionFee: { "2026-08": { amount: 500000, paidAt: new Date().toISOString() } } } }
            }
        }));
    }
    const teachers = users.filter(u => u.role === client_1.Role.TEACHER);
    const students = users.filter(u => u.role === client_1.Role.STUDENT);
    const products = [];
    for (let i = 1; i <= 5; i++) {
        products.push(await prisma.marketProduct.create({
            data: {
                name: `Sản phẩm Cửa hàng ${i}`,
                price: 200 + i * 100,
                imageUrl: `https://example.com/product${i}.png`,
                order: i,
                purchaseCount: 0
            }
        }));
    }
    const vocabTopic = await prisma.vocabTopic.create({
        data: {
            title: 'Office Communication',
            categoryName: 'Business English',
            totalWords: 5,
            isPro: false,
            words: {
                create: [
                    { word: 'Meeting', pos: 'noun', meaning: 'Cuộc họp', exampleEn: 'We have a meeting at 3 PM.' },
                    { word: 'Agenda', pos: 'noun', meaning: 'Chương trình nghị sự', exampleEn: 'Let\'s review the agenda.' },
                    { word: 'Colleague', pos: 'noun', meaning: 'Đồng nghiệp', exampleEn: 'He is my colleague.' },
                    { word: 'Deadline', pos: 'noun', meaning: 'Hạn chót', exampleEn: 'The deadline is tomorrow.' },
                    { word: 'Report', pos: 'noun', meaning: 'Báo cáo', exampleEn: 'Please submit the report.' }
                ]
            }
        }
    });
    const toeicExam = await prisma.toeicExamSet.create({
        data: {
            title: 'Đề thi TOEIC Rút gọn 2026',
            description: 'Mô phỏng đề thi thực tế (Rút gọn)',
            difficulty: 'Trung bình',
            createdBy: teachers[0].id,
            groups: {
                create: [
                    {
                        part: 1,
                        groupOrder: 1,
                        questions: {
                            create: [
                                {
                                    questionNumber: 1,
                                    text: 'What is the man doing?',
                                    options: ['A', 'B', 'C', 'D'],
                                    correctIndex: 0,
                                    explanation: 'The man is standing by the desk.'
                                }
                            ]
                        }
                    }
                ]
            }
        }
    });
    const courses = [];
    for (let i = 1; i <= 3; i++) {
        courses.push(await prisma.course.create({
            data: {
                title: `Khóa học Tiếng Anh Chuyên Sâu ${i}`,
                description: `Mô tả chi tiết cho khóa học ${i}`,
                level: i === 1 ? 'BEGINNER' : i === 2 ? 'INTERMEDIATE' : 'ADVANCED',
                thumbnail: `https://example.com/course${i}.jpg`,
                status: client_1.CourseStatus.PUBLISHED
            }
        }));
    }
    const classes = [];
    for (let i = 0; i < 3; i++) {
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
    for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const cls = classes[i % classes.length];
        await prisma.enrollment.create({
            data: {
                userId: student.id,
                classId: cls.id,
                progress: Math.floor(Math.random() * 100),
            }
        });
    }
    const quiz = await prisma.quiz.create({
        data: {
            title: 'Đề thi trắc nghiệm mẫu',
            type: client_1.QuizType.TOEIC,
            questions: {
                create: [
                    { type: 'MULTIPLE_CHOICE', order: 1, content: { text: `Câu hỏi mẫu?`, options: ['A', 'B', 'C', 'D'], correct: 'A' } }
                ]
            }
        }
    });
    await prisma.speakingExercise.create({
        data: { title: 'Basic Greetings', targetText: 'Hello! Nice to meet you!', difficulty: 'BEGINNER', category: 'GENERAL' }
    });
    console.log('Seeding finished successfully.');
    console.log('\n--- Running additional seed scripts ---');
    const additionalSeeds = [
        'seed-vocab.ts',
        'seed-bilingual.ts',
        'seed-writing.ts',
        'prisma/seed-ai.ts',
        'prisma/seed-ipa.ts',
        'prisma/seed-more.ts',
        'prisma/seed-practice.ts',
        'prisma/seed-translation.ts'
    ];
    for (const script of additionalSeeds) {
        try {
            console.log(`\n▶ Executing ${script}...`);
            (0, child_process_1.execSync)(`npx ts-node ${script}`, { stdio: 'inherit' });
            console.log(`✅ Finished ${script}`);
        }
        catch (error) {
            console.error(`❌ Failed to execute ${script}`, error.message);
        }
    }
    console.log('\n--- All seed scripts completed ---');
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