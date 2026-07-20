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
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            event_emitter_1.EventEmitterModule.forRoot(),
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
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map