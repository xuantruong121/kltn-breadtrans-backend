import { CourseService } from './course.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
export declare class CourseController {
    private readonly courseService;
    constructor(courseService: CourseService);
    createCourse(createCourseDto: CreateCourseDto): Promise<{
        description: string | null;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        thumbnail: string | null;
        price: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    getAllCourses(): Promise<({
        teacher: {
            email: string;
            profile: {
                fullName: string;
                id: number;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                parentName: string | null;
                parentPhone: string | null;
                birthYear: number | null;
                nextExamDate: string | null;
                isSelfClaimed: boolean;
                userId: number;
            } | null;
            id: number;
        } | null;
        classes: {
            id: number;
            name: string;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            status: import(".prisma/client").$Enums.ClassStatus;
            teacherId: number;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
    } & {
        description: string | null;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        thumbnail: string | null;
        price: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    })[]>;
    getMyCourses(req: any): Promise<({
        teacher: {
            email: string;
            profile: {
                fullName: string;
                id: number;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                parentName: string | null;
                parentPhone: string | null;
                birthYear: number | null;
                nextExamDate: string | null;
                isSelfClaimed: boolean;
                userId: number;
            } | null;
            id: number;
        } | null;
        classes: {
            id: number;
            name: string;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            status: import(".prisma/client").$Enums.ClassStatus;
            teacherId: number;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
    } & {
        description: string | null;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        thumbnail: string | null;
        price: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    })[]>;
    getUserClasses(req: any): Promise<{
        studentCount: number;
        course: {
            title: string;
        };
        _count: {
            enrollments: number;
        };
        sessions: {
            title: string;
            createdAt: Date;
            id: number;
            status: string;
            meetingLink: string | null;
            classId: number;
            startTime: Date;
            endTime: Date;
            recordingUrl: string | null;
        }[];
        id: number;
        name: string;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[] | {
        studentCount: number;
        teacher: {
            email: string;
            profile: {
                fullName: string;
            } | null;
        };
        course: {
            title: string;
        };
        _count: {
            enrollments: number;
        };
        id: number;
        name: string;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    getCourseById(id: number): Promise<{
        classes: ({
            teacher: {
                email: string;
                profile: {
                    fullName: string;
                    id: number;
                    avatar: string | null;
                    phone: string | null;
                    address: string | null;
                    targetScore: string | null;
                    parentName: string | null;
                    parentPhone: string | null;
                    birthYear: number | null;
                    nextExamDate: string | null;
                    isSelfClaimed: boolean;
                    userId: number;
                } | null;
                id: number;
            };
        } & {
            id: number;
            name: string;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            status: import(".prisma/client").$Enums.ClassStatus;
            teacherId: number;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        })[];
        quizzes: {
            type: import(".prisma/client").$Enums.QuizType;
            description: string | null;
            title: string;
            createdAt: Date;
            id: number;
            courseId: number | null;
            practiceTopicId: number | null;
            theoryContent: string | null;
            bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
            timeLimit: number | null;
        }[];
    } & {
        description: string | null;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        thumbnail: string | null;
        price: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    deleteCourse(id: number): Promise<{
        description: string | null;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        thumbnail: string | null;
        price: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    updateCourseStatus(id: number, status: any): Promise<{
        description: string | null;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        thumbnail: string | null;
        price: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    createClass(courseId: number, dto: CreateClassDto, req: any): Promise<{
        id: number;
        name: string;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    getClassById(classId: number): Promise<{
        teacher: {
            email: string;
            profile: {
                fullName: string;
                id: number;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                parentName: string | null;
                parentPhone: string | null;
                birthYear: number | null;
                nextExamDate: string | null;
                isSelfClaimed: boolean;
                userId: number;
            } | null;
            id: number;
        };
        course: {
            lessons: ({
                materials: {
                    title: string;
                    id: number;
                    lessonId: number;
                    fileUrl: string;
                    fileType: string | null;
                }[];
            } & {
                description: string | null;
                title: string;
                createdAt: Date;
                id: number;
                courseId: number;
                order: number;
                videoUrl: string | null;
            })[];
        } & {
            description: string | null;
            title: string;
            createdAt: Date;
            updatedAt: Date;
            id: number;
            thumbnail: string | null;
            price: number | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            teacherId: number | null;
        };
    } & {
        id: number;
        name: string;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    createLesson(courseId: number, dto: CreateLessonDto): Promise<{
        description: string | null;
        title: string;
        createdAt: Date;
        id: number;
        courseId: number;
        order: number;
        videoUrl: string | null;
    }>;
    createMaterial(lessonId: number, dto: CreateMaterialDto): Promise<{
        title: string;
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
}
