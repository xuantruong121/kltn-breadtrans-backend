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
    }[]>;
    getUserClasses(req: any): Promise<{
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
        capacity: number | null;
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
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
            teacher: {
                id: number;
                email: string;
                profile: {
                    fullName: string;
                    avatar: string | null;
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
            status: import(".prisma/client").$Enums.ClassStatus;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        })[];
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
    submitCourseForReview(id: number, req: any): Promise<{
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
    revertCourseToDraft(id: number, req: any): Promise<{
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
    reviewCourse(id: number, dto: ReviewCourseDto, req: any): Promise<{
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
    deleteCourse(id: number, req: any): Promise<{
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
    createClass(courseId: number, dto: CreateClassDto, req: any): Promise<{
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
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    updateClass(classId: number, dto: UpdateClassDto, req: any): Promise<{
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
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    deleteClass(classId: number, req: any): Promise<{
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
    }>;
    enrollInClass(classId: number, req: any): Promise<{
        class: {
            course: {
                id: number;
                title: string;
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
            status: import(".prisma/client").$Enums.ClassStatus;
            links: import("@prisma/client/runtime/library").JsonValue | null;
            summary: import("@prisma/client/runtime/library").JsonValue | null;
            noteProcess: string | null;
            rank: import("@prisma/client/runtime/library").JsonValue | null;
            stories: import("@prisma/client/runtime/library").JsonValue | null;
            pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
        };
    } & {
        id: number;
        userId: number;
        status: import(".prisma/client").$Enums.EnrollmentStatus;
        classId: number;
        joinedAt: Date;
        progress: number;
    }>;
    getClassById(classId: number, req: any): Promise<{
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
        status: import(".prisma/client").$Enums.ClassStatus;
        links: import("@prisma/client/runtime/library").JsonValue | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        noteProcess: string | null;
        rank: import("@prisma/client/runtime/library").JsonValue | null;
        stories: import("@prisma/client/runtime/library").JsonValue | null;
        pendingEvaluations: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    createLesson(courseId: number, dto: CreateLessonDto, req: any): Promise<{
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
    updateLesson(lessonId: number, dto: UpdateLessonDto, req: any): Promise<{
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
    deleteLesson(lessonId: number, req: any): Promise<{
        order: number;
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        courseId: number;
        videoUrl: string | null;
    }>;
    reorderLessons(courseId: number, dto: ReorderLessonsDto, req: any): Promise<{
        success: boolean;
        message: string;
    }>;
    createMaterial(lessonId: number, dto: CreateMaterialDto, req: any): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
    updateMaterial(materialId: number, dto: UpdateMaterialDto, req: any): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
    deleteMaterial(materialId: number, req: any): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
}
