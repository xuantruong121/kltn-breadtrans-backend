"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding bilingual topics...');
    const nounTopic = await prisma.practiceTopic.create({
        data: {
            name: 'Nouns',
            vietnameseName: 'Danh từ',
            category: client_1.TopicCategory.GRAMMAR_TOPIC,
            order: 1,
            quizzes: {
                create: [
                    {
                        title: 'Hậu tố từ loại Danh Từ',
                        type: client_1.QuizType.TOEIC,
                        theoryContent: `
## CÁCH NHẬN BIẾT CÂU TỪ LOẠI
Bạn nhận biết câu từ loại khi **4 lựa chọn A, B, C, D** có cùng gốc từ nhưng mang các hậu tố (đuôi) khác nhau, biểu thị các loại từ khác nhau.
### Ví dụ:
The new manager is responsible for the overall ______ of the team.
(A) effective (tính từ)
(B) effectively (trạng từ)
(C) effectiveness (danh từ)
(D) effect (danh từ / động từ)

**Giải thích:** Đứng sau tính từ "overall" cần một danh từ. Chọn C.
            `,
                        questions: {
                            create: [
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'The new manager is responsible for the overall ______ of the team.',
                                        options: ['effective', 'effectively', 'effectiveness', 'effect'],
                                        correctAnswer: 'effectiveness'
                                    },
                                    order: 1
                                },
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'Customer ______ is our top priority.',
                                        options: ['satisfy', 'satisfaction', 'satisfactory', 'satisfied'],
                                        correctAnswer: 'satisfaction'
                                    },
                                    order: 2
                                }
                            ]
                        }
                    }
                ]
            }
        }
    });
    const verbTopic = await prisma.practiceTopic.create({
        data: {
            name: 'Verbs',
            vietnameseName: 'Động từ',
            category: client_1.TopicCategory.GRAMMAR_TOPIC,
            order: 2
        }
    });
    const level1 = await prisma.practiceTopic.create({
        data: {
            name: 'Level 1 - Dễ',
            vietnameseName: 'Tỉ lệ sai: 3% - 11%',
            category: client_1.TopicCategory.GRAMMAR_LEVEL,
            order: 1
        }
    });
    const mock2026 = await prisma.practiceTopic.create({
        data: {
            name: '2026',
            vietnameseName: 'Bộ đề mô phỏng mới nhất',
            category: client_1.TopicCategory.GRAMMAR_MOCK_TEST,
            order: 1
        }
    });
    const bilingualLevel1 = await prisma.practiceTopic.create({
        data: {
            name: 'Level 1',
            category: client_1.TopicCategory.BILINGUAL_LEVEL,
            order: 1,
            quizzes: {
                create: [
                    {
                        title: 'Company Lunch Party (E-mail)',
                        type: client_1.QuizType.BILINGUAL_READING,
                        bilingualContent: [
                            { en: "To: All Staff", vi: "Tới: Toàn thể nhân viên" },
                            { en: "From: HR Department", vi: "Từ: Phòng Nhân sự" },
                            { en: "Subject: Company Lunch Party", vi: "Chủ đề: Tiệc trưa công ty" },
                            { en: "We are happy to announce a company lunch party on Friday, March 10.", vi: "Chúng tôi rất vui mừng thông báo về bữa tiệc trưa của công ty vào thứ Sáu, ngày 10 tháng 3." },
                            { en: "The event will start at 12:00 p.m. in the main office hall.", vi: "Sự kiện sẽ bắt đầu lúc 12 giờ trưa tại hội trường chính của văn phòng." },
                            { en: "This party is organized to celebrate our successful year.", vi: "Bữa tiệc này được tổ chức để kỷ niệm một năm thành công của chúng ta." },
                            { en: "All employees are invited to attend.", vi: "Tất cả nhân viên đều được mời tham dự." },
                            { en: "Lunch and drinks will be free of charge.", vi: "Bữa trưa và đồ uống sẽ được miễn phí." },
                            { en: "Please confirm your attendance by March 7 by sending an email to the HR Department.", vi: "Vui lòng xác nhận sự tham gia của bạn trước ngày 7 tháng 3 bằng cách gửi email cho Phòng Nhân sự." }
                        ],
                        questions: {
                            create: [
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'What is the purpose of the email?',
                                        options: ['To change work hours', 'To announce a party', 'To introduce a new manager', 'To sell food'],
                                        correctAnswer: 'To announce a party'
                                    },
                                    order: 1
                                },
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'Where will the party take place?',
                                        options: ['In the HR office', 'In a restaurant', 'In the main office hall', 'In a meeting room'],
                                        correctAnswer: 'In the main office hall'
                                    },
                                    order: 2
                                }
                            ]
                        }
                    },
                    {
                        title: 'Computer Training Session (Notice)',
                        type: client_1.QuizType.BILINGUAL_READING,
                        bilingualContent: [
                            { en: "A computer training session will be held next Monday.", vi: "Một buổi đào tạo máy tính sẽ được tổ chức vào thứ Hai tới." },
                            { en: "All new employees must attend this session.", vi: "Tất cả nhân viên mới phải tham dự buổi này." }
                        ],
                        questions: {
                            create: [
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'Who must attend the session?',
                                        options: ['All employees', 'New employees', 'Managers', 'Clients'],
                                        correctAnswer: 'New employees'
                                    },
                                    order: 1
                                }
                            ]
                        }
                    }
                ]
            }
        }
    });
    console.log('Seeding completed successfully!');
}
main()
    .catch(e => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed-bilingual.js.map