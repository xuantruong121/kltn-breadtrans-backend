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

export const ADMIN_PAYMENT_SUMMARY_SELECT = {
  id: true,
  enrollmentId: true,
  amountVnd: true,
  transferCode: true,
  status: true,
  createdAt: true,
  reportedAt: true,
  reviewedAt: true,
  confirmedAt: true,
  // Note: adminNote and student.phone are intentionally excluded from summary list to minimize PII
  enrollment: {
    select: {
      id: true,
      user: {
        select: {
          id: true,
          email: true,
          profile: {
            select: {
              fullName: true,
            },
          },
        },
      },
      class: {
        select: {
          id: true,
          name: true,
          tuitionFeeVnd: true,
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
  reviewedBy: {
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          fullName: true,
        },
      },
    },
  },
} as const satisfies Prisma.PaymentSelect;

export const ADMIN_PAYMENT_DETAIL_SELECT = {
  id: true,
  enrollmentId: true,
  amountVnd: true,
  transferCode: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  reportedAt: true,
  reviewedAt: true,
  confirmedAt: true,
  adminNote: true,
  enrollment: {
    select: {
      id: true,
      status: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          profile: {
            select: {
              fullName: true,
              phone: true,
            },
          },
        },
      },
      class: {
        select: {
          id: true,
          name: true,
          tuitionFeeVnd: true,
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
  reviewedBy: {
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          fullName: true,
        },
      },
    },
  },
} as const satisfies Prisma.PaymentSelect;
