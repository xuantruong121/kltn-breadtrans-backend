import { NotFoundException } from '@nestjs/common';

/**
 * A learner's write that failed on a foreign key because the content it
 * points to was deleted while it ran (P2003): "not found", with the
 * caller's message, instead of a server error (2026-11-18). Since the A5
 * fix, a delete holds the content row while it checks for attempts, so an
 * attempt saved at that moment waits, then lands on a deleted row.
 */
export async function notFoundIfGone<T>(
  work: Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'P2003')
      throw new NotFoundException(message);
    throw error;
  }
}
