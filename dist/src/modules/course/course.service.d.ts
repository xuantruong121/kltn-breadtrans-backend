import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
import { EventsGateway } from '../events/events.gateway';
export declare class CourseService {
    private prisma;
    private eventsGateway;
    constructor(prisma: PrismaService, eventsGateway: EventsGateway);
    createCourse(dto: CreateCourseDto): Promise<{
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        teacherId: number | null;
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
            title: string;
            description: string | null;
            thumbnail: string | null;
            level: string | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            createdAt: Date;
            updatedAt: Date;
            id: number;
            teacherId: number | null;
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
            status: import(".prisma/client").$Enums.ClassStatus;
            id: number;
            teacherId: number;
            name: string;
            courseId: number;
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
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        teacherId: number | null;
    })[]>;
    getCourseById(id: number): Promise<{
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
            status: import(".prisma/client").$Enums.ClassStatus;
            id: number;
            teacherId: number;
            name: string;
            courseId: number;
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
        quizzes: {
            title: string;
            description: string | null;
            createdAt: Date;
            id: number;
            courseId: number | null;
            practiceTopicId: number | null;
            theoryContent: string | null;
            bilingualContent: import("@prisma/client/runtime/library").JsonValue | null;
            type: import(".prisma/client").$Enums.QuizType;
            timeLimit: number | null;
        }[];
    } & {
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        teacherId: number | null;
    }>;
    deleteCourse(id: number): Promise<{
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
        teacherId: number | null;
    }>;
    updateCourseStatus(id: number, status: any): Promise<{
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
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
            status: import(".prisma/client").$Enums.EnrollmentStatus;
            id: number;
            userId: number;
            classId: number;
            joinedAt: Date;
            progress: number;
        })[];
        sessions: {
            title: string;
            status: string;
            createdAt: Date;
            id: number;
            classId: number;
            meetingLink: string | null;
            startTime: Date;
            endTime: Date;
            recordingUrl: string | null;
        }[];
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
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
        sessions: {
            title: string;
            status: string;
            createdAt: Date;
            id: number;
            classId: number;
            meetingLink: string | null;
            startTime: Date;
            endTime: Date;
            recordingUrl: string | null;
        }[];
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
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
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
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
                title: string;
                description: string | null;
                createdAt: Date;
                id: number;
                courseId: number;
                order: number;
                videoUrl: string | null;
            })[];
        } & {
            title: string;
            description: string | null;
            thumbnail: string | null;
            level: string | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            createdAt: Date;
            updatedAt: Date;
            id: number;
            teacherId: number | null;
        };
    } & {
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
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
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
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
        title: string;
        description: string | null;
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
