import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
async function main(){for(const id of [1,2]){const assessment=await prisma.toeicAssessment.findUniqueOrThrow({where:{id},include:{components:{orderBy:{order:'asc'},include:{lrExamSet:{include:{groups:{include:{questions:true}}}},speakingPracticeSet:{include:{exercises:true}},writingSet:{include:{items:true}}}},genericExam:true}});const components=assessment.components.map(c=>({kind:c.kind,order:c.order,lrQuestions:c.lrExamSet?.groups.reduce((n,g)=>n+g.questions.length,0)??0,speaking:c.speakingPracticeSet?.exercises.length??0,writing:c.writingSet?.items.length??0}));console.log(JSON.stringify({id,title:assessment.title,family:assessment.productFamily,status:assessment.publicationStatus,genericExam:{id:assessment.examId,status:assessment.genericExam?.publicationStatus},components}));}}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
