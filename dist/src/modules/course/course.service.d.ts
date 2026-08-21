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
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        level: string | null;
        thumbnail: string | null;
    }>;
    getAllCourses(userId?: number, role?: string): Promise<{
        classId: number;
        className: string;
        classStatus: import(".prisma/client").$Enums.ClassStatus;
        meetingLink: string | null;
        startDate: Date | null;
        endDate: Date | null;
        progress: number;
        enrollmentStatus: import(".prisma/client").$Enums.EnrollmentStatus;
        joinedAt: Date;
        studentCount: number;
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
                avatar: string | null;
            } | null;
        };
        course: {
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
            lessons: {
                videoUrl: string | null;
            }[];
        } & {
            createdAt: Date;
            id: number;
            title: string;
            description: string | null;
            updatedAt: Date;
            teacherId: number | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            level: string | null;
            thumbnail: string | null;
        };
    }[] | ({
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
            teacherId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            status: import(".prisma/client").$Enums.ClassStatus;
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
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        level: string | null;
        thumbnail: string | null;
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
            teacherId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            status: import(".prisma/client").$Enums.ClassStatus;
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
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        level: string | null;
        thumbnail: string | null;
    }>;
    deleteCourse(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        level: string | null;
        thumbnail: string | null;
    }>;
    updateCourseStatus(id: number, status: any): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        level: string | null;
        thumbnail: string | null;
    }>;
    getUserClasses(userId: number, role: string): Promise<{
        studentCount: number;
        course: {
            title: string;
        };
        _count: {
            enrollments: number;
        };
        enrollments: ({
            user: {
                id: number;
                email: string;
                profile: {
                    fullName: string;
                    avatar: string | null;
                } | null;
            };
        } & {
            id: number;
            userId: number;
            status: import(".prisma/client").$Enums.EnrollmentStatus;
            classId: number;
            joinedAt: Date;
            progress: number;
        })[];
        sessions: {
            createdAt: Date;
            id: number;
            title: string;
            meetingLink: string | null;
            status: string;
            classId: number;
            startTime: Date;
            endTime: Date;
            lessonNote: string | null;
            recordingUrl: string | null;
        }[];
        name: string;
        id: number;
        courseId: number;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        status: import(".prisma/client").$Enums.ClassStatus;
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
        sessions: {
            createdAt: Date;
            id: number;
            title: string;
            meetingLink: string | null;
            status: string;
            classId: number;
            startTime: Date;
            endTime: Date;
            lessonNote: string | null;
            recordingUrl: string | null;
        }[];
        name: string;
        id: number;
        courseId: number;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        status: import(".prisma/client").$Enums.ClassStatus;
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
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        status: import(".prisma/client").$Enums.ClassStatus;
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
            teacherId: number | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            level: string | null;
            thumbnail: string | null;
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
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        status: import(".prisma/client").$Enums.ClassStatus;
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
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        status: import(".prisma/client").$Enums.ClassStatus;
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
