export declare class CreateCourseDto {
    title: string;
    description?: string;
    thumbnail?: string;
    level?: string;
    teacherId?: number;
}
export declare class CreateClassDto {
    name: string;
    startDate?: string;
    endDate?: string;
    meetingLink?: string;
}
export declare class CreateLessonDto {
    title: string;
    description?: string;
    order?: number;
    videoUrl?: string;
}
export declare class CreateMaterialDto {
    title: string;
    fileUrl: string;
    fileType?: string;
}
