import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const apiKeys = keysStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
  
  if (apiKeys.length === 0) {
    console.error("No GEMINI_API_KEYS found. Skipping translation.");
    return;
  }

  console.log("Fetching dictation questions without translation...");
  const questionsToUpdate = await prisma.question.findMany({
    where: {
      type: 'DICTATION'
    }
  });

  const missingTranslations = questionsToUpdate.filter(q => {
    const content = q.content as any;
    return !content.translation;
  });

  if (missingTranslations.length === 0) {
    console.log("All dictation questions already have a translation.");
    return;
  }

  console.log(`Found ${missingTranslations.length} questions to translate.`);
  
  const batchSize = 10;
  let currentKeyIndex = 0;

  const executeWithRotation = async (prompt: string) => {
    let attempts = 0;
    while (attempts < apiKeys.length) {
      const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
      const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        return result.response.text().trim();
      } catch (error: any) {
        if (error.status === 429 || error.message?.includes('429') || error.message?.includes('Too Many Requests') || error.message?.includes('Quota')) {
          console.warn(`[!] API Key at index ${currentKeyIndex} hit rate limit. Rotating...`);
          currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
          attempts++;
        } else {
          throw error;
        }
      }
    }
    throw new Error('All API keys exhausted.');
  };

  for (let i = 0; i < missingTranslations.length; i += batchSize) {
    const batch = missingTranslations.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} (${batch.length} questions)...`);
    
    for (const q of batch) {
      const content = q.content as any;
      const sentence = content.correctAnswer;
      
      try {
        const prompt = `Translate the following English sentence to Vietnamese. Provide ONLY the raw Vietnamese string, nothing else. Sentence: "${sentence}"`;
        const translation = await executeWithRotation(prompt);
        content.translation = translation;

        await prisma.question.update({
          where: { id: q.id },
          data: {
            content: content
          }
        });
        console.log(`- Translated: "${sentence}" -> "${translation}"`);
      } catch (error: any) {
        console.error(`Error translating question ${q.id}:`, error.message);
        if (error.message === 'All API keys exhausted.') {
           console.log('Stopping seed due to quota exhaustion on all keys.');
           return;
        }
      }
      
      await new Promise(res => setTimeout(res, 1000));
    }
  }

  console.log("Translation seeding complete!");
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
