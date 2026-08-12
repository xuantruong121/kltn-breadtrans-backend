import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
import { EventsGateway } from '../events/events.gateway';
export declare class CourseService {
    private prisma;
    private eventsGateway;
    constructor(prisma: PrismaService, eventsGateway: EventsGateway);
    createCourse(dto: CreateCourseDto): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        price: number | null;
        thumbnail: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    getAllCourses(userId?: number, role?: string): Promise<({
        teacher: {
            id: number;
            email: string;
            profile: {
                id: number;
                userId: number;
                fullName: string;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                parentName: string | null;
                parentPhone: string | null;
                birthYear: number | null;
                nextExamDate: string | null;
                isSelfClaimed: boolean;
            } | null;
        } | null;
        classes: {
            name: string;
            id: number;
            courseId: number;
            status: import(".prisma/client").$Enums.ClassStatus;
            teacherId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
    } & {
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        price: number | null;
        thumbnail: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    })[]>;
    getCourseById(id: number): Promise<{
        quizzes: {
            createdAt: Date;
            id: number;
            title: string;
            description: string | null;
            theoryContent: string | null;
            bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
            type: import(".prisma/client").$Enums.QuizType;
            timeLimit: number | null;
            courseId: number | null;
            practiceTopicId: number | null;
        }[];
        classes: ({
            teacher: {
                id: number;
                email: string;
                profile: {
                    id: number;
                    userId: number;
                    fullName: string;
                    avatar: string | null;
                    phone: string | null;
                    address: string | null;
                    targetScore: string | null;
                    parentName: string | null;
                    parentPhone: string | null;
                    birthYear: number | null;
                    nextExamDate: string | null;
                    isSelfClaimed: boolean;
                } | null;
            };
        } & {
            name: string;
            id: number;
            courseId: number;
            status: import(".prisma/client").$Enums.ClassStatus;
            teacherId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        })[];
    } & {
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        price: number | null;
        thumbnail: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    deleteCourse(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        price: number | null;
        thumbnail: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    updateCourseStatus(id: number, status: any): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        price: number | null;
        thumbnail: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        teacherId: number | null;
    }>;
    getUserClasses(userId: number, role: string): Promise<{
        studentCount: number;
        course: {
            title: string;
        };
        _count: {
            enrollments: number;
        };
        sessions: {
            createdAt: Date;
            id: number;
            title: string;
            status: string;
            meetingLink: string | null;
            classId: number;
            startTime: Date;
            endTime: Date;
            recordingUrl: string | null;
        }[];
        name: string;
        id: number;
        courseId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[] | {
        studentCount: number;
        course: {
            title: string;
        };
        _count: {
            enrollments: number;
        };
        teacher: {
            email: string;
            profile: {
                fullName: string;
            } | null;
        };
        name: string;
        id: number;
        courseId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    createClass(courseId: number, teacherId: number, dto: CreateClassDto): Promise<{
        name: string;
        id: number;
        courseId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    getClassById(classId: number): Promise<{
        course: {
            lessons: ({
                materials: {
                    id: number;
                    title: string;
                    fileUrl: string;
                    fileType: string | null;
                    lessonId: number;
                }[];
            } & {
                order: number;
                createdAt: Date;
                id: number;
                title: string;
                description: string | null;
                courseId: number;
                videoUrl: string | null;
            })[];
        } & {
            createdAt: Date;
            id: number;
            title: string;
            description: string | null;
            updatedAt: Date;
            price: number | null;
            thumbnail: string | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            teacherId: number | null;
        };
        teacher: {
            id: number;
            email: string;
            profile: {
                id: number;
                userId: number;
                fullName: string;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                parentName: string | null;
                parentPhone: string | null;
                birthYear: number | null;
                nextExamDate: string | null;
                isSelfClaimed: boolean;
            } | null;
        };
    } & {
        name: string;
        id: number;
        courseId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    deleteClass(id: number): Promise<{
        name: string;
        id: number;
        courseId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    createLesson(courseId: number, dto: CreateLessonDto): Promise<{
        order: number;
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        courseId: number;
        videoUrl: string | null;
    }>;
    createMaterial(lessonId: number, dto: CreateMaterialDto): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
}
