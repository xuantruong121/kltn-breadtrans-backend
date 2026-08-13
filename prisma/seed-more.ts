import { PrismaClient, TopicCategory, QuizType } from '@prisma/client';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

async function generateListeningPractice() {
  console.log("Generating Listening Practice (Dictation)...");

  const schema: any = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
        questions: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              audioText: { type: SchemaType.STRING },
              correctAnswer: { type: SchemaType.STRING }
            },
            required: ["audioText", "correctAnswer"]
          }
        }
      },
      required: ["title", "description", "questions"]
    }
  };

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: `Generate 3 English listening practice exercises (dictation style). Each exercise should have a title, description, and 5 sentences to dictate. Each question has 'audioText' (the sentence to listen to) and 'correctAnswer' (same sentence, for checking). Topics: Office Communication, Travel Planning, Daily Routine.` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const exercises = JSON.parse(result.response.text());

  for (const ex of exercises) {
    await prisma.quiz.create({
      data: {
        title: ex.title,
        description: ex.description,
        type: 'LISTENING_PRACTICE' as QuizType,
        questions: {
          create: ex.questions.map((q: any, idx: number) => ({
            type: 'DICTATION',
            order: idx + 1,
            content: {
              audioText: q.audioText,
              correctAnswer: q.correctAnswer,
            }
          }))
        }
      }
    });
  }
  console.log(`- Created ${exercises.length} listening practice quizzes.`);
}

async function generateWritingTopics() {
  console.log("Generating Writing Practice Topics...");

  const schema: any = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        topicName: { type: SchemaType.STRING },
        imageEmoji: { type: SchemaType.STRING },
        writingPrompt: { type: SchemaType.STRING },
        keywords: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING }
        }
      },
      required: ["topicName", "imageEmoji", "writingPrompt", "keywords"]
    }
  };

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: `Generate 4 TOEIC Part 1 writing practice topics. Each topic has: topicName (English topic name), imageEmoji (a relevant emoji for the image), writingPrompt (a description of an image with 2-3 items visible), keywords (array of 4-5 English words that should be used in the answer sentence). Examples of topics: office scene, restaurant scene, street scene, park scene.` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const topics = JSON.parse(result.response.text());

  for (const t of topics) {
    const practiceTopic = await prisma.practiceTopic.create({
      data: {
        name: t.topicName,
        category: TopicCategory.WRITING_PART1,
        iconUrl: t.imageEmoji,
        order: Math.floor(Math.random() * 10) + 1,
      }
    });

    await prisma.quiz.create({
      data: {
        practiceTopicId: practiceTopic.id,
        title: `TOEIC Writing Part 1: ${t.topicName}`,
        description: 'Viết một câu mô tả hình ảnh sử dụng từ/cụm từ gợi ý.',
        type: QuizType.WRITING_PICTURE,
        questions: {
          create: [{
            type: 'WRITING_PART1',
            order: 1,
            content: {
              imageUrl: t.imageEmoji,
              writingPrompt: t.writingPrompt,
              keywords: t.keywords,
            }
          }]
        }
      }
    });
  }
  console.log(`- Created ${topics.length} writing practice topics.`);
}

async function seedMore() {
  console.log("Starting additional seed...");
  try {
    await generateListeningPractice();
    await generateWritingTopics();
    console.log("Additional seed completed!");
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

seedMore();
