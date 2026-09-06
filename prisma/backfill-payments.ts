import { PrismaClient, EnrollmentStatus, PaymentStatus } from '@prisma/client';

export interface BackfillOptions {
  dryRun?: boolean;
  prismaClient?: PrismaClient;
}

export interface BackfillResult {
  totalCandidates: number;
  createdCount: number;
  inconsistentCount: number;
  skippedCount: number;
  errorCount: number;
}

/**
 * Mask sensitive password in database connection URL for safe logging.
 */
export function maskDatabaseUrl(url?: string): string {
  if (!url) return 'UNDEFINED';
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

/**
 * Execute the historical Payment backfill.
 * Targets: Enrollment.status = PENDING_PAYMENT with no existing Payment record.
 */
export async function runPaymentBackfill(
  options?: BackfillOptions,
): Promise<BackfillResult> {
  const isDryRun = options?.dryRun ?? false;
  const prisma = options?.prismaClient ?? new PrismaClient();
  const shouldDisconnect = !options?.prismaClient;

  const result: BackfillResult = {
    totalCandidates: 0,
    createdCount: 0,
    inconsistentCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  try {
    // 1. Report connected database identity using real PostgreSQL metadata
    console.log('==================================================');
    console.log('BREADTRANS — HISTORICAL PAYMENT BACKFILL UTILITY');
    console.log('==================================================');

    const [dbInfo] = await prisma.$queryRaw<
      Array<{
        db: string;
        schema: string;
        server_addr: string | null;
        server_port: number | null;
      }>
    >`SELECT current_database() AS db, current_schema() AS schema, inet_server_addr()::text AS server_addr, inet_server_port() AS server_port;`;

    const configuredUrl = process.env.DATABASE_URL || '';
    console.log(`Configured URL : ${maskDatabaseUrl(configuredUrl)}`);
    console.log(`Connected DB   : ${dbInfo?.db ?? 'unknown'}`);
    console.log(`Current Schema : ${dbInfo?.schema ?? 'unknown'}`);
    console.log(`Server Address : ${dbInfo?.server_addr ?? 'N/A'}:${dbInfo?.server_port ?? 'N/A'}`);
    console.log(`Execution Mode : ${isDryRun ? 'DRY-RUN (NO WRITES)' : 'LIVE MUTATION'}`);
    console.log('==================================================');

    // 2. Query candidates: status = PENDING_PAYMENT, payment = null
    const candidates = await prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.PENDING_PAYMENT,
        payment: null,
      },
      include: {
        class: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    result.totalCandidates = candidates.length;
    console.log(`Found ${candidates.length} candidate Enrollment row(s) requiring inspection.`);

    // 3. Process each candidate
    for (const candidate of candidates) {
      const tuitionFeeVnd = candidate.class?.tuitionFeeVnd ?? 0;
      const transferCode = `BT-${candidate.id}`;

      // Inconsistent check: tuition fee <= 0
      if (tuitionFeeVnd <= 0) {
        console.warn(
          `[INCONSISTENT DATA] Enrollment #${candidate.id} (User #${candidate.userId}, Class #${candidate.classId}) has status PENDING_PAYMENT but Class tuitionFeeVnd is ${tuitionFeeVnd}. Skipping Payment creation.`,
        );
        result.inconsistentCount++;
        continue;
      }

      // Valid candidate: tuition fee > 0
      if (isDryRun) {
        console.log(
          `[DRY-RUN] Candidate #${candidate.id}: Would create Payment { enrollmentId: ${candidate.id}, amountVnd: ${tuitionFeeVnd}, transferCode: '${transferCode}', status: PENDING }`,
        );
        result.createdCount++;
      } else {
        try {
          await prisma.payment.create({
            data: {
              enrollmentId: candidate.id,
              amountVnd: tuitionFeeVnd,
              transferCode,
              status: PaymentStatus.PENDING,
            },
          });
          console.log(
            `[CREATED] Payment for Enrollment #${candidate.id}: amount ${tuitionFeeVnd} VND, transferCode '${transferCode}'`,
          );
          result.createdCount++;
        } catch (error: any) {
          if (error.code === 'P2002') {
            // Re-query existing Payment to verify identity before classifying as safe skip
            const existing = await prisma.payment.findUnique({
              where: { enrollmentId: candidate.id },
            });

            if (
              existing &&
              existing.enrollmentId === candidate.id &&
              existing.transferCode === transferCode &&
              existing.amountVnd === tuitionFeeVnd
            ) {
              console.log(
                `[SAFE SKIP] Enrollment #${candidate.id}: Consistent Payment #${existing.id} already exists concurrently.`,
              );
              result.skippedCount++;
            } else {
              console.error(
                `[INCONSISTENT / UNEXPECTED ERROR] Enrollment #${candidate.id}: Unique constraint collision (P2002) does not match expected candidate identity! Existing: ${JSON.stringify(existing)}`,
              );
              result.errorCount++;
            }
          } else {
            console.error(
              `[UNEXPECTED ERROR] Enrollment #${candidate.id}: Failed to create Payment: ${error.message}`,
            );
            result.errorCount++;
          }
        }
      }
    }

    // 4. Output summary
    console.log('==================================================');
    console.log('BACKFILL EXECUTION SUMMARY');
    console.log('==================================================');
    console.log(`Candidates Evaluated       : ${result.totalCandidates}`);
    console.log(`Payments Created           : ${result.createdCount}`);
    console.log(`Inconsistent Rows Skipped  : ${result.inconsistentCount}`);
    console.log(`Concurrent Safe Skips      : ${result.skippedCount}`);
    console.log(`Unexpected Errors          : ${result.errorCount}`);
    console.log('==================================================');

    return result;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

// CLI Execution entry point
if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  runPaymentBackfill({ dryRun: isDryRun })
    .then((result) => {
      if (result.errorCount > 0) {
        console.error(`Backfill finished with ${result.errorCount} unexpected error(s).`);
        process.exit(1);
      }
      console.log('Backfill process completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal backfill error:', err);
      process.exit(1);
    });
}
