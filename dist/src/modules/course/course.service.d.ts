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
            status: import(".prisma/client").$Enums.ClassStatus;
            id: number;
            teacherId: number;
            name: string;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
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
    }[]>;
    getCourseById(id: number, userId?: number, role?: string): Promise<({
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
            status: import(".prisma/client").$Enums.ClassStatus;
            id: number;
            teacherId: number;
            name: string;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
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
    }) | {
        lessons: {
            id: number;
            courseId: number;
            title: string;
            description: string | null;
            order: number;
            videoUrl: null;
            createdAt: Date;
            materials: {
                id: number;
                lessonId: number;
                title: string;
                fileType: string | null;
                fileUrl: null;
            }[];
        }[];
        classes: {
            id: number;
            courseId: number;
            name: string;
            status: import(".prisma/client").$Enums.ClassStatus;
            startDate: Date | null;
            endDate: Date | null;
            capacity: number | null;
            meetingLink: null;
            teacher: {
                id: number;
                email: string;
                profile: {
                    fullName: string;
                    avatar: string | null;
                } | null;
            };
            studentCount: number;
            _count: {
                enrollments: number;
            };
        }[];
        quizzes: never[];
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
                avatar: string | null;
            } | null;
        } | null;
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
    revertCourseToDraft(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
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
    submitCourseForReview(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
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
    deleteCourse(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
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
    updateCourseStatus(id: number, status: CourseStatus): Promise<{
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
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
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
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
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
        status: import(".prisma/client").$Enums.ClassStatus;
        id: number;
        teacherId: number;
        name: string;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
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
            createdAt: Date;
            id: number;
            classId: number;
            meetingLink: string | null;
            startTime: Date;
            endTime: Date;
            lessonNote: string | null;
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
        capacity: number | null;
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
            createdAt: Date;
            id: number;
            classId: number;
            meetingLink: string | null;
            startTime: Date;
            endTime: Date;
            lessonNote: string | null;
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
        capacity: number | null;
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
        capacity: number | null;
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
            status: import(".prisma/client").$Enums.ClassStatus;
            id: number;
            teacherId: number;
            name: string;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
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
    }>;
    updateLesson(lessonId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateLessonDto): Promise<{
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
    }>;
    deleteLesson(lessonId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        title: string;
        description: string | null;
        createdAt: Date;
        id: number;
        courseId: number;
        order: number;
        videoUrl: string | null;
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
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
    updateMaterial(materialId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateMaterialDto): Promise<{
        title: string;
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
    deleteMaterial(materialId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        title: string;
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
    getPublicCatalog(): Promise<{
        id: number;
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        teacher: {
            id: number | null;
            fullName: string;
            avatar: string | null;
        };
        upcomingClassCount: number;
    }[]>;
    getPublicCourseDetail(id: number): Promise<{
        id: number;
        title: string;
        description: string | null;
        thumbnail: string | null;
        level: string | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        createdAt: Date;
        teacher: {
            id: number | null;
            fullName: string;
            avatar: string | null;
            specialization: string | null;
        };
        lessons: {
            title: string;
            description: string | null;
            id: number;
            order: number;
        }[];
        classes: {
            id: number;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            capacity: number;
            currentEnrollmentCount: number;
            remainingSeats: number;
            isSoldOut: boolean;
            status: import(".prisma/client").$Enums.ClassStatus;
            teacher: {
                id: number;
                fullName: string;
                avatar: string | null;
            };
        }[];
    }>;
}
