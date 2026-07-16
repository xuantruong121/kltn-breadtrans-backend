import { CourseService } from './course.service';
import { CreateCourseDto, CreateClassDto, CreateLessonDto, CreateMaterialDto } from './dto/course.dto';
export declare class CourseController {
    private readonly courseService;
    constructor(courseService: CourseService);
    createCourse(createCourseDto: CreateCourseDto): Promise<{
        createdAt: Date;
        updatedAt: Date;
        id: number;
        description: string | null;
        title: string;
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
        createdAt: Date;
        updatedAt: Date;
        id: number;
        description: string | null;
        title: string;
        thumbnail: string | null;
        price: number | null;
    })[]>;
    getCourseById(id: number): Promise<{
        classes: ({
            teacher: {
                email: string;
                profile: {
                    id: number;
                    fullName: string;
                    avatar: string | null;
                    phone: string | null;
                    address: string | null;
                    targetScore: string | null;
                    userId: number;
                } | null;
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
            createdAt: Date;
            id: number;
            description: string | null;
            type: import(".prisma/client").$Enums.QuizType;
            title: string;
            courseId: number | null;
            timeLimit: number | null;
        }[];
    } & {
        createdAt: Date;
        updatedAt: Date;
        id: number;
        description: string | null;
        title: string;
        thumbnail: string | null;
        price: number | null;
    }>;
    deleteCourse(id: number): Promise<{
        createdAt: Date;
        updatedAt: Date;
        id: number;
        description: string | null;
        title: string;
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
            email: string;
            profile: {
                id: number;
                fullName: string;
                avatar: string | null;
                phone: string | null;
                address: string | null;
                targetScore: string | null;
                userId: number;
            } | null;
            id: number;
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
            createdAt: Date;
            id: number;
            description: string | null;
            title: string;
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
        createdAt: Date;
        id: number;
        description: string | null;
        title: string;
        order: number;
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
