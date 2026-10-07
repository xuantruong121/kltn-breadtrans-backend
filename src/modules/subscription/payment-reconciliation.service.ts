import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BankTransactionMatchStatus,
  PlanPaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NormalizedBankTransaction } from './bank-transaction.provider';
import { PlanPurchaseService } from './plan-purchase.service';
import { SepayTransactionProvider } from './sepay-transaction.provider';

export type ReconciliationResult = {
  bankTransactionId: number;
  matchStatus: BankTransactionMatchStatus;
  planPurchaseId: number | null;
  duplicate: boolean;
};

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planPurchaseService: PlanPurchaseService,
    private readonly provider: SepayTransactionProvider,
  ) {}

  async ingest(
    incoming: NormalizedBankTransaction,
  ): Promise<ReconciliationResult> {
    return this.prisma.$transaction(async (tx) => {
      const bankTransaction = await this.getOrCreateBankTransaction(
        tx,
        incoming,
      );
      if (bankTransaction.matchStatus !== BankTransactionMatchStatus.RECEIVED) {
        return {
          bankTransactionId: bankTransaction.id,
          matchStatus: bankTransaction.matchStatus,
          planPurchaseId: null,
          duplicate: true,
        };
      }

      if (
        incoming.transferType !== 'in' ||
        incoming.amount <= 0 ||
        incoming.currency !== 'VND'
      ) {
        const ignored = await tx.bankTransaction.update({
          where: { id: bankTransaction.id },
          data: { matchStatus: BankTransactionMatchStatus.IGNORED },
        });
        return {
          bankTransactionId: ignored.id,
          matchStatus: ignored.matchStatus,
          planPurchaseId: null,
          duplicate: false,
        };
      }

      const payments = await tx.planPayment.findMany({
        include: { planPurchase: true },
      });
      const codeMatches = payments.filter((payment) =>
        this.paymentCodeMatches(payment.transferCode, incoming),
      );
      const matches = codeMatches.filter(
        (payment) =>
          (payment.status === PlanPaymentStatus.PENDING ||
            payment.status === PlanPaymentStatus.REPORTED) &&
          payment.planPurchase.status === 'PENDING_PAYMENT',
      );
      if (matches.length !== 1) {
        if (matches.length === 0) {
          const historicalMatch = codeMatches[0];
          if (
            historicalMatch &&
            historicalMatch.status === PlanPaymentStatus.CONFIRMED
          ) {
            const duplicate = await tx.bankTransaction.update({
              where: { id: bankTransaction.id },
              data: {
                matchStatus: BankTransactionMatchStatus.DUPLICATE,
                matchedPlanPaymentId: historicalMatch.id,
              },
            });
            return {
              bankTransactionId: duplicate.id,
              matchStatus: duplicate.matchStatus,
              planPurchaseId: historicalMatch.planPurchaseId,
              duplicate: false,
            };
          }
        }
        const review = await tx.bankTransaction.update({
          where: { id: bankTransaction.id },
          data: {
            matchStatus: BankTransactionMatchStatus.REVIEW_REQUIRED,
            matchedPlanPaymentId: codeMatches[0]?.id ?? null,
          },
        });
        return {
          bankTransactionId: review.id,
          matchStatus: review.matchStatus,
          planPurchaseId: codeMatches[0]?.planPurchaseId ?? null,
          duplicate: false,
        };
      }

      const payment = matches[0];
      const mismatch = this.getMismatch(payment, incoming);
      if (mismatch) {
        this.logger.warn(
          `Plan payment reconciliation requires review (${mismatch}) for bank transaction #${bankTransaction.id}`,
        );
        const review = await tx.bankTransaction.update({
          where: { id: bankTransaction.id },
          data: { matchStatus: BankTransactionMatchStatus.REVIEW_REQUIRED },
        });
        return {
          bankTransactionId: review.id,
          matchStatus: review.matchStatus,
          planPurchaseId: payment.planPurchaseId,
          duplicate: false,
        };
      }

      try {
        await this.planPurchaseService.confirmPurchaseFromWebhook(
          payment.planPurchaseId,
          bankTransaction.id,
          tx,
        );
      } catch (error) {
        if (
          error instanceof ConflictException ||
          error instanceof UnprocessableEntityException
        ) {
          const review = await tx.bankTransaction.update({
            where: { id: bankTransaction.id },
            data: {
              matchStatus: BankTransactionMatchStatus.REVIEW_REQUIRED,
            },
          });
          return {
            bankTransactionId: review.id,
            matchStatus: review.matchStatus,
            planPurchaseId: payment.planPurchaseId,
            duplicate: false,
          };
        }
        throw error;
      }

      const matched = await tx.bankTransaction.findUniqueOrThrow({
        where: { id: bankTransaction.id },
      });
      return {
        bankTransactionId: matched.id,
        matchStatus: matched.matchStatus,
        planPurchaseId: payment.planPurchaseId,
        duplicate: false,
      };
    });
  }

  async ingestWebhook(payload: unknown): Promise<ReconciliationResult> {
    return this.ingest(this.provider.parseWebhookPayload(payload));
  }

  private async getOrCreateBankTransaction(
    tx: Prisma.TransactionClient,
    incoming: NormalizedBankTransaction,
  ) {
    const existing = await tx.bankTransaction.findUnique({
      where: {
        provider_externalTransactionId: {
          provider: incoming.provider,
          externalTransactionId: incoming.externalTransactionId,
        },
      },
    });
    if (existing) return existing;

    try {
      return await tx.bankTransaction.create({
        data: {
          provider: incoming.provider,
          externalTransactionId: incoming.externalTransactionId,
          bankReference: incoming.bankReference,
          bankAccount: incoming.bankAccount,
          bankCode: incoming.bankCode,
          gateway: incoming.gateway,
          transferType: incoming.transferType,
          amount: incoming.amount,
          currency: incoming.currency,
          paymentCode: incoming.paymentCode,
          rawContent: incoming.rawContent,
          occurredAt: incoming.occurredAt,
        },
      });
    } catch (error) {
      const raced = await tx.bankTransaction.findUnique({
        where: {
          provider_externalTransactionId: {
            provider: incoming.provider,
            externalTransactionId: incoming.externalTransactionId,
          },
        },
      });
      if (raced) return raced;
      throw error;
    }
  }

  private paymentCodeMatches(
    transferCode: string,
    incoming: NormalizedBankTransaction,
  ): boolean {
    const expected = this.normalizeCode(transferCode);
    if (expected.length < 6) return false;
    const parsedCode = this.normalizeCode(incoming.paymentCode ?? '');
    if (parsedCode === expected) return true;
    const content = this.normalizeCode(incoming.rawContent ?? '');
    return content.includes(expected);
  }

  private getMismatch(
    payment: Prisma.PlanPaymentGetPayload<{ include: { planPurchase: true } }>,
    incoming: NormalizedBankTransaction,
  ): string | null {
    if (payment.amountVnd !== incoming.amount) return 'amount';
    if (payment.currency !== incoming.currency) return 'currency';
    if (
      !payment.bankAccountNumber ||
      payment.bankAccountNumber !== incoming.bankAccount
    ) {
      return 'receiving-account';
    }
    if (
      !payment.bankName ||
      !incoming.gateway ||
      this.normalizeBankName(payment.bankName) !==
        this.normalizeBankName(incoming.gateway)
    ) {
      return 'receiving-bank';
    }
    if (
      !payment.autoMatchUntil ||
      incoming.occurredAt < payment.planPurchase.createdAt ||
      incoming.occurredAt > payment.autoMatchUntil
    ) {
      return 'timing';
    }
    if (payment.planPurchase.status !== 'PENDING_PAYMENT')
      return 'purchase-state';
    return null;
  }

  private normalizeCode(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private normalizeBankName(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
}
