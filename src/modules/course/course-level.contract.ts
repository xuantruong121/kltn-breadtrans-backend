export const COURSE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

export type CourseLevel = (typeof COURSE_LEVELS)[number];
