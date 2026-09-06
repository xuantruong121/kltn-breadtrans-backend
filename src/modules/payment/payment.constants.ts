import { Prisma } from '@prisma/client';

export const STUDENT_PAYMENT_SUMMARY_SELECT = {
  id: true,
  enrollmentId: true,
  amountVnd: true,
  transferCode: true,
  status: true,
  createdAt: true,
  reportedAt: true,
  confirmedAt: true,
  enrollment: {
    select: {
      class: {
        select: {
          id: true,
          name: true,
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.PaymentSelect;

export const STUDENT_PAYMENT_DETAIL_SELECT = {
  id: true,
  enrollmentId: true,
  amountVnd: true,
  transferCode: true,
  status: true,
  createdAt: true,
  reportedAt: true,
  confirmedAt: true,
  updatedAt: true,
  enrollment: {
    select: {
      class: {
        select: {
          id: true,
          name: true,
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.PaymentSelect;
