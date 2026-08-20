"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const generative_ai_1 = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();
const prisma = new client_1.PrismaClient();
async function urlToGenerativePart(url, mimeType) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
        inlineData: {
            data: buffer.toString('base64'),
            mimeType
        },
    };
}
async function main() {
    console.log('Seeding Writing Data...');
    const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
    const apiKeys = rawKeys.split(",").map(k => k.trim()).filter(Boolean);
    const apiKey = apiKeys[0];
    if (!apiKey) {
        console.error('Missing GEMINI_API_KEYS in .env');
        process.exit(1);
    }
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const imageUrls = [
        {
            url: 'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?q=80&w=800&auto=format&fit=crop',
            mimeType: 'image/jpeg'
        },
        {
            url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=800&auto=format&fit=crop',
            mimeType: 'image/jpeg'
        }
    ];
    for (const img of imageUrls) {
        console.log(`Analyzing image: ${img.url}`);
        const imagePart = await urlToGenerativePart(img.url, img.mimeType);
        const prompt = `
      You are an expert TOEIC test creator. I am providing you with an image.
      Create a TOEIC Writing Part 1 question (Write a sentence based on a picture).
      
      Respond STRICTLY with a valid JSON object in the following format (no markdown formatting, no backticks, just raw JSON):
      {
        "keywords": ["word1", "word2"], // Exactly 2 words relevant to the image
        "grammarType": "V + N", // Categorize the keywords (e.g., "V + N", "N + N", "N + Prep")
        "sampleSentences": [ // 2 sample sentences
          {
            "en": "English sentence using both words describing the picture.",
            "vi": "Vietnamese translation.",
            "structure": "S + V + O" // Brief grammar structure
          }
        ]
      }
    `;
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        let text = response.text().trim();
        if (text.startsWith('```json'))
            text = text.substring(7, text.length - 3).trim();
        else if (text.startsWith('```'))
            text = text.substring(3, text.length - 3).trim();
        const parsedData = JSON.parse(text);
        console.log(`Generated Data:`, parsedData);
        let topic = await prisma.practiceTopic.findFirst({
            where: { name: parsedData.grammarType, category: client_1.TopicCategory.WRITING_PART1 }
        });
        if (!topic) {
            topic = await prisma.practiceTopic.create({
                data: {
                    name: parsedData.grammarType,
                    category: client_1.TopicCategory.WRITING_PART1
                }
            });
        }
        const quiz = await prisma.quiz.create({
            data: {
                title: 'Writing Part 1 - Picture',
                type: client_1.QuizType.WRITING_PICTURE,
                practiceTopicId: topic.id,
                questions: {
                    create: [
                        {
                            type: 'WRITING',
                            content: {
                                imageUrl: img.url,
                                keywords: parsedData.keywords,
                                sampleSentences: parsedData.sampleSentences
                            }
                        }
                    ]
                }
            },
            include: {
                questions: true
            }
        });
        const questionId = quiz.questions[0].id;
        let fakeUser = await prisma.user.findFirst({ where: { email: 'community@test.com' } });
        if (!fakeUser) {
            fakeUser = await prisma.user.create({
                data: { email: 'community@test.com', password: '123' }
            });
        }
        let fakeUser2 = await prisma.user.findFirst({ where: { email: 'community2@test.com' } });
        if (!fakeUser2) {
            fakeUser2 = await prisma.user.create({
                data: { email: 'community2@test.com', password: '123' }
            });
        }
        await prisma.submission.create({
            data: {
                userId: fakeUser.id,
                quizId: quiz.id,
                score: 3,
                aiFeedback: 'Perfect sentence.',
                results: {
                    create: [
                        {
                            questionId: questionId,
                            answer: parsedData.sampleSentences[0].en,
                            score: 3
                        }
                    ]
                }
            }
        });
        await prisma.submission.create({
            data: {
                userId: fakeUser2.id,
                quizId: quiz.id,
                score: 2,
                aiFeedback: 'Good, but grammar could be better.',
                results: {
                    create: [
                        {
                            questionId: questionId,
                            answer: `${parsedData.keywords[0]} ${parsedData.keywords[1]} is good.`,
                            score: 2
                        }
                    ]
                }
            }
        });
        console.log(`Saved Quiz ID ${quiz.id}`);
    }
    console.log('Seeding completed!');
}
main()
    .catch(e => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed-writing.js.map