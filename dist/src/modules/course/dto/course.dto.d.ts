import { CourseStatus, ClassStatus } from '@prisma/client';
export declare class CreateCourseDto {
    title: string;
    description?: string;
    thumbnail?: string;
    level?: string;
    teacherId?: number;
}
export declare class UpdateCourseDto {
    title?: string;
    description?: string;
    thumbnail?: string;
    level?: string;
    teacherId?: number;
    status?: CourseStatus;
}
export declare class ReviewCourseDto {
    action: 'APPROVE' | 'REJECT';
    reason?: string;
}
export declare class CreateClassDto {
    name: string;
    teacherId?: number;
    startDate?: string;
    endDate?: string;
    meetingLink?: string;
    capacity?: number;
    tuitionFeeVnd?: number;
}
export declare class UpdateClassDto {
    name?: string;
    teacherId?: number;
    startDate?: string;
    endDate?: string;
    meetingLink?: string;
    capacity?: number;
    tuitionFeeVnd?: number;
    status?: ClassStatus;
}
export declare class EnrollResponseDto {
    enrollmentId: number;
    classId: number;
    status: 'ACTIVE' | 'PENDING_PAYMENT';
    tuitionFeeVnd: number;
    accessGranted: boolean;
    message: string;
}
export declare class CreateLessonDto {
    title: string;
    description?: string;
    order?: number;
    videoUrl?: string;
}
export declare class UpdateLessonDto {
    title?: string;
    description?: string;
    order?: number;
    videoUrl?: string;
}
export declare class ReorderLessonsDto {
    lessonIds: number[];
}
export declare class CreateMaterialDto {
    title: string;
    fileUrl: string;
    fileType?: string;
}
export declare class UpdateMaterialDto {
    title?: string;
    fileUrl?: string;
    fileType?: string;
}
