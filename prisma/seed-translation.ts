import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

async function main() {
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
  
  // Process in batches
  const batchSize = 10;
  for (let i = 0; i < missingTranslations.length; i += batchSize) {
    const batch = missingTranslations.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} (${batch.length} questions)...`);
    
    for (const q of batch) {
      const content = q.content as any;
      const sentence = content.correctAnswer;
      
      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: `Translate the following English sentence to Vietnamese. Provide ONLY the raw Vietnamese string, nothing else. Sentence: "${sentence}"` }] }],
        });

        const translation = result.response.text().trim();
        content.translation = translation;

        await prisma.question.update({
          where: { id: q.id },
          data: {
            content: content
          }
        });
        console.log(`- Translated: "${sentence}" -> "${translation}"`);
      } catch (error) {
        console.error(`Error translating question ${q.id}:`, error);
      }
      
      // Delay to avoid rate limits
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
