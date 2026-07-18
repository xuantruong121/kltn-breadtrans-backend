"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateExerciseDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreateExerciseDto {
    title;
    targetText;
    difficulty;
    category;
}
exports.CreateExerciseDto = CreateExerciseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'IELTS Reading - Sentence Stress' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateExerciseDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'The weather in Vietnam is generally hot and humid throughout the year.',
        description: 'Câu/đoạn văn học viên cần đọc to',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateExerciseDto.prototype, "targetText", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'INTERMEDIATE', enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
    __metadata("design:type", String)
], CreateExerciseDto.prototype, "difficulty", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'IELTS', enum: ['IELTS', 'TOEIC', 'GENERAL'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['IELTS', 'TOEIC', 'GENERAL']),
    __metadata("design:type", String)
], CreateExerciseDto.prototype, "category", void 0);
//# sourceMappingURL=create-exercise.dto.js.map