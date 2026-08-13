import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

async function main() {
  console.log("Fetching words without IPA...");
  const wordsToUpdate = await prisma.vocabWord.findMany({
    where: {
      OR: [
        { ipaUs: null },
        { ipaUs: "" }
      ]
    },
    select: { id: true, word: true }
  });

  if (wordsToUpdate.length === 0) {
    console.log("All words already have IPA.");
    return;
  }

  console.log(`Found ${wordsToUpdate.length} words to update.`);
  
  // Process in batches of 50
  const batchSize = 50;
  for (let i = 0; i < wordsToUpdate.length; i += batchSize) {
    const batch = wordsToUpdate.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} (${batch.length} words)...`);
    
    const wordListStr = batch.map(w => w.word).join(', ');
    
    const schema: any = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          word: { type: SchemaType.STRING },
          ipaUs: { type: SchemaType.STRING, description: "US phonetic transcription (e.g., /mæk/)" },
          ipaUk: { type: SchemaType.STRING, description: "UK phonetic transcription" }
        },
        required: ["word", "ipaUs", "ipaUk"]
      }
    };

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: `Provide the US and UK phonetic transcription (IPA) for the following English words. Ensure the IPA is enclosed in slashes (e.g., /ˈmæn.ɪ.dʒɚ/). Words: ${wordListStr}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      });

      const ipaData = JSON.parse(result.response.text());

      // Update database
      for (const item of ipaData) {
        const dbWord = batch.find(w => w.word.toLowerCase() === item.word.toLowerCase());
        if (dbWord) {
          await prisma.vocabWord.update({
            where: { id: dbWord.id },
            data: {
              ipaUs: item.ipaUs,
              ipaUk: item.ipaUk
            }
          });
        }
      }
      
      console.log(`Successfully updated batch ${i / batchSize + 1}.`);
    } catch (error) {
      console.error(`Error processing batch ${i / batchSize + 1}:`, error);
    }
  }

  console.log("IPA seeding complete!");
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
