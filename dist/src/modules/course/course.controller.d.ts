import { CourseService } from './course.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
export declare class CourseController {
    private readonly courseService;
    constructor(courseService: CourseService);
    createCourse(createCourseDto: CreateCourseDto): Promise<{
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    }>;
    getAllCourses(): Promise<({
        classes: {
            id: number;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            courseId: number;
            teacherId: number;
        }[];
    } & {
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    })[]>;
    getCourseById(id: number): Promise<{
        classes: ({
            teacher: {
                profile: {
                    fullName: string;
                    id: number;
                    avatar: string | null;
                    phone: string | null;
                    address: string | null;
                    targetScore: string | null;
                    userId: number;
                } | null;
                email: string;
                id: number;
            };
        } & {
            id: number;
            name: string;
            startDate: Date | null;
            endDate: Date | null;
            meetingLink: string | null;
            courseId: number;
            teacherId: number;
        })[];
        quizzes: {
            type: import("@prisma/client").$Enums.QuizType;
            description: string | null;
            title: string;
            id: number;
            createdAt: Date;
            courseId: number | null;
            timeLimit: number | null;
        }[];
    } & {
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    }>;
    deleteCourse(id: number): Promise<{
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        thumbnail: string | null;
        price: number | null;
    }>;
    createClass(courseId: number, dto: CreateClassDto, req: any): Promise<{
        id: number;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        courseId: number;
        teacherId: number;
    }>;
    getClassById(classId: number): Promise<{
        teacher: {
            profile: {
                fullName: string;
                id: number;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                userId: number;
            } | null;
            email: string;
            id: number;
        };
        lessons: ({
            materials: {
                title: string;
                id: number;
                fileUrl: string;
                fileType: string | null;
                lessonId: number;
            }[];
        } & {
            description: string | null;
            title: string;
            id: number;
            createdAt: Date;
            order: number;
            videoUrl: string | null;
            classId: number;
        })[];
    } & {
        id: number;
        name: string;
        startDate: Date | null;
        endDate: Date | null;
        meetingLink: string | null;
        courseId: number;
        teacherId: number;
    }>;
    createLesson(classId: number, dto: CreateLessonDto): Promise<{
        description: string | null;
        title: string;
        id: number;
        createdAt: Date;
        order: number;
        videoUrl: string | null;
        classId: number;
    }>;
    createMaterial(lessonId: number, dto: CreateMaterialDto): Promise<{
        title: string;
        id: number;
        fileUrl: string;
        fileType: string | null;
        lessonId: number;
    }>;
}
