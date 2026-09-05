import { CourseService } from './course.service';
import { CreateCourseDto, UpdateCourseDto, ReviewCourseDto, CreateClassDto, UpdateClassDto, CreateLessonDto, UpdateLessonDto, ReorderLessonsDto, CreateMaterialDto, UpdateMaterialDto } from './dto/course.dto';
import { CourseStatus } from '@prisma/client';
export declare class CourseController {
    private readonly courseService;
    constructor(courseService: CourseService);
    createCourse(createCourseDto: CreateCourseDto, req: any): Promise<{
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
    getAllCourses(req: any, role?: string): Promise<({
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
    getMyCourses(req: any): Promise<({
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
    getUserClasses(req: any): Promise<{
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
    getCourseById(id: number, req: any): Promise<({
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
    updateCourse(id: number, dto: UpdateCourseDto, req: any): Promise<{
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
    submitCourseForReview(id: number, req: any): Promise<{
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
    revertCourseToDraft(id: number, req: any): Promise<{
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
    reviewCourse(id: number, dto: ReviewCourseDto, req: any): Promise<{
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
    deleteCourse(id: number, req: any): Promise<{
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
    createClass(courseId: number, dto: CreateClassDto, req: any): Promise<{
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
    updateClass(classId: number, dto: UpdateClassDto, req: any): Promise<{
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
    deleteClass(classId: number, req: any): Promise<{
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
    enrollInClass(classId: number, req: any): Promise<{
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
    getClassById(classId: number, req: any): Promise<{
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
    createLesson(courseId: number, dto: CreateLessonDto, req: any): Promise<{
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
    updateLesson(lessonId: number, dto: UpdateLessonDto, req: any): Promise<{
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
    deleteLesson(lessonId: number, req: any): Promise<{
        title: string;
        description: string | null;
        createdAt: Date;
        id: number;
        courseId: number;
        order: number;
        videoUrl: string | null;
    }>;
    reorderLessons(courseId: number, dto: ReorderLessonsDto, req: any): Promise<{
        success: boolean;
        message: string;
    }>;
    createMaterial(lessonId: number, dto: CreateMaterialDto, req: any): Promise<{
        title: string;
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
    updateMaterial(materialId: number, dto: UpdateMaterialDto, req: any): Promise<{
        title: string;
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
    deleteMaterial(materialId: number, req: any): Promise<{
        title: string;
        id: number;
        lessonId: number;
        fileUrl: string;
        fileType: string | null;
    }>;
}
