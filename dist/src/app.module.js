"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./modules/auth/auth.module");
const user_module_1 = require("./modules/user/user.module");
const course_module_1 = require("./modules/course/course.module");
const quiz_module_1 = require("./modules/quiz/quiz.module");
const ai_module_1 = require("./modules/ai/ai.module");
const gamification_module_1 = require("./modules/gamification/gamification.module");
const upload_module_1 = require("./modules/upload/upload.module");
const speaking_module_1 = require("./modules/speaking/speaking.module");
const prisma_module_1 = require("./prisma/prisma.module");
const event_emitter_1 = require("@nestjs/event-emitter");
const reading_module_1 = require("./modules/reading/reading.module");
const writing_module_1 = require("./modules/writing/writing.module");
const vocab_module_1 = require("./modules/vocab/vocab.module");
const toeic_module_1 = require("./modules/toeic/toeic.module");
const class_module_1 = require("./modules/class/class.module");
const events_module_1 = require("./modules/events/events.module");
const admin_module_1 = require("./modules/admin/admin.module");
const assignment_module_1 = require("./modules/assignment/assignment.module");
const grammar_module_1 = require("./modules/grammar/grammar.module");
const market_module_1 = require("./modules/market/market.module");
const content_module_1 = require("./modules/content/content.module");
const schedule_1 = require("@nestjs/schedule");
const notifications_module_1 = require("./modules/notifications/notifications.module");
const logging_middleware_1 = require("./common/middleware/logging.middleware");
const ioredis_1 = require("@nestjs-modules/ioredis");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(logging_middleware_1.LoggingMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            event_emitter_1.EventEmitterModule.forRoot(),
            schedule_1.ScheduleModule.forRoot(),
            ioredis_1.RedisModule.forRoot({
                type: 'single',
                url: 'redis://localhost:6379',
            }),
            throttler_1.ThrottlerModule.forRoot([
                {
                    ttl: 60000,
                    limit: 100,
                },
            ]),
            auth_module_1.AuthModule,
            user_module_1.UserModule,
            course_module_1.CourseModule,
            quiz_module_1.QuizModule,
            ai_module_1.AiModule,
            gamification_module_1.GamificationModule,
            upload_module_1.UploadModule,
            speaking_module_1.SpeakingModule,
            prisma_module_1.PrismaModule,
            reading_module_1.ReadingModule,
            writing_module_1.WritingModule,
            vocab_module_1.VocabModule,
            toeic_module_1.ToeicModule,
            class_module_1.ClassModule,
            events_module_1.EventsModule,
            admin_module_1.AdminModule,
            assignment_module_1.AssignmentModule,
            grammar_module_1.GrammarModule,
            market_module_1.MarketModule,
            content_module_1.ContentModule,
            notifications_module_1.NotificationsModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            app_service_1.AppService,
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map