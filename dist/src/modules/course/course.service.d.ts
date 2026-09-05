import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto, UpdateCourseDto, CreateClassDto, UpdateClassDto, CreateLessonDto, UpdateLessonDto, CreateMaterialDto, UpdateMaterialDto } from './dto/course.dto';
import { EventsGateway } from '../events/events.gateway';
import { Role, CourseStatus } from '@prisma/client';
export declare class CourseService {
    private prisma;
    private eventsGateway;
    constructor(prisma: PrismaService, eventsGateway: EventsGateway);
    createCourse(dto: CreateCourseDto, user: {
        id: number;
        role: Role;
    }): Promise<{
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
                avatar: string | null;
            } | null;
        } | null;
    } & {
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    getAllCourses(userId?: number, role?: string): Promise<({
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
                avatar: string | null;
            } | null;
        } | null;
        classes: ({
            _count: {
                enrollments: number;
            };
        } & {
            teacherId: number;
            status: import(".prisma/client").$Enums.ClassStatus;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
            id: number;
            courseId: number;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        })[];
    } & {
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    })[] | {
        classId: number;
        className: string;
        classStatus: import(".prisma/client").$Enums.ClassStatus;
        meetingLink: string | null;
        startDate: Date | null;
        endDate: Date | null;
        capacity: number | null;
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
            description: string | null;
            title: string;
            thumbnail: string | null;
            level: string | null;
            teacherId: number | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            createdAt: Date;
            updatedAt: Date;
            id: number;
        };
    }[]>;
    getCourseById(id: number): Promise<{
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
                avatar: string | null;
            } | null;
        } | null;
        classes: ({
            teacher: {
                id: number;
                email: string;
                profile: {
                    fullName: string;
                    avatar: string | null;
                } | null;
            };
            _count: {
                enrollments: number;
            };
        } & {
            teacherId: number;
            status: import(".prisma/client").$Enums.ClassStatus;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
            id: number;
            courseId: number;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        })[];
        lessons: ({
            materials: {
                title: string;
                fileUrl: string;
                fileType: string | null;
                id: number;
                lessonId: number;
            }[];
        } & {
            description: string | null;
            title: string;
            order: number;
            videoUrl: string | null;
            createdAt: Date;
            id: number;
            courseId: number;
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
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    updateCourse(id: number, dto: UpdateCourseDto, user: {
        id: number;
        role: Role;
    }): Promise<{
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
            } | null;
        } | null;
    } & {
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    revertCourseToDraft(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    submitCourseForReview(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    reviewCourse(id: number, action: 'APPROVE' | 'REJECT', user: {
        id: number;
        role: Role;
    }): Promise<{
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
            } | null;
        } | null;
    } & {
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    deleteCourse(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    updateCourseStatus(id: number, status: CourseStatus): Promise<{
        description: string | null;
        title: string;
        thumbnail: string | null;
        level: string | null;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        updatedAt: Date;
        id: number;
    }>;
    createClass(courseId: number, user: {
        id: number;
        role: Role;
    }, dto: CreateClassDto): Promise<{
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
            } | null;
        };
        course: {
            title: string;
            id: number;
        };
    } & {
        teacherId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        id: number;
        courseId: number;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    updateClass(classId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateClassDto): Promise<{
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
            } | null;
        };
        course: {
            title: string;
            id: number;
        };
    } & {
        teacherId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        id: number;
        courseId: number;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    deleteClass(classId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        teacherId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        id: number;
        courseId: number;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    getUserClasses(userId: number, role: string): Promise<{
        studentCount: number;
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
        _count: {
            enrollments: number;
        };
        course: {
            title: string;
        };
        sessions: {
            title: string;
            status: string;
            meetingLink: string | null;
            createdAt: Date;
            id: number;
            classId: number;
            startTime: Date;
            endTime: Date;
            lessonNote: string | null;
            recordingUrl: string | null;
        }[];
        teacherId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        id: number;
        courseId: number;
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
        _count: {
            enrollments: number;
        };
        course: {
            title: string;
        };
        sessions: {
            title: string;
            status: string;
            meetingLink: string | null;
            createdAt: Date;
            id: number;
            classId: number;
            startTime: Date;
            endTime: Date;
            lessonNote: string | null;
            recordingUrl: string | null;
        }[];
        teacherId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        id: number;
        courseId: number;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    getClassById(classId: number, userId?: number, role?: string): Promise<{
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
                    fileUrl: string;
                    fileType: string | null;
                    id: number;
                    lessonId: number;
                }[];
            } & {
                description: string | null;
                title: string;
                order: number;
                videoUrl: string | null;
                createdAt: Date;
                id: number;
                courseId: number;
            })[];
        } & {
            description: string | null;
            title: string;
            thumbnail: string | null;
            level: string | null;
            teacherId: number | null;
            status: import(".prisma/client").$Enums.CourseStatus;
            createdAt: Date;
            updatedAt: Date;
            id: number;
        };
    } & {
        teacherId: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        id: number;
        courseId: number;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    enrollInClass(classId: number, userId: number): Promise<{
        class: {
            course: {
                title: string;
                id: number;
            };
        } & {
            teacherId: number;
            status: import(".prisma/client").$Enums.ClassStatus;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
            id: number;
            courseId: number;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        };
    } & {
        status: import(".prisma/client").$Enums.EnrollmentStatus;
        id: number;
        userId: number;
        classId: number;
        joinedAt: Date;
        progress: number;
    }>;
    createLesson(courseId: number, user: {
        id: number;
        role: Role;
    }, dto: CreateLessonDto): Promise<{
        materials: {
            title: string;
            fileUrl: string;
            fileType: string | null;
            id: number;
            lessonId: number;
        }[];
    } & {
        description: string | null;
        title: string;
        order: number;
        videoUrl: string | null;
        createdAt: Date;
        id: number;
        courseId: number;
    }>;
    updateLesson(lessonId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateLessonDto): Promise<{
        materials: {
            title: string;
            fileUrl: string;
            fileType: string | null;
            id: number;
            lessonId: number;
        }[];
    } & {
        description: string | null;
        title: string;
        order: number;
        videoUrl: string | null;
        createdAt: Date;
        id: number;
        courseId: number;
    }>;
    deleteLesson(lessonId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        description: string | null;
        title: string;
        order: number;
        videoUrl: string | null;
        createdAt: Date;
        id: number;
        courseId: number;
    }>;
    reorderLessons(courseId: number, user: {
        id: number;
        role: Role;
    }, lessonIds: number[]): Promise<{
        success: boolean;
        message: string;
    }>;
    createMaterial(lessonId: number, user: {
        id: number;
        role: Role;
    }, dto: CreateMaterialDto): Promise<{
        title: string;
        fileUrl: string;
        fileType: string | null;
        id: number;
        lessonId: number;
    }>;
    updateMaterial(materialId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateMaterialDto): Promise<{
        title: string;
        fileUrl: string;
        fileType: string | null;
        id: number;
        lessonId: number;
    }>;
    deleteMaterial(materialId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        title: string;
        fileUrl: string;
        fileType: string | null;
        id: number;
        lessonId: number;
    }>;
}
