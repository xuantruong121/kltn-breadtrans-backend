import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/** Courses are hidden unless COURSES_ENABLED=true (owner decision 2026-10-30). */
export function coursesEnabled(): boolean {
  return process.env.COURSES_ENABLED === 'true';
}

/**
 * Answers 404 for every course route while courses are hidden. Applied at
 * controller level, so it runs before authentication: a hidden route looks
 * like no route at all. Code and data stay; the flag brings them back.
 */
@Injectable()
export class CoursesEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!coursesEnabled()) throw new NotFoundException();
    return true;
  }
}
