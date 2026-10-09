require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const s = await p.submission.findMany({ where: { id: { in: [16,17,18,19,20,21] } }, select: { id:true, quizId:true, userId:true, clientAttemptId:true, submittedAt:true } });
  const r = await p.result.findMany({ where: { submissionId: { in: [16,17,18,19,20,21] } }, select: { id:true, submissionId:true, score:true } });
  const a = await p.learningActivity.findMany({ where: { userId:194, type:'WRITING_PRACTICE_COMPLETED' }, select: { id:true, sourceId:true, occurredAt:true } });
  const q = await p.userQuizReward.findMany({ where: { userId:194 }, select: { id:true, quizId:true, createdAt:true } });
  const pay = await Promise.all([
    p.planPayment.count({ where: { createdAt: { gte: new Date('2026-10-08T16:00:00Z') } } }),
    p.bankTransaction.count({ where: { createdAt: { gte: new Date('2026-10-08T16:00:00Z') } } }),
    p.payment.count({ where: { createdAt: { gte: new Date('2026-10-08T16:00:00Z') } } }),
  ]);
  const sub = await p.subscription.findUnique({ where: { id:114 }, select: { id:true,status:true,planVersionId:true,endsAt:true } });
  console.log(JSON.stringify({s,r,a,q,pay,sub}, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
