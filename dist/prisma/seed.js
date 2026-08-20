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
const prisma = new client_1.PrismaClient({ log: ['warn', 'error'] });
async function clearDB() {
    console.log('🧹 Clearing old data in reverse dependency order...');
    const tables = [
        'ToeicSpeakingWritingSubmission', 'ToeicAttemptAnswer', 'ToeicAttempt', 'ToeicQuestion', 'ToeicQuestionGroup', 'ToeicExamSet',
        'UserVocabWordProgress', 'VocabWord', 'VocabTopic',
        'ContentTopic',
        'GrammarAttempt', 'GrammarQuestion', 'GrammarTopic',
        'AiUsage', 'WatchTracking', 'GameBattle', 'GamePlay', 'GameSettings',
        'MarketOrder', 'MarketProduct',
        'CurrencyRequest', 'CurrencyTransaction',
        'SpeakingEvalRetry', 'SpeakingSubmission', 'SpeakingExercise',
        'UserBookProgress', 'Leaderboard', 'UserBadge', 'Badge', 'PointHistory',
        'Attendance', 'Session', 'AssignmentSubmission', 'Assignment', 'Announcement',
        'Result', 'Submission', 'Question', 'Quiz', 'PracticeTopic',
        'Material', 'Lesson', 'Enrollment', 'Class', 'Course',
        'UserQuestProgress', 'DailyQuest', 'UserPet',
        'UserBilling', 'UserStats', 'Profile', 'User'
    ];
    for (const table of tables) {
        try {
            const modelDelegate = prisma[table.charAt(0).toLowerCase() + table.slice(1)];
            if (modelDelegate && typeof modelDelegate.deleteMany === 'function') {
                await modelDelegate.deleteMany();
            }
        }
        catch (e) {
            console.warn(`Could not clear table ${table}:`, e?.message);
        }
    }
    console.log('✨ Cleaned existing records.');
}
async function main() {
    await clearDB();
    console.log('🌱 Starting comprehensive seed for BreadTrans...\n');
    const passwordHash = await bcrypt.hash('123456', 10);
    console.log('👤 Seeding Users & Profiles...');
    const admin = await prisma.user.create({
        data: {
            email: 'admin@breadtrans.com',
            password: passwordHash,
            role: client_1.Role.ADMIN,
            profile: {
                create: {
                    fullName: 'Trần Minh Quang (Admin)',
                    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
                    phone: '0988889999',
                    address: 'Hà Nội, Việt Nam',
                }
            },
            stats: {
                create: {
                    totalBanhRan: 1000000,
                    countHeart: 999,
                    streakCount: 99,
                }
            },
            billing: {
                create: {
                    bankName: 'MBBank',
                    bankAccountNumber: '0988889999',
                    bankAccountName: 'TRAN MINH QUANG',
                }
            }
        }
    });
    const teacherConfigs = [
        {
            email: 'teacher1@breadtrans.com',
            name: 'Cô Nguyễn Thu Hà',
            avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
            phone: '0912345671',
            target: 'TOEIC 990, IELTS 8.5',
            bankName: 'Vietcombank',
            accountNumber: '1012345671'
        },
        {
            email: 'teacher2@breadtrans.com',
            name: 'Thầy James Wilson',
            avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
            phone: '0912345672',
            target: 'Native English Speaker, Pronunciation Master',
            bankName: 'Techcombank',
            accountNumber: '1902345672'
        },
        {
            email: 'teacher3@breadtrans.com',
            name: 'Cô Lê Hoàng Yến',
            avatar: 'https://images.unsplash.com/photo-1580894732444-8ecded7900cd?w=150&auto=format&fit=crop&q=80',
            phone: '0912345673',
            target: 'MA in Applied Linguistics, Writing Specialist',
            bankName: 'MBBank',
            accountNumber: '0912345673'
        },
        {
            email: 'teacher4@breadtrans.com',
            name: 'Thầy Trần Bảo Long',
            avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
            phone: '0912345674',
            target: 'Business English & TOEIC Coach',
            bankName: 'Vietcombank',
            accountNumber: '1012345674'
        }
    ];
    const teachers = [];
    for (const t of teacherConfigs) {
        const teacher = await prisma.user.create({
            data: {
                email: t.email,
                password: passwordHash,
                role: client_1.Role.TEACHER,
                profile: {
                    create: {
                        fullName: t.name,
                        avatar: t.avatar,
                        phone: t.phone,
                        targetScore: t.target,
                        address: 'TP. Hồ Chí Minh, Việt Nam',
                    }
                },
                stats: {
                    create: {
                        totalBanhRan: 10000,
                        countHeart: 10,
                        streakCount: 45,
                    }
                },
                billing: {
                    create: {
                        bankName: t.bankName,
                        bankAccountNumber: t.accountNumber,
                        bankAccountName: t.name.toUpperCase(),
                    }
                }
            }
        });
        teachers.push(teacher);
    }
    const studentConfigs = [
        { name: 'Phạm Bảo Nam', email: 'student1@breadtrans.com', target: 'TOEIC 750', phone: '0901112201', breads: 1420, streak: 21, petLevel: 3 },
        { name: 'Trần Mai Anh', email: 'student2@breadtrans.com', target: 'IELTS 7.0', phone: '0901112202', breads: 1850, streak: 28, petLevel: 4 },
        { name: 'Lê Gia Hân', email: 'student3@breadtrans.com', target: 'TOEIC 650', phone: '0901112203', breads: 1240, streak: 19, petLevel: 3 },
        { name: 'Nguyễn Tuấn Kiệt', email: 'student4@breadtrans.com', target: 'Giao tiếp Căn bản', phone: '0901112204', breads: 950, streak: 14, petLevel: 2 },
        { name: 'Vũ Phương Linh', email: 'student5@breadtrans.com', target: 'TOEIC 850', phone: '0901112205', breads: 830, streak: 12, petLevel: 2 },
        { name: 'Đỗ Quang Huy', email: 'student6@breadtrans.com', target: 'TOEIC 600', phone: '0901112206', breads: 670, streak: 9, petLevel: 2 },
        { name: 'Hoàng Minh Châu', email: 'student7@breadtrans.com', target: 'IELTS 6.5', phone: '0901112207', breads: 520, streak: 7, petLevel: 1 },
        { name: 'Bùi Thanh Trúc', email: 'student8@breadtrans.com', target: 'TOEIC 700', phone: '0901112208', breads: 480, streak: 6, petLevel: 1 },
        { name: 'Đặng Đình Phong', email: 'student9@breadtrans.com', target: 'Phát âm Chuẩn', phone: '0901112209', breads: 390, streak: 5, petLevel: 1 },
        { name: 'Ngô Bảo Ngọc', email: 'student10@breadtrans.com', target: 'TOEIC 800', phone: '0901112210', breads: 310, streak: 4, petLevel: 1 },
        { name: 'Dương Nhật Minh', email: 'student11@breadtrans.com', target: 'Giao tiếp Du lịch', phone: '0901112211', breads: 250, streak: 3, petLevel: 1 },
        { name: 'Phan Thùy Dương', email: 'student12@breadtrans.com', target: 'TOEIC 900', phone: '0901112212', breads: 180, streak: 2, petLevel: 1 },
    ];
    const students = [];
    for (let i = 0; i < studentConfigs.length; i++) {
        const s = studentConfigs[i];
        const student = await prisma.user.create({
            data: {
                email: s.email,
                password: passwordHash,
                role: client_1.Role.STUDENT,
                profile: {
                    create: {
                        fullName: s.name,
                        targetScore: s.target,
                        phone: s.phone,
                        birthYear: 2004 + (i % 5),
                        parentName: `Phụ huynh ${s.name}`,
                        parentPhone: `09871122${(i + 1).toString().padStart(2, '0')}`,
                        address: 'TP. Hồ Chí Minh, Việt Nam',
                    }
                },
                stats: {
                    create: {
                        totalBanhRan: s.breads,
                        streakCount: s.streak,
                        countHeart: 5,
                        timesVocab: 15 + i * 5,
                        timesVocabXS: 5 + i * 2,
                        quizAccuracy: 85.5 + (i % 10),
                        speakingAccuracy: 82.0 + (i % 12),
                    }
                },
                billing: {
                    create: {
                        tuitionFee: {
                            "2026-07": { amount: 650000, paidAt: '2026-07-05T08:00:00.000Z' },
                            "2026-08": { amount: 650000, paidAt: i < 10 ? '2026-08-05T09:30:00.000Z' : null }
                        }
                    }
                },
                pet: {
                    create: {
                        name: `${s.name.split(' ').pop()} Pet`,
                        level: s.petLevel,
                        health: 100,
                        happiness: 100,
                        exp: s.petLevel * 50,
                    }
                }
            }
        });
        await prisma.pointHistory.createMany({
            data: [
                { userId: student.id, points: 50, reason: 'Hoàn thành bài tập Flashcard tuần', createdAt: new Date(Date.now() - 86400000 * 3) },
                { userId: student.id, points: 20, reason: 'Điểm danh chuyên cần buổi học', createdAt: new Date(Date.now() - 86400000 * 2) },
                { userId: student.id, points: 100, reason: 'Đạt điểm tối đa Quiz Ngữ Pháp', createdAt: new Date(Date.now() - 86400000) },
            ]
        });
        students.push({ ...student, name: s.name });
    }
    console.log('🛍️ Seeding Market Products & Orders...');
    const marketProductConfigs = [
        { name: 'Khiên Bảo Vệ Streak 24h', price: 100, imageUrl: 'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=300&auto=format&fit=crop&q=80', order: 1, purchaseCount: 42 },
        { name: 'Nhân Đôi Bánh Mì (24 Giờ)', price: 200, imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&auto=format&fit=crop&q=80', order: 2, purchaseCount: 38 },
        { name: 'Huy Hiệu Bậc Thầy Từ Vựng', price: 150, imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=300&auto=format&fit=crop&q=80', order: 3, purchaseCount: 29 },
        { name: 'Huy Hiệu Chiến Thần Đấu Trường', price: 300, imageUrl: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=300&auto=format&fit=crop&q=80', order: 4, purchaseCount: 19 },
        { name: 'Khung Avatar Vương Miện Quán Quân', price: 500, imageUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300&auto=format&fit=crop&q=80', order: 5, purchaseCount: 15 },
        { name: 'Khung Avatar Cyberpunk Neon', price: 450, imageUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=300&auto=format&fit=crop&q=80', order: 6, purchaseCount: 12 },
        { name: 'Sổ Tay Từ Vựng BreadTrans Cute', price: 1200, imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300&auto=format&fit=crop&q=80', order: 7, purchaseCount: 8 },
        { name: 'Voucher Trà Sữa Phúc Long 30K', price: 2000, imageUrl: 'https://images.unsplash.com/photo-1558857563-b37cf4a44136?w=300&auto=format&fit=crop&q=80', order: 8, purchaseCount: 14 },
        { name: 'Gấu Bông Capybara Bánh Mì', price: 4500, imageUrl: 'https://images.unsplash.com/photo-1559454403-b8fb88521f11?w=300&auto=format&fit=crop&q=80', order: 9, purchaseCount: 6 },
        { name: 'Bình Giữ Nhiệt BreadTrans 500ml', price: 3500, imageUrl: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=300&auto=format&fit=crop&q=80', order: 10, purchaseCount: 11 },
    ];
    const products = [];
    for (const p of marketProductConfigs) {
        const product = await prisma.marketProduct.create({ data: p });
        products.push(product);
    }
    for (let i = 0; i < 4; i++) {
        const st = students[i];
        await prisma.marketOrder.create({
            data: {
                userId: st.id,
                studentName: st.name,
                items: [{ id: products[i].id, name: products[i].name, price: products[i].price, qty: 1 }],
                totalK: 0,
                totalBanh: products[i].price,
                status: i % 2 === 0 ? 'approved' : 'pending',
                createdAt: new Date(Date.now() - 86400000 * (i + 1))
            }
        });
    }
    console.log('📚 Seeding Courses, Classes, Sessions & Materials...');
    const courseConfigs = [
        {
            title: 'TOEIC 450 - 650+ Bứt Phá Mục Tiêu',
            description: 'Khóa học nền tảng toàn diện 4 kỹ năng giúp lấy lại căn bản ngữ pháp, từ vựng và chiến thuật xử lý các dạng bài TOEIC phổ biến.',
            level: 'BEGINNER',
            thumbnail: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=500&auto=format&fit=crop&q=80',
            teacherIndex: 0,
        },
        {
            title: 'TOEIC 750 - 900+ Master Chuyên Sâu',
            description: 'Luyện đề thực chiến các bẫy khó Part 5, 6 và kỹ năng nghe hiểu tốc độ cao Part 3, 4 cùng các bài đọc dài Part 7.',
            level: 'ADVANCED',
            thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=500&auto=format&fit=crop&q=80',
            teacherIndex: 3,
        },
        {
            title: 'Phát Âm & Giao Tiếp Chuẩn Bản Xứ',
            description: 'Làm chủ 44 âm trong bảng phiên âm quốc tế IPA, kỹ thuật nối âm, nuốt âm, ngữ điệu chuẩn Anh - Mỹ và phản xạ giao tiếp tự nhiên.',
            level: 'BEGINNER',
            thumbnail: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=500&auto=format&fit=crop&q=80',
            teacherIndex: 1,
        },
        {
            title: 'Ngữ Pháp Toàn Diện Từ Cơ Bản Đến Nâng Cao',
            description: 'Hệ thống hóa toàn bộ 12 thì tiếng Anh, cấu trúc câu bị động, mệnh đề quan hệ, câu điều kiện và thể giả định.',
            level: 'INTERMEDIATE',
            thumbnail: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=500&auto=format&fit=crop&q=80',
            teacherIndex: 2,
        },
        {
            title: 'Phản Xạ Nghe - Nói Qua Phim & Âm Nhạc',
            description: 'Học tiếng Anh hứng khởi qua các đoạn trích hoạt hình Disney/Pixar kinh điển và các bản nhạc US-UK nổi tiếng.',
            level: 'BEGINNER',
            thumbnail: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
            teacherIndex: 1,
        },
        {
            title: 'Tiếng Anh Thương Mại & Viết Email Chuẩn Quốc Tế',
            description: 'Rèn luyện kỹ năng viết thư tín thương mại, đề xuất dự án, thuyết trình tiếng Anh và đàm phán trong môi trường công sở.',
            level: 'ADVANCED',
            thumbnail: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=500&auto=format&fit=crop&q=80',
            teacherIndex: 3,
        },
    ];
    const courses = [];
    for (const c of courseConfigs) {
        const course = await prisma.course.create({
            data: {
                title: c.title,
                description: c.description,
                level: c.level,
                thumbnail: c.thumbnail,
                teacherId: teachers[c.teacherIndex].id,
                status: client_1.CourseStatus.PUBLISHED,
                lessons: {
                    create: [
                        { title: 'Bài 1: Khởi động & Nắm vững kiến thức nền tảng', order: 1 },
                        { title: 'Bài 2: Thực hành chiến thuật làm bài trọng điểm', order: 2 },
                        { title: 'Bài 3: Luyện đề tổng hợp & Chữa lỗi thường gặp', order: 3 },
                    ]
                }
            },
            include: { lessons: true }
        });
        courses.push(course);
    }
    const classConfigs = [
        { courseIdx: 0, teacherIdx: 0, name: 'Lớp TOEIC 650+ Khóa K1 (Tối 2-4-6)', roomSuffix: 'toeic-650-k1' },
        { courseIdx: 0, teacherIdx: 0, name: 'Lớp TOEIC 650+ Khóa K2 (Tối 3-5-7)', roomSuffix: 'toeic-650-k2' },
        { courseIdx: 1, teacherIdx: 3, name: 'Lớp Master 900+ Chuyên Sâu (Tối T7-CN)', roomSuffix: 'toeic-900-master' },
        { courseIdx: 2, teacherIdx: 1, name: 'Lớp Phát Âm IPA Chuẩn Mỹ (Tối 2-4-6)', roomSuffix: 'pronunciation-k1' },
        { courseIdx: 2, teacherIdx: 1, name: 'Lớp Phản Xạ Giao Tiếp Hàng Ngày (Tối 3-5-7)', roomSuffix: 'speaking-k2' },
        { courseIdx: 3, teacherIdx: 2, name: 'Lớp Ngữ Pháp Trọng Tâm TOEIC (Tối 2-4-6)', roomSuffix: 'grammar-k1' },
        { courseIdx: 4, teacherIdx: 1, name: 'Lớp Tiếng Anh Qua Phim & Âm Nhạc (Tối 3-5-7)', roomSuffix: 'learn-movie-k1' },
        { courseIdx: 5, teacherIdx: 3, name: 'Lớp Business English & Email (Tối T7-CN)', roomSuffix: 'business-eng-k1' },
    ];
    const classes = [];
    for (const cc of classConfigs) {
        const cls = await prisma.class.create({
            data: {
                courseId: courses[cc.courseIdx].id,
                teacherId: teachers[cc.teacherIdx].id,
                name: cc.name,
                meetingLink: `https://breadtrans-kltn.daily.co/class-${cc.roomSuffix}`,
                status: client_1.ClassStatus.ONGOING,
            }
        });
        classes.push(cls);
    }
    for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const cls1 = classes[i % classes.length];
        const cls2 = classes[(i + 3) % classes.length];
        await prisma.enrollment.createMany({
            data: [
                { userId: student.id, classId: cls1.id, status: client_1.EnrollmentStatus.ACTIVE, progress: 35 + (i * 5) % 60 },
                { userId: student.id, classId: cls2.id, status: client_1.EnrollmentStatus.ACTIVE, progress: 20 + (i * 7) % 50 },
            ]
        });
    }
    for (let cIdx = 0; cIdx < classes.length; cIdx++) {
        const cls = classes[cIdx];
        const course = courses[cIdx % courses.length];
        const lesson = course.lessons[0];
        const pastSession = await prisma.session.create({
            data: {
                classId: cls.id,
                title: `Buổi 1: Giới thiệu lộ trình & Kiểm tra đầu vào`,
                startTime: new Date(Date.now() - 86400000 * 3),
                endTime: new Date(Date.now() - 86400000 * 3 + 7200000),
                meetingLink: cls.meetingLink,
                status: 'completed',
            }
        });
        const liveSession = await prisma.session.create({
            data: {
                classId: cls.id,
                title: `Buổi 2: Phương pháp luyện tập trọng tâm & Thực hành phản xạ`,
                startTime: new Date(Date.now() + 3600000 * 2),
                endTime: new Date(Date.now() + 3600000 * 4),
                meetingLink: cls.meetingLink,
                status: 'scheduled',
            }
        });
        await prisma.session.create({
            data: {
                classId: cls.id,
                title: `Buổi 3: Chữa bài tập về nhà & Đánh giá năng lực tuần`,
                startTime: new Date(Date.now() + 86400000 * 4),
                endTime: new Date(Date.now() + 86400000 * 4 + 7200000),
                meetingLink: cls.meetingLink,
                status: 'scheduled',
            }
        });
        for (let sIdx = 0; sIdx < 4; sIdx++) {
            const student = students[(cIdx + sIdx) % students.length];
            await prisma.attendance.create({
                data: {
                    sessionId: pastSession.id,
                    userId: student.id,
                    isPresent: sIdx !== 3,
                }
            });
        }
        if (lesson) {
            await prisma.material.createMany({
                data: [
                    {
                        lessonId: lesson.id,
                        title: `Giáo trình PDF: Tài Liệu Khóa Học ${course.title}`,
                        fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
                        fileType: 'PDF',
                    },
                    {
                        lessonId: lesson.id,
                        title: `Slide Bài Giảng Trọng Tâm (Key Notes)`,
                        fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
                        fileType: 'SLIDE',
                    },
                ]
            });
        }
    }
    console.log('📝 Seeding Assignments & Submissions...');
    for (let cIdx = 0; cIdx < 4; cIdx++) {
        const cls = classes[cIdx];
        const assignment = await prisma.assignment.create({
            data: {
                classId: cls.id,
                title: `Bài tập tuần 1: Viết đoạn văn ngắn & Phân tích ngữ pháp`,
                description: `Hãy viết một đoạn văn từ 80-120 từ mô tả về thói quen học tập tiếng Anh của bạn và chỉ ra ít nhất 3 cấu trúc ngữ pháp đã học.`,
                dueDate: new Date(Date.now() + 86400000 * 5),
            }
        });
        for (let sIdx = 0; sIdx < 2; sIdx++) {
            const student = students[(cIdx + sIdx) % students.length];
            await prisma.assignmentSubmission.create({
                data: {
                    assignmentId: assignment.id,
                    userId: student.id,
                    content: `English is an essential part of my daily routine. Every morning, I usually spend 30 minutes reading English articles and listening to podcasts. I have studied with BreadTrans for three weeks, and my confidence has improved significantly. If I keep practicing consistently, I will achieve my target score soon.`,
                    grade: 8.5 + sIdx * 0.5,
                    feedback: `Bài viết mạch lạc, sử dụng chính xác thì Hiện tại đơn, Hiện tại hoàn thành và câu điều kiện loại 1. Phát huy em nhé!`,
                    submittedAt: new Date(Date.now() - 86400000 * (sIdx + 1)),
                }
            });
        }
    }
    console.log('🗂️ Seeding Vocabulary Topics & Words...');
    const vocabTopicsData = [
        {
            title: 'Office & Workplace',
            categoryName: 'Business English',
            iconUrl: '💼',
            words: [
                { word: 'Schedule', pos: 'noun', meaning: 'Lịch trình, thời khóa biểu', ipaUs: '/ˈskedʒ.uːl/', exampleEn: 'I need to check my weekly work schedule.', exampleVi: 'Tôi cần kiểm tra lại lịch làm việc hàng tuần của mình.' },
                { word: 'Colleague', pos: 'noun', meaning: 'Đồng nghiệp', ipaUs: '/ˈkɑː.liːɡ/', exampleEn: 'I get along very well with my colleagues.', exampleVi: 'Tôi hòa thuận rất tốt với các đồng nghiệp của mình.' },
                { word: 'Deadline', pos: 'noun', meaning: 'Hạn chót', ipaUs: '/ˈded.laɪn/', exampleEn: 'The project deadline is this Friday at 5 PM.', exampleVi: 'Hạn chót của dự án là 5 giờ chiều thứ Sáu tuần này.' },
                { word: 'Negotiate', pos: 'verb', meaning: 'Đàm phán, thương lượng', ipaUs: '/nəˈɡoʊ.ʃi.eɪt/', exampleEn: 'The manager negotiated a favorable contract.', exampleVi: 'Người quản lý đã đàm phán được một hợp đồng thuận lợi.' },
                { word: 'Presentation', pos: 'noun', meaning: 'Bài thuyết trình', ipaUs: '/ˌprez.ənˈteɪ.ʃən/', exampleEn: 'She delivered an outstanding presentation.', exampleVi: 'Cô ấy đã trình bày một bài thuyết trình xuất sắc.' },
                { word: 'Equipment', pos: 'noun', meaning: 'Thiết bị, dụng cụ', ipaUs: '/ɪˈkwɪp.mənt/', exampleEn: 'The company invested in modern office equipment.', exampleVi: 'Công ty đã đầu tư vào trang thiết bị văn phòng hiện đại.' },
                { word: 'Proposal', pos: 'noun', meaning: 'Bản đề xuất', ipaUs: '/prəˈpoʊ.zəl/', exampleEn: 'We submitted the annual budget proposal.', exampleVi: 'Chúng tôi đã nộp bản đề xuất ngân sách hàng năm.' },
                { word: 'Conference', pos: 'noun', meaning: 'Hội nghị, hội thảo', ipaUs: '/ˈkɑːn.fɚ.əns/', exampleEn: 'The international sales conference is in Tokyo.', exampleVi: 'Hội nghị bán hàng quốc tế được tổ chức tại Tokyo.' },
                { word: 'Promote', pos: 'verb', meaning: 'Thăng chức, quảng bá', ipaUs: '/prəˈmoʊt/', exampleEn: 'He was promoted to senior manager last month.', exampleVi: 'Anh ấy đã được thăng chức lên quản lý cấp cao vào tháng trước.' },
                { word: 'Supervise', pos: 'verb', meaning: 'Giám sát, quản lý', ipaUs: '/ˈsuː.pɚ.vaɪz/', exampleEn: 'She supervises a team of ten engineers.', exampleVi: 'Cô ấy giám sát một đội ngũ gồm mười kỹ sư.' },
            ]
        },
        {
            title: 'Travel & Hospitality',
            categoryName: 'Daily English',
            iconUrl: '✈️',
            words: [
                { word: 'Reservation', pos: 'noun', meaning: 'Sự đặt chỗ trước', ipaUs: '/ˌrez.ɚˈveɪ.ʃən/', exampleEn: 'I made a hotel reservation for three nights.', exampleVi: 'Tôi đã đặt phòng khách sạn trước cho 3 đêm.' },
                { word: 'Passenger', pos: 'noun', meaning: 'Hành khách', ipaUs: '/ˈpæs.ən.dʒɚ/', exampleEn: 'All passengers must board through Gate 4.', exampleVi: 'Tất cả hành khách phải lên máy bay qua Cổng số 4.' },
                { word: 'Luggage', pos: 'noun', meaning: 'Hành lý', ipaUs: '/ˈlʌɡ.ɪdʒ/', exampleEn: 'You can store your luggage in the overhead bin.', exampleVi: 'Bạn có thể để hành lý trong ngăn chứa phía trên đầu.' },
                { word: 'Departure', pos: 'noun', meaning: 'Sự khởi hành', ipaUs: '/dɪˈpɑːr.tʃɚ/', exampleEn: 'The departure time was delayed due to bad weather.', exampleVi: 'Thời gian khởi hành bị hoãn do thời tiết xấu.' },
                { word: 'Destination', pos: 'noun', meaning: 'Điểm đến', ipaUs: '/ˌdes.təˈneɪ.ʃən/', exampleEn: 'Da Nang is a wonderful vacation destination.', exampleVi: 'Đà Nẵng là một điểm đến nghỉ dưỡng tuyệt vời.' },
                { word: 'Itinerary', pos: 'noun', meaning: 'Lịch trình chuyến đi', ipaUs: '/aɪˈtɪn.ə.rer.i/', exampleEn: 'Please review the travel itinerary carefully.', exampleVi: 'Vui lòng xem lại lịch trình chuyến đi một cách cẩn thận.' },
                { word: 'Accommodation', pos: 'noun', meaning: 'Chỗ ở, nơi lưu trú', ipaUs: '/əˌkɑː.məˈdeɪ.ʃən/', exampleEn: 'The package tour includes luxury accommodation.', exampleVi: 'Tour trọn gói bao gồm chỗ ở sang trọng.' },
                { word: 'Passport', pos: 'noun', meaning: 'Hộ chiếu', ipaUs: '/ˈpæs.pɔːrt/', exampleEn: 'Make sure your passport is valid for at least 6 months.', exampleVi: 'Hãy đảm bảo hộ chiếu của bạn còn hạn ít nhất 6 tháng.' },
            ]
        },
        {
            title: 'Technology & Innovation',
            categoryName: 'Academic English',
            iconUrl: '💻',
            words: [
                { word: 'Innovation', pos: 'noun', meaning: 'Sự đổi mới, sáng tạo', ipaUs: '/ˌɪn.əˈveɪ.ʃən/', exampleEn: 'Technological innovation improves efficiency.', exampleVi: 'Đổi mới công nghệ giúp cải thiện hiệu suất.' },
                { word: 'Artificial', pos: 'adj', meaning: 'Nhân tạo', ipaUs: '/ˌɑːr.t̬əˈfɪʃ.əl/', exampleEn: 'Artificial intelligence is changing the world.', exampleVi: 'Trí tuệ nhân tạo đang làm thay đổi thế giới.' },
                { word: 'Automate', pos: 'verb', meaning: 'Tự động hóa', ipaUs: '/ˈɑː.t̬ə.meɪt/', exampleEn: 'We automated the repetitive billing process.', exampleVi: 'Chúng tôi đã tự động hóa quy trình thanh toán lặp đi lặp lại.' },
                { word: 'Security', pos: 'noun', meaning: 'An ninh, bảo mật', ipaUs: '/səˈkjʊr.ə.t̬i/', exampleEn: 'Data security is our highest priority.', exampleVi: 'Bảo mật dữ liệu là ưu tiên hàng đầu của chúng tôi.' },
                { word: 'Upgrade', pos: 'verb', meaning: 'Nâng cấp', ipaUs: '/ʌpˈɡreɪd/', exampleEn: 'You should upgrade the software to the latest version.', exampleVi: 'Bạn nên nâng cấp phần mềm lên phiên bản mới nhất.' },
                { word: 'Database', pos: 'noun', meaning: 'Cơ sở dữ liệu', ipaUs: '/ˈdeɪ.t̬ə.beɪs/', exampleEn: 'Customer records are stored securely in the database.', exampleVi: 'Hồ sơ khách hàng được lưu trữ an toàn trong cơ sở dữ liệu.' },
            ]
        },
        {
            title: 'Food & Dining',
            categoryName: 'Daily English',
            iconUrl: '🍽️',
            words: [
                { word: 'Appetizer', pos: 'noun', meaning: 'Món khai vị', ipaUs: '/ˈæp.ə.taɪ.zɚ/', exampleEn: 'We ordered crispy spring rolls as an appetizer.', exampleVi: 'Chúng tôi đã gọi chả giò giòn làm món khai vị.' },
                { word: 'Beverage', pos: 'noun', meaning: 'Đồ uống, nước giải khát', ipaUs: '/ˈbev.ɚ.ɪdʒ/', exampleEn: 'Hot and cold beverages are available at the bar.', exampleVi: 'Đồ uống nóng và lạnh luôn có sẵn tại quầy bar.' },
                { word: 'Nutritious', pos: 'adj', meaning: 'Bổ dưỡng, giàu dinh dưỡng', ipaUs: '/nuːˈtrɪʃ.əs/', exampleEn: 'A balanced diet should include nutritious foods.', exampleVi: 'Một chế độ ăn cân bằng nên bao gồm các thực phẩm bổ dưỡng.' },
                { word: 'Delicious', pos: 'adj', meaning: 'Ngon miệng', ipaUs: '/dɪˈlɪʃ.əs/', exampleEn: 'Vietnamese bread (Bánh Mì) is truly delicious.', exampleVi: 'Bánh mì Việt Nam thực sự rất ngon.' },
            ]
        }
    ];
    for (const vt of vocabTopicsData) {
        await prisma.vocabTopic.create({
            data: {
                title: vt.title,
                categoryName: vt.categoryName,
                iconUrl: vt.iconUrl,
                totalWords: vt.words.length,
                isPro: false,
                words: {
                    create: vt.words.map(w => ({
                        word: w.word,
                        pos: w.pos,
                        meaning: w.meaning,
                        ipaUs: w.ipaUs,
                        exampleEn: w.exampleEn,
                        exampleVi: w.exampleVi,
                        audioUs: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(w.word)}&type=2`,
                    }))
                }
            }
        });
    }
    console.log('📖 Seeding Practice Topics & Grammar Quizzes...');
    const grammarPracticeData = [
        {
            name: 'Nouns & Suffixes',
            vietnameseName: 'Danh Từ & Hậu Tố Nhận Biết',
            category: client_1.TopicCategory.GRAMMAR_TOPIC,
            order: 1,
            quizTitle: 'Trắc Nghiệm Hậu Tố Danh Từ (Part 5 TOEIC)',
            theory: 'Đứng sau tính từ, mạo từ (a, an, the), giới từ hoặc tính từ sở hữu cần một danh từ. Các đuôi danh từ phổ biến: -tion, -sion, -ment, -ness, -ity, -ance, -ence.',
            questions: [
                { text: 'Customer _______ is our corporation\'s top priority this quarter.', options: ['satisfy', 'satisfaction', 'satisfactory', 'satisfied'], correct: 'satisfaction', exp: 'Đứng sau danh từ ghép "Customer" cần danh từ "satisfaction" (Sự hài lòng của khách hàng).' },
                { text: 'The new manager showed remarkable _______ during the team transition.', options: ['lead', 'leader', 'leadership', 'leading'], correct: 'leadership', exp: 'Sau tính từ "remarkable" cần danh từ trừu tượng "leadership" (khả năng lãnh đạo).' },
                { text: 'Please submit your _______ before Friday afternoon.', options: ['apply', 'applicant', 'application', 'applicable'], correct: 'application', exp: 'Sau tính từ sở hữu "your" và động từ "submit" cần danh từ chỉ sự việc "application" (đơn ứng tuyển).' },
            ]
        },
        {
            name: 'Tenses in Business Context',
            vietnameseName: 'Các Thì Trong Môi Trường Công Sở',
            category: client_1.TopicCategory.GRAMMAR_TOPIC,
            order: 2,
            quizTitle: 'Phân Biệt Hiện Tại Đơn, Quá Khứ Đơn & Hiện Tại Hoàn Thành',
            theory: 'Hiện tại đơn chỉ thói quen/lịch trình; Quá khứ đơn chỉ việc đã xong trong quá khứ (yesterday, ago, last); Hiện tại hoàn thành có since, for, yet, already.',
            questions: [
                { text: 'Mr. David usually _______ the weekly sales report every Monday morning.', options: ['submits', 'submitted', 'submitting', 'submit'], correct: 'submits', exp: 'Có trạng từ tần suất "usually" và chủ ngữ số ít "Mr. David" -> chia hiện tại đơn: submits.' },
                { text: 'Since we adopted the new system, productivity _______ by 25 percent.', options: ['increased', 'has increased', 'increases', 'is increasing'], correct: 'has increased', exp: 'Cấu trúc "Since + mốc QK, Mệnh đề chính chia Hiện tại hoàn thành" (has increased).' },
                { text: 'The marketing team _______ the final proposal yesterday evening.', options: ['finalize', 'finalized', 'has finalized', 'finalizing'], correct: 'finalized', exp: 'Có "yesterday evening" chỉ thời điểm xác định trong quá khứ -> dùng Quá khứ đơn: finalized.' },
            ]
        },
        {
            name: 'Passive Voice Mastery',
            vietnameseName: 'Câu Bị Động Chuyên Sâu',
            category: client_1.TopicCategory.GRAMMAR_TOPIC,
            order: 3,
            quizTitle: 'Bị Động Trong Các Thông Báo & Hợp Đồng TOEIC',
            theory: 'Cấu trúc bị động: S + be + V3/V-ed. Chú ý thì của câu và dạng bị động với Modal Verbs (must be done, should be checked).',
            questions: [
                { text: 'All safety guidelines must be strictly _______ by factory workers.', options: ['observe', 'observed', 'observing', 'observation'], correct: 'observed', exp: 'Bị động với modal verb: must be + V3/V-ed (must be strictly observed).' },
                { text: 'The signed contract was _______ to the client via express mail yesterday.', options: ['deliver', 'delivering', 'delivered', 'delivery'], correct: 'delivered', exp: 'Bị động quá khứ đơn: was + V3/V-ed (was delivered).' },
            ]
        }
    ];
    for (const gp of grammarPracticeData) {
        await prisma.practiceTopic.create({
            data: {
                name: gp.name,
                vietnameseName: gp.vietnameseName,
                category: gp.category,
                order: gp.order,
                quizzes: {
                    create: [
                        {
                            title: gp.quizTitle,
                            type: client_1.QuizType.TOEIC,
                            theoryContent: gp.theory,
                            questions: {
                                create: gp.questions.map((q, idx) => ({
                                    type: 'MULTIPLE_CHOICE',
                                    order: idx + 1,
                                    content: {
                                        text: q.text,
                                        options: q.options,
                                        correctAnswer: q.correct,
                                        explanation: q.exp,
                                    }
                                }))
                            }
                        }
                    ]
                }
            }
        });
    }
    console.log('🎓 Seeding Grammar Topics with Video lessons...');
    const grammarVideoTopics = [
        {
            title: 'Thì Hiện Tại Đơn (Present Simple Tense)',
            level: 'BEGINNER',
            description: 'Chủ điểm ngữ pháp căn bản nhất trong bài thi TOEIC Part 5 & 6, diễn tả thói quen, chân lý và lịch trình cố định.',
            videoYoutubeId: '10r9ke8Gg3Y',
            keyFormula: 'Khẳng định: S + V(s/es) + O | Phủ định: S + do/does not + V_inf | Nghi vấn: Do/Does + S + V_inf?',
            order: 1,
            questions: [
                {
                    question: 'Mr. David usually _______ the financial report by 5 PM every Friday.',
                    options: ['submits', 'submit', 'submitting', 'submitted'],
                    correctIndex: 0,
                    explanation: 'Chủ ngữ "Mr. David" là ngôi thứ 3 số ít, có trạng từ chỉ tần suất "usually" chỉ thói quen lặp đi lặp lại nên động từ chia ở hiện tại đơn thêm "s": submits.',
                    order: 1,
                },
                {
                    question: 'The flight to Tokyo _______ at 9:30 AM tomorrow according to the timetable.',
                    options: ['departs', 'departed', 'will be departing', 'depart'],
                    correctIndex: 0,
                    explanation: 'Thì hiện tại đơn được dùng để diễn tả lịch trình tàu xe, máy bay cố định (timetable/schedule) trong tương lai.',
                    order: 2,
                },
            ]
        },
        {
            title: 'Thì Hiện Tại Hoàn Thành (Present Perfect Tense)',
            level: 'INTERMEDIATE',
            description: 'Diễn tả hành động đã xảy ra trong quá khứ và vẫn còn ảnh hưởng hoặc tiếp diễn đến hiện tại. Rất phổ biến với since, for, already, yet.',
            videoYoutubeId: 'j9Yd_0G63bU',
            keyFormula: 'S + have/has + V3/V-ed (+ since + mốc thời gian / for + khoảng thời gian)',
            order: 2,
            questions: [
                {
                    question: 'The CEO _______ in this corporation for more than twenty years.',
                    options: ['has worked', 'works', 'is working', 'worked'],
                    correctIndex: 0,
                    explanation: 'Có dấu hiệu "for more than twenty years" diễn tả hành động bắt đầu trong quá khứ và kéo dài đến nay -> dùng Present Perfect: has worked.',
                    order: 1,
                },
            ]
        },
        {
            title: 'Câu Bị Động (Passive Voice)',
            level: 'INTERMEDIATE',
            description: 'Trọng tâm bài thi TOEIC Part 5. Nhấn mạnh vào đối tượng tiếp nhận hành động thay vì người thực hiện.',
            videoYoutubeId: 'nkA_K_h7KjY',
            keyFormula: 'S + be + V3/V-ed (+ by + O)',
            order: 3,
            questions: [
                {
                    question: 'All safety guidelines must be strictly _______ by every employee on site.',
                    options: ['observe', 'observed', 'observing', 'observant'],
                    correctIndex: 1,
                    explanation: 'Cấu trúc bị động với động từ khuyết thiếu: Modal verb + be + V3/V-ed (must be observed).',
                    order: 1,
                },
            ]
        },
    ];
    for (const gt of grammarVideoTopics) {
        await prisma.grammarTopic.create({
            data: {
                title: gt.title,
                level: gt.level,
                description: gt.description,
                videoYoutubeId: gt.videoYoutubeId,
                keyFormula: gt.keyFormula,
                order: gt.order,
                questions: {
                    create: gt.questions.map(q => ({
                        question: q.question,
                        options: q.options,
                        correctIndex: q.correctIndex,
                        explanation: q.explanation,
                        order: q.order,
                    }))
                }
            }
        });
    }
    console.log('🏆 Seeding TOEIC Exam Sets...');
    await prisma.toeicExamSet.create({
        data: {
            title: 'Đề Thi Thử TOEIC Rút Gọn Chuẩn Format 2026',
            description: 'Đề thi mô phỏng định dạng chuẩn ETS với các câu hỏi trọng tâm Part 1, Part 2, Part 5 và Part 7.',
            difficulty: 'Trung bình',
            createdBy: teachers[0].id,
            groups: {
                create: [
                    {
                        part: 1,
                        groupOrder: 1,
                        imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&auto=format&fit=crop&q=80',
                        audioUrl: 'https://actions.google.com/sounds/v1/ambiences/office.ogg',
                        questions: {
                            create: [
                                {
                                    questionNumber: 1,
                                    text: 'Look at the image and choose the best description.',
                                    options: [
                                        '(A) They are discussing a document around the table.',
                                        '(B) The man is fixing a laptop computer.',
                                        '(C) People are leaving the conference hall.',
                                        '(D) Someone is writing on the whiteboard.'
                                    ],
                                    correctIndex: 0,
                                    explanation: 'Bức tranh miêu tả nhóm đồng nghiệp đang thảo luận về tài liệu quanh bàn làm việc.'
                                }
                            ]
                        }
                    },
                    {
                        part: 5,
                        groupOrder: 2,
                        questions: {
                            create: [
                                {
                                    questionNumber: 2,
                                    text: 'Ms. Clara requested that the financial audit report _______ submitted by noon.',
                                    options: ['is', 'be', 'was', 'being'],
                                    correctIndex: 1,
                                    explanation: 'Cấu trúc giả định (Subjunctive): S + request/recommend + that + S + (should) + V_inf (be submitted).'
                                },
                                {
                                    questionNumber: 3,
                                    text: 'The new office software operates much more _______ than the previous version.',
                                    options: ['efficient', 'efficiency', 'efficiently', 'efficiencies'],
                                    correctIndex: 2,
                                    explanation: 'Bổ nghĩa cho động từ "operates" cần một trạng từ "efficiently" (vận hành hiệu quả hơn).'
                                }
                            ]
                        }
                    }
                ]
            }
        }
    });
    console.log('🎙️ Seeding Speaking Exercises...');
    const speakingExercises = [
        { title: 'Tự Giới Thiệu Bản Thân', targetText: 'Hello everyone! My name is Nam, and I am excited to join the BreadTrans English class.', difficulty: 'BEGINNER', category: 'GENERAL' },
        { title: 'Chào Hỏi Đồng Nghiệp', targetText: 'Good morning! It is wonderful to collaborate with you on this upcoming project.', difficulty: 'BEGINNER', category: 'OFFICE' },
        { title: 'Gọi Món Tại Quán Cafe', targetText: 'Could I please get an iced caramel macchiato with less sugar and extra oat milk?', difficulty: 'BEGINNER', category: 'DAILY' },
        { title: 'Hỏi Đường Đi Điểm Đến', targetText: 'Excuse me, could you tell me the fastest way to get to the central train station?', difficulty: 'BEGINNER', category: 'TRAVEL' },
        { title: 'Mở Đầu Bài Thuyết Trình', targetText: 'Today, I would like to present our quarterly financial achievements and marketing strategies.', difficulty: 'INTERMEDIATE', category: 'BUSINESS' },
        { title: 'Thương Thảo Thời Hạn Hợp Đồng', targetText: 'We would appreciate it if you could extend the project deadline by two business weeks.', difficulty: 'INTERMEDIATE', category: 'BUSINESS' },
        { title: 'Phỏng Vấn Xin Việc (Thế Mạnh)', targetText: 'My greatest strength is my problem-solving ability and strong commitment to continuous learning.', difficulty: 'ADVANCED', category: 'CAREER' },
        { title: 'Giải Quyết Khiếu Nại Khách Hàng', targetText: 'I sincerely apologize for the inconvenience caused, and we will issue an immediate refund.', difficulty: 'ADVANCED', category: 'CUSTOMER_SERVICE' },
    ];
    for (const se of speakingExercises) {
        await prisma.speakingExercise.create({ data: se });
    }
    console.log('🎬 Seeding Content Topics (Movies & Music)...');
    const contentTopics = [
        {
            topicId: 'movie-zootopia-interview',
            category: 'movie',
            title: 'Zootopia: Judy Hopps Phỏng Vấn Tuyển Dụng',
            order: 1,
            materialLinks: {
                youtubeId: 'jWM0ct-OLsM',
                thumbnail: 'https://img.youtube.com/vi/jWM0ct-OLsM/maxresdefault.jpg',
                duration: '3:45',
                level: 'BEGINNER',
                description: 'Luyện nghe phản xạ giao tiếp tiếng Anh công sở qua đoạn hội thoại tuyển dụng trong phim Zootopia.',
            },
            exercises: [
                { id: 1, question: 'Judy Hopps cảm thấy như thế nào khi nhận nhiệm vụ đầu tiên?', options: ['Hào hứng và quyết tâm', 'Thất vọng và muốn bỏ cuộc', 'Sợ hãi', 'Tức giận'], correctIndex: 0, explanation: 'Judy luôn giữ tinh thần lạc quan và nói: "I won\'t let you down!"' },
                { id: 2, question: 'Từ "Traffic Duty" trong video có nghĩa là gì?', options: ['Nhiệm vụ điều phối giao thông', 'Điều tra trọng án', 'Bảo vệ tổng thống', 'Lập biên bản phạt đậu xe'], correctIndex: 0, explanation: 'Traffic Duty nghĩa là nhiệm vụ điều tiết, kiểm soát giao thông.' }
            ]
        },
        {
            topicId: 'movie-coco-remember-me',
            category: 'movie',
            title: 'Coco: Bài Hát Remember Me & Tình Cảm Gia Đình',
            order: 2,
            materialLinks: {
                youtubeId: 'E7s5h7BvT6Q',
                thumbnail: 'https://img.youtube.com/vi/E7s5h7BvT6Q/maxresdefault.jpg',
                duration: '4:10',
                level: 'INTERMEDIATE',
                description: 'Khám phá từ vựng miêu tả ký ức, tình cảm gia đình và giai điệu ấm áp của phim hoạt hình Coco.',
            },
            exercises: [
                { id: 1, question: 'Cụm từ "Remember me though I have to say goodbye" mang ý nghĩa gì?', options: ['Hãy nhớ đến tôi dù tôi phải nói lời tạm biệt', 'Đừng quên tôi khi bạn đi xa', 'Chào tạm biệt mọi người', 'Hãy giữ lại những bức ảnh cũ'], correctIndex: 0, explanation: '"Though" = Mặc dù, "say goodbye" = nói lời tạm biệt.' }
            ]
        },
        {
            topicId: 'movie-inside-out-emotions',
            category: 'movie',
            title: 'Inside Out: Khám Phá Cảm Xúc Hỉ Nộ Ái Ố',
            order: 3,
            materialLinks: {
                youtubeId: 'yRUAzGQ3nSY',
                thumbnail: 'https://img.youtube.com/vi/yRUAzGQ3nSY/maxresdefault.jpg',
                duration: '3:50',
                level: 'BEGINNER',
                description: 'Học các tính từ và danh từ miêu tả cảm xúc con người qua các nhân vật Joy, Sadness, Anger, Fear, Disgust.',
            },
            exercises: [
                { id: 1, question: 'Nhân vật "Joy" trong phim đại diện cho cảm xúc nào?', options: ['Niềm vui, hạnh phúc', 'Sự tức giận', 'Sự sợ hãi', 'Nỗi buồn'], correctIndex: 0, explanation: '"Joy" có nghĩa là niềm vui sướng hân hoan.' }
            ]
        },
        {
            topicId: 'movie-lion-king-hakuna-matata',
            category: 'movie',
            title: 'The Lion King: Hakuna Matata - Lối Sống Tích Cực',
            order: 4,
            materialLinks: {
                youtubeId: 'nbY_aP-alkw',
                thumbnail: 'https://img.youtube.com/vi/nbY_aP-alkw/maxresdefault.jpg',
                duration: '4:05',
                level: 'INTERMEDIATE',
                description: 'Cụm từ Hakuna Matata kinh điển mang thông điệp không âu lo và cách kết hợp thì hiện tại trong lời thoại.',
            },
            exercises: [
                { id: 1, question: '"Hakuna Matata" theo lời giải thích của Timon & Pumbaa có nghĩa là gì?', options: ['No worries (Không có gì phải lo lắng)', 'Eat well (Ăn ngon miệng)', 'Run fast (Chạy nhanh lên)', 'Good morning (Chào buổi sáng)'], correctIndex: 0, explanation: '"It means no worries for the rest of your days".' }
            ]
        },
        {
            topicId: 'music-count-on-me-bruno',
            category: 'music',
            title: 'Count On Me - Bruno Mars (Bài Ca Tình Bạn)',
            order: 1,
            materialLinks: {
                youtubeId: 'Yc6T9iY9rs8',
                thumbnail: 'https://img.youtube.com/vi/Yc6T9iY9rs8/maxresdefault.jpg',
                duration: '3:15',
                level: 'BEGINNER',
                description: 'Học các cụm từ đếm số, thì hiện tại đơn và câu điều kiện loại 1 qua ca khúc kinh điển về tình bạn.',
            },
            exercises: [
                { id: 1, question: 'Cụm từ "Count on me" có nghĩa là gì trong tiếng Anh?', options: ['Hãy tin tưởng / Trông cậy vào tôi', 'Hãy đếm số cùng tôi', 'Hãy tính toán tiền nong', 'Hãy đi cùng tôi'], correctIndex: 0, explanation: '"Count on someone" là một idiom phổ biến có nghĩa là tin tưởng, trông cậy vào ai đó.' }
            ]
        },
        {
            topicId: 'music-try-everything-shakira',
            category: 'music',
            title: 'Try Everything - Shakira (Không Ngại Thất Bại)',
            order: 2,
            materialLinks: {
                youtubeId: 'c6rP-YP4c5I',
                thumbnail: 'https://img.youtube.com/vi/c6rP-YP4c5I/maxresdefault.jpg',
                duration: '3:20',
                level: 'INTERMEDIATE',
                description: 'Nạp năng lượng học tiếng Anh với các động từ hành động mạnh mẽ và thông điệp kiên trì vượt qua khó khăn.',
            },
            exercises: [
                { id: 1, question: 'Ý nghĩa của thông điệp "I won\'t give up, no I won\'t give in" là gì?', options: ['Tôi sẽ không bỏ cuộc, không đầu hàng', 'Tôi sẽ từ bỏ sớm', 'Tôi không muốn tiếp tục', 'Tôi rất mệt mỏi'], correctIndex: 0, explanation: '"Give up" = bỏ cuộc, "Give in" = nhượng bộ/đầu hàng.' }
            ]
        },
        {
            topicId: 'music-whole-new-world-aladdin',
            category: 'music',
            title: 'A Whole New World - Aladdin (Thế Giới Diệu Kỳ)',
            order: 3,
            materialLinks: {
                youtubeId: 'eitDnP0_83k',
                thumbnail: 'https://img.youtube.com/vi/eitDnP0_83k/maxresdefault.jpg',
                duration: '4:12',
                level: 'INTERMEDIATE',
                description: 'Học các tính từ miêu tả cảnh quan tráng lệ như "shining, shimmering, splendid" cùng ca khúc huyền thoại Aladdin.',
            },
            exercises: [
                { id: 1, question: 'Các từ "shining, shimmering, splendid" dùng để miêu tả điều gì?', options: ['Vẻ đẹp lấp lánh, tráng lệ', 'Sự tối tăm, u ám', 'Sự ồn ào náo nhiệt', 'Sự lạnh lẽo'], correctIndex: 0, explanation: '"Shimmering" = lấp lánh lung linh, "splendid" = tuyệt vời, tráng lệ.' }
            ]
        },
        {
            topicId: 'music-heal-the-world-mj',
            category: 'music',
            title: 'Heal The World - Michael Jackson (Vì Một Thế Giới Tốt Đẹp Hơn)',
            order: 4,
            materialLinks: {
                youtubeId: 'BWf-eARnf6U',
                thumbnail: 'https://img.youtube.com/vi/BWf-eARnf6U/maxresdefault.jpg',
                duration: '5:20',
                level: 'ADVANCED',
                description: 'Mở rộng vốn từ vựng về nhân loại, hòa bình và cấu trúc câu mệnh lệnh truyền cảm hứng.',
            },
            exercises: [
                { id: 1, question: '"Heal the world, make it a better place" mang thông điệp gì?', options: ['Hàn gắn thế giới, biến nó thành nơi tốt đẹp hơn', 'Bảo vệ tài chính cá nhân', 'Xây dựng nhà máy mới', 'Học cách làm giàu'], correctIndex: 0, explanation: '"Heal" = chữa lành/hàn gắn, "better place" = nơi tốt đẹp hơn.' }
            ]
        }
    ];
    for (const ct of contentTopics) {
        await prisma.contentTopic.create({
            data: {
                topicId: ct.topicId,
                category: ct.category,
                title: ct.title,
                order: ct.order,
                materialLinks: ct.materialLinks,
                exercises: ct.exercises,
            }
        });
    }
    console.log('🎯 Seeding Daily Quests...');
    const dailyQuests = [
        { title: 'Học 10 từ vựng Flashcard mới', description: 'Ghi nhớ và hoàn thành lượt ôn tập 10 từ vựng', targetValue: 10, type: 'LEARN_VOCAB', rewardXP: 30, rewardBanh: 15 },
        { title: 'Đạt điểm tối đa trong 1 Quiz', description: 'Hoàn thành bài tập trắc nghiệm đúng 100%', targetValue: 1, type: 'PERFECT_QUIZ', rewardXP: 50, rewardBanh: 25 },
        { title: 'Luyện nói 1 câu phát âm AI', description: 'Ghi âm và nhận chấm điểm từ AI Speaking Tutor', targetValue: 1, type: 'DO_SPEAKING', rewardXP: 40, rewardBanh: 20 },
        { title: 'Xem 1 video bài học Phim/Nhạc', description: 'Theo dõi video và hoàn thành bài tập nghe hiểu', targetValue: 1, type: 'WATCH_VIDEO', rewardXP: 35, rewardBanh: 15 },
    ];
    for (const dq of dailyQuests) {
        await prisma.dailyQuest.create({ data: dq });
    }
    console.log('\n🎉 ==========================================');
    console.log('✅ ALL SEED DATA GENERATED SUCCESSFULLY!');
    console.log(`- Users: ${1 + teachers.length + students.length} (1 Admin, ${teachers.length} Teachers, ${students.length} Students)`);
    console.log(`- Courses: ${courses.length}`);
    console.log(`- Classes: ${classes.length}`);
    console.log(`- Market Products: ${products.length}`);
    console.log(`- Vocab Topics: ${vocabTopicsData.length} topics`);
    console.log(`- Practice Topics: ${grammarPracticeData.length}`);
    console.log(`- Grammar Video Topics: ${grammarVideoTopics.length}`);
    console.log(`- Speaking Exercises: ${speakingExercises.length}`);
    console.log(`- Content Topics: ${contentTopics.length}`);
    console.log(`- Daily Quests: ${dailyQuests.length}`);
    console.log('==========================================\n');
}
main()
    .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map