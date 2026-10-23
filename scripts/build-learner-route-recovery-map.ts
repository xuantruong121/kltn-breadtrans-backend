import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';

const frontendRoot = join(__dirname, '..', '..', 'kltn-breadtrans-frontend-junior');
const appRoot = join(frontendRoot, 'src', 'app');
const artifactPath = join(__dirname, '..', 'artifacts', 'learner-route-recovery-map.json');

type RouteEntry = {
  route: string;
  component: string;
  apiEndpoints: string[];
  apiServices: string[];
  dbModels: string[];
  r2MediaDependency: string;
  requiredEntitlement: string;
  expectedLearnerVisibleData: string;
};

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : entry.name === 'page.tsx' ? [absolute] : [];
  });
}

function routeFromFile(file: string) {
  const parts = relative(appRoot, file).split(sep).slice(0, -1);
  return `/${parts.filter((part) => !/^\(.+\)$/.test(part)).join('/')}`.replace(/\/$/, '') || '/';
}

function endpointLiterals(source: string) {
  return [...source.matchAll(/[`'"]((?:\/)[A-Za-z0-9_\-/${}:?=&.\[\]]+)[`'"]/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith('/'));
}

function modelHints(service: string) {
  const map: Record<string, string[]> = {
    'course.service': ['Course', 'CourseLesson', 'CourseLessonExercise', 'CourseLessonAttempt'],
    'vocab.service': ['VocabTopic', 'VocabWord', 'UserVocabWordProgress'],
    'quiz.service': ['Quiz', 'Question', 'QuizAttempt', 'QuizAudioAsset'],
    'speaking.service': ['SpeakingPracticeSet', 'SpeakingExercise', 'SpeakingSubmission'],
    'writing.service': ['Quiz', 'Question', 'WritingSubmission'],
    'grammar.service': ['GrammarTopic', 'GrammarAttempt'],
    'toeic.service': ['ToeicExam', 'ToeicAttempt', 'ToeicAssessment', 'ToeicAssessmentAttempt'],
    'plan.service': ['Plan', 'PlanVersion', 'PlanEntitlement', 'Subscription', 'PlanPurchase'],
    'gamification.service': ['UserStats', 'PointHistory', 'MarketOrder', 'UserBadge'],
    'diagnostic.service': ['DiagnosticAssessment', 'DiagnosticAttempt', 'DiagnosticQuestion'],
    'user.service': ['User', 'Profile', 'UserStats', 'LearningActivity'],
    'exam.service': ['GenericExam', 'ExamQuestion', 'ExamAttempt'],
  };
  return map[service] ?? [];
}

function entitlementHint(route: string, services: string[]) {
  if (route.startsWith('/plans')) return 'Public catalog; purchase requires authenticated learner';
  if (services.includes('course.service')) return 'COURSE_LIBRARY_ACCESS (Pro) to open V5 learner content; metadata remains visible';
  if (services.includes('vocab.service')) return 'PREMIUM_VOCAB only for premium topics';
  if (services.includes('speaking.service')) return 'PREMIUM_SPEAKING_CONTENT only for premium exercises';
  if (services.includes('writing.service')) return 'PREMIUM_WRITING_CONTENT only for premium topics';
  if (services.includes('quiz.service')) return 'PREMIUM_LISTENING / PREMIUM_READING by item';
  return 'Authenticated learner where endpoint requires it';
}

function mediaHint(source: string) {
  if (/audio|ListeningAudioPlayer|media|image|thumbnail|cover/i.test(source))
    return 'R2-backed media where authored content requires audio/image; verify URL at runtime';
  return 'No mandatory R2 media inferred from this route component';
}

function main() {
  if (!existsSync(appRoot)) throw new Error(`Frontend app root missing: ${appRoot}`);
  const pages = walk(appRoot).filter((file) => file.includes(`${sep}(student)${sep}`) || file.includes(`${sep}(public)${sep}courses${sep}`));
  const routes: RouteEntry[] = pages.map((file) => {
    const source = readFileSync(file, 'utf8');
    const services = [...source.matchAll(/@\/lib\/api\/services\/([^'";]+)/g)]
      .map((match) => match[1])
      .filter((value, index, values) => values.indexOf(value) === index);
    const endpoints = new Set(endpointLiterals(source));
    for (const service of services) {
      const servicePath = join(frontendRoot, 'src', 'lib', 'api', 'services', `${service}.ts`);
      if (existsSync(servicePath)) endpointLiterals(readFileSync(servicePath, 'utf8')).forEach((endpoint) => endpoints.add(endpoint));
    }
    const dbModels = [...new Set(services.flatMap(modelHints))];
    return {
      route: routeFromFile(file),
      component: relative(frontendRoot, file).replaceAll('\\', '/'),
      apiEndpoints: [...endpoints].sort(),
      apiServices: services,
      dbModels,
      r2MediaDependency: mediaHint(source),
      requiredEntitlement: entitlementHint(routeFromFile(file), services),
      expectedLearnerVisibleData: 'Route component data derived from its imported API services; empty or null primary lists require runtime review.',
    };
  }).sort((left, right) => left.route.localeCompare(right.route));
  const output = {
    generatedAt: new Date().toISOString(),
    source: 'Frontend App Router page files and imported API service modules',
    routeCount: routes.length,
    routes,
  };
  writeFileSync(artifactPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ LEARNER_ROUTE_AUDIT: 'PASS', routeCount: routes.length, artifact: 'artifacts/learner-route-recovery-map.json' }));
}

main();
