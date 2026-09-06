import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto, UpdateCourseDto, CreateClassDto, UpdateClassDto, CreateLessonDto, UpdateLessonDto, CreateMaterialDto, UpdateMaterialDto, EnrollResponseDto } from './dto/course.dto';
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
            name: string;
            id: number;
            courseId: number;
            teacherId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
            tuitionFeeVnd: number;
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
        tuitionFeeVnd: number;
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
            lessons: {
                videoUrl: string | null;
            }[];
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
    }[]>;
    getCourseById(id: number, userId?: number, role?: string): Promise<{
        classes: {
            tuitionFeeVnd: number;
            activeEnrollmentCount: number;
            totalEnrollmentCount: number;
            hasEnrollments: boolean;
            studentCount: number;
            _count: {
                enrollments: number;
            };
            enrollments: {
                id: number;
            }[];
            teacher: {
                id: number;
                email: string;
                profile: {
                    fullName: string;
                    avatar: string | null;
                } | null;
            };
            name: string;
            id: number;
            courseId: number;
            teacherId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            capacity: number | null;
            status: import(".prisma/client").$Enums.ClassStatus;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
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
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
                avatar: string | null;
            } | null;
        } | null;
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
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        teacherId: number | null;
        status: import(".prisma/client").$Enums.CourseStatus;
        level: string | null;
        thumbnail: string | null;
    } | {
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
            tuitionFeeVnd: number;
            meetingLink: null;
            teacher: {
                id: number;
                email: string;
                profile: {
                    fullName: string;
                    avatar: string | null;
                } | null;
            };
            activeEnrollmentCount: number;
            totalEnrollmentCount: number;
            hasEnrollments: boolean;
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
    revertCourseToDraft(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
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
    submitCourseForReview(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
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
    deleteCourse(id: number, user: {
        id: number;
        role: Role;
    }): Promise<{
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
    updateCourseStatus(id: number, status: CourseStatus): Promise<{
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
    createClass(courseId: number, user: {
        id: number;
        role: Role;
    }, dto: CreateClassDto): Promise<{
        course: {
            id: number;
            title: string;
        };
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
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
        capacity: number | null;
        tuitionFeeVnd: number;
        status: import(".prisma/client").$Enums.ClassStatus;
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
        activeEnrollmentCount: number;
        totalEnrollmentCount: number;
        hasEnrollments: boolean;
        studentCount: number;
        course: {
            id: number;
            title: string;
        };
        _count: {
            enrollments: number;
        };
        teacher: {
            id: number;
            email: string;
            profile: {
                fullName: string;
            } | null;
        };
        name: string;
        id: number;
        courseId: number;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        tuitionFeeVnd: number;
        status: import(".prisma/client").$Enums.ClassStatus;
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
        name: string;
        id: number;
        courseId: number;
        teacherId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        capacity: number | null;
        tuitionFeeVnd: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    getUserClasses(userId: number, role: string): Promise<{
        activeEnrollmentCount: number;
        totalEnrollmentCount: number;
        hasEnrollments: boolean;
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
        capacity: number | null;
        tuitionFeeVnd: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[] | {
        meetingLink: string | null;
        enrollmentStatus: import(".prisma/client").$Enums.EnrollmentStatus;
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
        capacity: number | null;
        tuitionFeeVnd: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    getClassById(classId: number, userId?: number, role?: string): Promise<{
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
        capacity: number | null;
        tuitionFeeVnd: number;
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    getMyEnrollmentsInCourse(courseId: number, userId: number): Promise<{
        id: number;
        status: import(".prisma/client").$Enums.EnrollmentStatus;
        classId: number;
        joinedAt: Date;
    }[]>;
    enrollInClass(classId: number, userId: number, options?: {
        isAdminOverride?: boolean;
    }): Promise<EnrollResponseDto>;
    createLesson(courseId: number, user: {
        id: number;
        role: Role;
    }, dto: CreateLessonDto): Promise<{
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
    }>;
    updateLesson(lessonId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateLessonDto): Promise<{
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
    }>;
    deleteLesson(lessonId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        order: number;
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        courseId: number;
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
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
    updateMaterial(materialId: number, user: {
        id: number;
        role: Role;
    }, dto: UpdateMaterialDto): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
    deleteMaterial(materialId: number, user: {
        id: number;
        role: Role;
    }): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
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
            order: number;
            id: number;
            title: string;
            description: string | null;
        }[];
        classes: {
            id: number;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            capacity: number;
            tuitionFeeVnd: number;
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
