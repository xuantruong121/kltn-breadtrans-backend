require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const submissions = await p.submission.findMany({where:{userId:195},select:{id:true,quizId:true,clientAttemptId:true,submittedAt:true}});
  const results = await p.result.findMany({where:{submission:{userId:195}},select:{id:true,submissionId:true,score:true}});
  const activities = await p.learningActivity.findMany({where:{userId:195,type:'WRITING_PRACTICE_COMPLETED'},select:{id:true,sourceId:true,occurredAt:true}});
  const rewards = await p.userQuizReward.findMany({where:{userId:195},select:{id:true,quizId:true,createdAt:true}});
  console.log(JSON.stringify({submissions,results,activities,rewards},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
