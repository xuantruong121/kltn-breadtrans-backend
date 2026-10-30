import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CoursesEnabledGuard } from './courses-enabled.guard';
import { CourseController } from '../../modules/course/course.controller';
import { CoursePublicController } from '../../modules/course/course-public.controller';
import { CourseV5AdminController } from '../../modules/course/course-v5-admin.controller';

describe('CoursesEnabledGuard', () => {
  const original = process.env.COURSES_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.COURSES_ENABLED;
    else process.env.COURSES_ENABLED = original;
  });

  it('answers 404 while courses are hidden (flag unset or not "true")', () => {
    const guard = new CoursesEnabledGuard();
    delete process.env.COURSES_ENABLED;
    expect(() => guard.canActivate()).toThrow(NotFoundException);
    process.env.COURSES_ENABLED = '1';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('lets requests through when COURSES_ENABLED=true', () => {
    process.env.COURSES_ENABLED = 'true';
    expect(new CoursesEnabledGuard().canActivate()).toBe(true);
  });

  it('guards every course controller at class level', () => {
    for (const controller of [
      CourseController,
      CoursePublicController,
      CourseV5AdminController,
    ]) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      expect(guards[0]).toBe(CoursesEnabledGuard);
    }
  });
});
