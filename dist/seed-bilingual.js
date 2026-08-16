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
    const bilingualLevel2 = await prisma.practiceTopic.create({
        data: {
            name: 'Level 2 - Trung bình',
            category: client_1.TopicCategory.BILINGUAL_LEVEL,
            order: 2,
            quizzes: {
                create: [
                    {
                        title: 'Flight Cancellation Notice (Notice)',
                        type: client_1.QuizType.BILINGUAL_READING,
                        bilingualContent: [
                            { en: "Attention all passengers.", vi: "Xin lưu ý tất cả hành khách." },
                            { en: "Flight 405 to Tokyo has been canceled due to heavy snow.", vi: "Chuyến bay 405 đến Tokyo đã bị hủy do tuyết rơi dày." },
                            { en: "Please proceed to the customer service desk for rebooking.", vi: "Vui lòng tiến đến quầy dịch vụ khách hàng để đặt lại vé." },
                            { en: "We sincerely apologize for the inconvenience.", vi: "Chúng tôi chân thành xin lỗi vì sự bất tiện này." }
                        ],
                        questions: {
                            create: [
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'Why was the flight canceled?',
                                        options: ['Because of bad weather', 'Because of a mechanical issue', 'Because of pilot illness', 'Because of security reasons'],
                                        correctAnswer: 'Because of bad weather'
                                    },
                                    order: 1
                                },
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'What should passengers do next?',
                                        options: ['Go home', 'Wait at the gate', 'Go to the customer service desk', 'Board the plane'],
                                        correctAnswer: 'Go to the customer service desk'
                                    },
                                    order: 2
                                }
                            ]
                        }
                    },
                    {
                        title: 'Office Relocation (Memo)',
                        type: client_1.QuizType.BILINGUAL_READING,
                        bilingualContent: [
                            { en: "To: All Employees", vi: "Tới: Toàn thể nhân viên" },
                            { en: "From: Management", vi: "Từ: Ban giám đốc" },
                            { en: "We are moving our headquarters to a new building next month.", vi: "Chúng tôi sẽ chuyển trụ sở chính đến một tòa nhà mới vào tháng tới." },
                            { en: "The new office will provide more space and better facilities.", vi: "Văn phòng mới sẽ cung cấp không gian rộng hơn và cơ sở vật chất tốt hơn." },
                            { en: "Please pack your personal belongings by Friday, October 20.", vi: "Vui lòng đóng gói đồ đạc cá nhân của bạn trước thứ Sáu, ngày 20 tháng 10." }
                        ],
                        questions: {
                            create: [
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'What is the memo mainly about?',
                                        options: ['A new company policy', 'A change in management', 'Moving to a new office', 'A company holiday'],
                                        correctAnswer: 'Moving to a new office'
                                    },
                                    order: 1
                                },
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'By when should employees pack their belongings?',
                                        options: ['Next month', 'October 20', 'This Friday', 'October 25'],
                                        correctAnswer: 'October 20'
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
    const bilingualLevel3 = await prisma.practiceTopic.create({
        data: {
            name: 'Level 3 - Khó',
            category: client_1.TopicCategory.BILINGUAL_LEVEL,
            order: 3,
            quizzes: {
                create: [
                    {
                        title: 'Software Upgrade Schedule (Email)',
                        type: client_1.QuizType.BILINGUAL_READING,
                        bilingualContent: [
                            { en: "Dear Team,", vi: "Thân gửi nhóm," },
                            { en: "The IT department will upgrade the accounting software this weekend.", vi: "Phòng CNTT sẽ nâng cấp phần mềm kế toán vào cuối tuần này." },
                            { en: "The system will be unavailable from Saturday 8:00 PM to Sunday 6:00 AM.", vi: "Hệ thống sẽ không khả dụng từ 8:00 tối thứ Bảy đến 6:00 sáng Chủ nhật." },
                            { en: "Please make sure to save your work and log out before leaving on Friday.", vi: "Vui lòng đảm bảo lưu công việc của bạn và đăng xuất trước khi rời đi vào thứ Sáu." },
                            { en: "If you encounter any issues on Monday, contact the help desk immediately.", vi: "Nếu bạn gặp bất kỳ vấn đề gì vào thứ Hai, hãy liên hệ ngay với bộ phận hỗ trợ." }
                        ],
                        questions: {
                            create: [
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'What is the purpose of the email?',
                                        options: ['To announce a new employee', 'To inform about a software upgrade', 'To schedule a meeting', 'To request new computers'],
                                        correctAnswer: 'To inform about a software upgrade'
                                    },
                                    order: 1
                                },
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'When will the system be unavailable?',
                                        options: ['All day Saturday', 'From Friday evening to Sunday morning', 'From Saturday 8:00 PM to Sunday 6:00 AM', 'On Monday morning'],
                                        correctAnswer: 'From Saturday 8:00 PM to Sunday 6:00 AM'
                                    },
                                    order: 2
                                },
                                {
                                    type: 'MULTIPLE_CHOICE',
                                    content: {
                                        text: 'What should employees do if they have problems on Monday?',
                                        options: ['Restart their computers', 'Email the manager', 'Contact the help desk', 'Install the software again'],
                                        correctAnswer: 'Contact the help desk'
                                    },
                                    order: 3
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