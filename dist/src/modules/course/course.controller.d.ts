import { CourseService } from './course.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
export declare class CourseController {
    private readonly courseService;
    constructor(courseService: CourseService);
    createCourse(createCourseDto: CreateCourseDto): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    }>;
    getAllCourses(): Promise<({
        classes: {
            name: string;
            id: number;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            teacherId: number;
        }[];
    } & {
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
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
                } | null;
            };
        } & {
            name: string;
            id: number;
            courseId: number;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            teacherId: number;
        })[];
    } & {
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    }>;
    deleteCourse(id: number): Promise<{
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    }>;
    createClass(courseId: number, dto: CreateClassDto, req: any): Promise<{
        name: string;
        id: number;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        teacherId: number;
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
            } | null;
        };
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
            videoUrl: string | null;
            classId: number;
        })[];
    } & {
        name: string;
        id: number;
        courseId: number;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        teacherId: number;
    }>;
    createLesson(classId: number, dto: CreateLessonDto): Promise<{
        order: number;
        createdAt: Date;
        id: number;
        title: string;
        description: string | null;
        videoUrl: string | null;
        classId: number;
    }>;
    createMaterial(lessonId: number, dto: CreateMaterialDto): Promise<{
        id: number;
        title: string;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
}
