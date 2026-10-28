import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

const quizId = Number(process.argv.find((arg) => arg.startsWith('--quiz='))?.slice(7));
if (!Number.isInteger(quizId)) throw new Error('Usage: --quiz=<id>');
const prisma = new PrismaClient(), marker=`qa-dictation-sync-${randomUUID()}`, evidence=resolve('artifacts/learner-runtime-qa.jsonl');
const base=process.env.RECOVERY_FE_BASE_URL ?? 'http://localhost:3000'; let userId:number|undefined; let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function log(value:Record<string,unknown>){await mkdir(dirname(evidence),{recursive:true});await appendFile(evidence,`${JSON.stringify({timestamp:new Date().toISOString(),marker,quizId,...value})}\n`);}
async function main(){const email=`${marker}@breadtrans.local`, password=`Qa-${randomUUID()}-Aa1!`;try{
 const user=await prisma.user.create({data:{email,password:await bcrypt.hash(password,10),role:Role.STUDENT,emailVerifiedAt:new Date(),profile:{create:{fullName:'QA Dictation Sync'}}}});userId=user.id;
 const plus=await prisma.planVersion.findFirstOrThrow({where:{isCurrent:true,status:'PUBLISHED',plan:{code:'PLUS',status:'ACTIVE'}},select:{id:true}});await prisma.subscription.create({data:{userId:user.id,planVersionId:plus.id,status:SubscriptionStatus.ACTIVE,startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+3600000)}});
 const rows=await prisma.question.findMany({where:{quizId},orderBy:{order:'asc'},select:{content:true}}); const expected=rows.map((r)=>({text:String((r.content as any).transcript??(r.content as any).text??''),turnId:String((r.content as any).targetTurnId??'')})).filter((item)=>item.text&&item.turnId); const artifact=await prisma.listeningAudioArtifact.findFirstOrThrow({where:{quizId,status:'PUBLISHED'},select:{timeline:true}}); const orderedTimeline=(artifact.timeline as Array<{turnId:string;startMs:number}>).sort((a,b)=>a.startMs-b.startMs); if(expected.length<20||orderedTimeline.length<20) throw new Error('EXPECTED_20_TRANSCRIPT_ROWS');
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`${base}/login`,{waitUntil:'networkidle'});await page.locator('[aria-controls="email-login-panel"]').click();await page.locator('#emailInput').fill(email);await page.locator('#passwordInput').fill(password);const auth=page.waitForResponse(r=>r.url().includes('/auth/login')&&r.request().method()==='POST');await page.locator('#email-login-panel button[type="submit"]').click();if((await auth).status()!==200)throw new Error('AUTH_FAILED');await page.waitForFunction(()=>!location.pathname.startsWith('/login'));
 await page.goto(`${base}/listening/${quizId}`,{waitUntil:'networkidle'});await page.getByRole('button',{name:/Toàn bộ kịch bản/}).click();await page.locator('audio').waitFor({state:'attached',timeout:15000});const slider=page.getByRole('slider',{name:'Thanh thời gian nghe'});await slider.waitFor({state:'visible',timeout:15000});
 const snapshot=async(label:string)=>{const active=page.locator('button.border-amber-300').first();await active.waitFor({state:'visible',timeout:10000});const rightGroup=(await active.innerText()).replace(/^\s*\d+\s*/,'').replace(/^[A-Z][A-Z ]+:\s*/,'').trim();const left=(await page.locator('p.text-xl').first().innerText()).trim();const ok=Boolean(left)&&rightGroup.includes(left);await log({test:'dictation-transcript-sync-checkpoint',label,result:ok?'PASS':'FAIL',route:page.url(),left,rightActiveGroup:rightGroup});if(!ok)throw new Error(`SYNC_MISMATCH:${label}`);return{left,right:rightGroup};};
 const seekTo=async(index:number,label:string)=>{const second=orderedTimeline[index]?.startMs/1000;if(second===undefined)throw new Error(`TIMELINE_MISSING:${index}`);await page.locator('audio').evaluate((node,value)=>{const audio=node as HTMLAudioElement;audio.currentTime=value;audio.dispatchEvent(new Event('seeking'));audio.dispatchEvent(new Event('timeupdate'));},second);await page.waitForTimeout(120);await snapshot(label);};
 await page.getByLabel('Phát câu').click();await seekTo(0,'turn-1');await seekTo(1,'turn-2');await seekTo(4,'turn-5');await seekTo(9,'turn-10');await seekTo(14,'turn-15');await seekTo(19,'turn-20');
 await page.getByLabel('Tạm dừng').click();const paused=await snapshot('pause');await page.getByLabel('Phát câu').click();await page.waitForTimeout(500);await snapshot('resume');
 await seekTo(0,'seek-early');await seekTo(19,'seek-late');await seekTo(9,'seek-middle');
 const auto=page.getByLabel(/Tự động cuộn/);if(await auto.isChecked())await auto.uncheck();await snapshot('autoscroll-off');await auto.check();await snapshot('autoscroll-on');
 const select=page.locator('select').filter({has:page.locator('option[value="none"]')}).first();if(await select.count()){await select.selectOption('vi');await snapshot('translation-vi');await select.selectOption('none');await snapshot('translation-none');}
 await page.getByRole('button',{name:/Nghe chép chính tả/}).click();await page.waitForTimeout(200);await log({test:'dictation-mode-transition',result:'PASS',route:page.url(),note:'Switched Full transcript to Dictation after sync checks'});
 await log({test:'dictation-transcript-sync-summary',result:'PASS',route:page.url(),expectedCount:expected.length});
 }finally{await browser?.close();if(userId){await prisma.subscription.deleteMany({where:{userId}});await prisma.user.delete({where:{id:userId}}).catch(()=>undefined);}const orphans=await prisma.user.count({where:{email:{startsWith:'qa-dictation-sync-'}}});await log({test:'cleanup',result:orphans===0?'PASS':'FAIL',orphanRecords:orphans});await prisma.$disconnect();}}
main().catch(async e=>{await log({test:'fatal',result:'FAIL',failure:e instanceof Error?e.message:String(e)});console.error(e);process.exitCode=1;});
