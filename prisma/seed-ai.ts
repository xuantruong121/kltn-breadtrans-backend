import { PrismaClient, TopicCategory, QuizType } from '@prisma/client';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });

const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
const apiKeys = rawKeys.split(",").map(k => k.trim()).filter(Boolean);
const apiKey = apiKeys[0];

if (!apiKey) {
  console.warn("⚠️ No GEMINI_API_KEYS defined in .env, skipping AI seed generation.");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-2.5-flash" }) : null;

async function generateVocabTopic(topicTitle: string, categoryName: string, iconUrl: string) {
  if (!model) {
    console.warn("⚠️ AI Model is not initialized. Skipping generateVocabTopic.");
    return;
  }
  console.log(`Generating Vocab Topic: ${topicTitle}...`);
  
  const schema: any = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        word: { type: SchemaType.STRING },
        pos: { type: SchemaType.STRING },
        meaning: { type: SchemaType.STRING },
        ipaUs: { type: SchemaType.STRING },
        exampleEn: { type: SchemaType.STRING },
        exampleVi: { type: SchemaType.STRING }
      },
      required: ["word", "pos", "meaning", "ipaUs", "exampleEn", "exampleVi"]
    }
  };

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: `Generate 10 English vocabulary words related to the topic: "${topicTitle}". Provide detailed information for each word including part of speech (pos), Vietnamese meaning, American English IPA (ipaUs), an English example sentence, and its Vietnamese translation.` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const wordsText = result.response.text();
  const words = JSON.parse(wordsText);

  const topic = await prisma.vocabTopic.create({
    data: {
      title: topicTitle,
      categoryName,
      iconUrl,
      totalWords: words.length,
    }
  });

  for (let i = 0; i < words.length; i++) {
    await prisma.vocabWord.create({
      data: {
        ...words[i],
        topicId: topic.id,
        order: i,
      }
    });
  }
  console.log(`- Created Topic "${topicTitle}" with ${words.length} words.`);
}

async function generateSpeakingExercises() {
  if (!model) {
    console.warn("⚠️ AI Model is not initialized. Skipping generateSpeakingExercises.");
    return;
  }
  console.log("Generating Speaking Exercises...");
  
  const schema: any = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        targetText: { type: SchemaType.STRING },
        difficulty: { type: SchemaType.STRING },
        category: { type: SchemaType.STRING }
      },
      required: ["title", "targetText", "difficulty", "category"]
    }
  };

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: `Generate 5 English speaking exercises. The 'targetText' should be a paragraph of 30-50 words. Provide a title, difficulty (BEGINNER, INTERMEDIATE, or ADVANCED), and category (GENERAL, TOEIC, or BUSINESS).` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const exercises = JSON.parse(result.response.text());

  for (const ex of exercises) {
    await prisma.speakingExercise.create({ data: ex });
  }
  console.log(`- Created ${exercises.length} speaking exercises.`);
}

async function generateBilingualReading() {
  if (!model) {
    console.warn("⚠️ AI Model is not initialized. Skipping generateBilingualReading.");
    return;
  }
  console.log("Generating Bilingual Reading...");
  
  const schema: any = {
    type: SchemaType.OBJECT,
    properties: {
      name: { type: SchemaType.STRING },
      vietnameseName: { type: SchemaType.STRING },
      category: { type: SchemaType.STRING },
      iconUrl: { type: SchemaType.STRING },
      bilingualContent: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            en: { type: SchemaType.STRING },
            vi: { type: SchemaType.STRING }
          },
          required: ["en", "vi"]
        }
      },
      questions: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            text: { type: SchemaType.STRING },
            options: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING }
            },
            correct: { type: SchemaType.STRING }
          },
          required: ["text", "options", "correct"]
        }
      }
    },
    required: ["name", "vietnameseName", "category", "iconUrl", "bilingualContent", "questions"]
  };

  const topics = ["Space Exploration", "Healthy Lifestyle", "Remote Work"];
  
  for (const topicStr of topics) {
    console.log(`- Generating Reading for: ${topicStr}`);
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: `Generate a short bilingual reading passage about "${topicStr}". Include the English name, Vietnamese name, a related emoji (iconUrl), category (always "BILINGUAL_LEVEL"). Provide the bilingual content as an array of 5 sentences (each with 'en' and 'vi'). Finally, provide 3 multiple choice questions (text, 4 options, and correct answer string) based on the passage.` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const data = JSON.parse(result.response.text());

    const practiceTopic = await prisma.practiceTopic.create({
      data: {
        name: data.name,
        vietnameseName: data.vietnameseName,
        category: data.category,
        iconUrl: data.iconUrl,
        order: Math.floor(Math.random() * 10) + 1
      }
    });

    await prisma.quiz.create({
      data: {
        practiceTopicId: practiceTopic.id,
        title: `Reading Practice: ${data.name}`,
        description: 'Read the following bilingual article and answer the questions.',
        type: QuizType.BILINGUAL_READING,
        bilingualContent: data.bilingualContent,
        questions: {
          create: data.questions.map((q: any, idx: number) => ({
            type: 'MULTIPLE_CHOICE',
            order: idx + 1,
            content: {
              text: q.text,
              options: q.options,
              correct: q.correct
            }
          }))
        }
      }
    });
  }
}

async function seedAI() {
  console.log("Starting AI Seed...");
  
  try {
    // 1. Generate Vocab Topics
    const vocabTasks = [
      { title: "Healthcare & Medicine", categoryName: "GENERAL ENGLISH", iconUrl: "🏥" },
      { title: "Technology & Software", categoryName: "GENERAL ENGLISH", iconUrl: "💻" },
      { title: "Business Negotiations", categoryName: "BUSINESS ENGLISH", iconUrl: "🤝" },
      { title: "Environment", categoryName: "GENERAL ENGLISH", iconUrl: "🌿" },
      { title: "Culinary Arts", categoryName: "GENERAL ENGLISH", iconUrl: "🍳" }
    ];

    for (const v of vocabTasks) {
      await generateVocabTopic(v.title, v.categoryName, v.iconUrl);
    }

    // 2. Generate Speaking Exercises
    await generateSpeakingExercises();

    // 3. Generate Bilingual Reading
    await generateBilingualReading();

    console.log("AI Seed completed successfully.");
  } catch (error) {
    console.error("Error during AI Seeding:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedAI();
