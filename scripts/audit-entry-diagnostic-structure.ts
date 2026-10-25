/**
 * Entry Diagnostic: canonical structure + data completeness, read-only.
 *
 * Nothing here is assumed from documentation: the skills, counts, ordering,
 * answer keys and any media references are derived from the live rows.
 *
 * Writes artifacts/entry-diagnostic-structure.json. Mutates nothing.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OUT = join(process.cwd(), 'artifacts', 'entry-diagnostic-structure.json');

/** Anything that looks like a media reference inside the text/options JSON. */
const MEDIA_HINT =
  /(https?:\/\/[^\s"']+\.(mp3|wav|m4a|ogg|png|jpe?g|webp))|(catalog\/[^\s"']+)|(audioUrl|audioKey|imageUrl|imageKey|audioText|script|transcript)/i;

void (async () => {
  try {
    const assessments = await prisma.diagnosticAssessment.findMany({
      include: {
        questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
        _count: { select: { attempts: true, speakingResponses: true } },
      },
      orderBy: { id: 'asc' },
    });

    const report: Array<Record<string, unknown>> = [];
    const defects: Array<Record<string, unknown>> = [];

    for (const assessment of assessments) {
      const bySkill: Record<string, number> = {};
      const orderCounts: Record<number, number> = {};
      const mediaRefs: Array<Record<string, unknown>> = [];

      for (const question of assessment.questions) {
        bySkill[question.skill] = (bySkill[question.skill] ?? 0) + 1;
        orderCounts[question.order] = (orderCounts[question.order] ?? 0) + 1;

        const options = question.options as unknown;
        const optionList = Array.isArray(options) ? options : null;
        const serialized = JSON.stringify({
          question: question.question,
          options,
          explanation: question.explanation,
        });

        // --- completeness checks, one defect row per real problem
        if (!question.question?.trim()) {
          defects.push({
            assessmentId: assessment.id,
            questionId: question.id,
            field: 'question',
            problem: 'empty prompt',
          });
        }
        if (!optionList) {
          defects.push({
            assessmentId: assessment.id,
            questionId: question.id,
            field: 'options',
            problem: `options is not an array (${typeof options})`,
          });
        } else {
          if (optionList.length < 2) {
            defects.push({
              assessmentId: assessment.id,
              questionId: question.id,
              field: 'options',
              problem: `only ${optionList.length} option(s)`,
            });
          }
          const blank = optionList.filter(
            (option) => typeof option !== 'string' || !option.trim(),
          ).length;
          if (blank > 0) {
            defects.push({
              assessmentId: assessment.id,
              questionId: question.id,
              field: 'options',
              problem: `${blank} blank/non-string option(s)`,
            });
          }
          if (
            question.correctIndex < 0 ||
            question.correctIndex >= optionList.length
          ) {
            defects.push({
              assessmentId: assessment.id,
              questionId: question.id,
              field: 'correctIndex',
              problem: `correctIndex ${question.correctIndex} is outside 0..${optionList.length - 1}`,
              severity: 'P1',
            });
          }
          const unique = new Set(
            optionList.map((option) => String(option).trim().toLowerCase()),
          );
          if (unique.size !== optionList.length) {
            defects.push({
              assessmentId: assessment.id,
              questionId: question.id,
              field: 'options',
              problem: `duplicate option values (${optionList.length} options, ${unique.size} distinct)`,
            });
          }
        }
        if (!question.skill?.trim()) {
          defects.push({
            assessmentId: assessment.id,
            questionId: question.id,
            field: 'skill',
            problem: 'empty skill',
          });
        }

        if (MEDIA_HINT.test(serialized)) {
          mediaRefs.push({
            questionId: question.id,
            skill: question.skill,
            order: question.order,
            matched: serialized.match(MEDIA_HINT)?.[0] ?? null,
          });
        }
      }

      const duplicateOrders = Object.entries(orderCounts)
        .filter(([, count]) => count > 1)
        .map(([order, count]) => ({ order: Number(order), count }));
      for (const duplicate of duplicateOrders) {
        defects.push({
          assessmentId: assessment.id,
          field: 'order',
          problem: `order ${duplicate.order} used by ${duplicate.count} questions`,
        });
      }

      // Duplicate prompts within one assessment would mean a copied item.
      const promptSeen = new Map<string, number[]>();
      for (const question of assessment.questions) {
        const key = (question.question ?? '').trim().toLowerCase();
        promptSeen.set(key, [...(promptSeen.get(key) ?? []), question.id]);
      }
      const duplicatePrompts = [...promptSeen.entries()].filter(
        ([, ids]) => ids.length > 1,
      );
      for (const [prompt, ids] of duplicatePrompts) {
        defects.push({
          assessmentId: assessment.id,
          field: 'question',
          problem: `identical prompt shared by question ids ${ids.join(',')}`,
          prompt: prompt.slice(0, 80),
        });
      }

      report.push({
        assessmentId: assessment.id,
        title: assessment.title,
        isActive: assessment.isActive,
        questionCount: assessment.questions.length,
        bySkill,
        orderRange: assessment.questions.length
          ? {
              min: Math.min(...assessment.questions.map((q) => q.order)),
              max: Math.max(...assessment.questions.map((q) => q.order)),
            }
          : null,
        duplicateOrders,
        duplicatePromptGroups: duplicatePrompts.length,
        mediaReferencesFound: mediaRefs.length,
        mediaReferences: mediaRefs,
        attempts: assessment._count.attempts,
        speakingResponses: assessment._count.speakingResponses,
      });
    }

    // Orphans: questions whose assessment is gone, responses pointing nowhere.
    const orphanQuestions = await prisma.$queryRawUnsafe<
      Array<{ count: bigint }>
    >(
      'SELECT COUNT(*)::bigint AS count FROM "DiagnosticQuestion" q LEFT JOIN "DiagnosticAssessment" a ON a.id = q."assessmentId" WHERE a.id IS NULL',
    );
    const orphanResponses = await prisma.$queryRawUnsafe<
      Array<{ count: bigint }>
    >(
      'SELECT COUNT(*)::bigint AS count FROM "DiagnosticSpeakingResponse" r LEFT JOIN "DiagnosticQuestion" q ON q.id = r."questionId" WHERE q.id IS NULL',
    );

    const totalItems = report.reduce(
      (sum, row) => sum + (row.questionCount as number),
      0,
    );
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      note: 'DiagnosticQuestion has no audio or image column in the current schema. Any Listening/Speaking media must therefore be referenced from the prompt/options JSON or supplied at runtime; mediaReferences records what was actually found.',
      assessments: report,
      totalItems,
      incompleteItemCount: new Set(
        defects.filter((d) => d.questionId).map((d) => d.questionId),
      ).size,
      orphanQuestionCount: Number(orphanQuestions[0]?.count ?? 0),
      orphanSpeakingResponseCount: Number(orphanResponses[0]?.count ?? 0),
      defects,
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

    console.log(`written: ${OUT}\n`);
    for (const row of report) {
      console.log(
        `Assessment#${String(row.assessmentId)} active=${String(row.isActive)} questions=${String(row.questionCount)} attempts=${String(row.attempts)} speakingResponses=${String(row.speakingResponses)} "${String(row.title)}"`,
      );
      console.log(`  bySkill: ${JSON.stringify(row.bySkill)}`);
      console.log(
        `  order range: ${JSON.stringify(row.orderRange)}  duplicateOrders=${JSON.stringify(row.duplicateOrders)}  duplicatePromptGroups=${String(row.duplicatePromptGroups)}`,
      );
      console.log(
        `  media references in text/options: ${String(row.mediaReferencesFound)}`,
      );
    }
    console.log(`\nENTRY_DIAGNOSTIC_TOTAL_ITEMS=${totalItems}`);
    console.log(
      `ENTRY_DIAGNOSTIC_INCOMPLETE_ITEM_COUNT=${payload.incompleteItemCount}`,
    );
    console.log(
      `ENTRY_DIAGNOSTIC_ORPHAN_ITEM_COUNT=${payload.orphanQuestionCount}`,
    );
    console.log(`defect rows: ${defects.length}`);
    for (const defect of defects.slice(0, 25)) {
      console.log(`  ${JSON.stringify(defect)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})();
