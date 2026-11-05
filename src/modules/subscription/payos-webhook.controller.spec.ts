import { ConflictException } from '@nestjs/common';
import { PayosWebhookController } from './payos-webhook.controller';

describe('PayosWebhookController', () => {
  it('returns success for the PayOS endpoint verification probe', () => {
    const controller = new PayosWebhookController({} as never, {} as never);

    expect(controller.health()).toEqual({ success: true });
  });

  it('returns the exact PayOS acknowledgement after canonical fulfillment', async () => {
    const payos = {
      resolveWebhook: jest.fn().mockResolvedValue({
        id: 91,
        type: 'PLAN',
        planPayment: { planPurchaseId: 7 },
        coursePayment: null,
      }),
      markWebhookFulfilled: jest.fn().mockResolvedValue(undefined),
    };
    const plans = {
      confirmPurchaseFromWebhook: jest.fn().mockResolvedValue({}),
    };
    const controller = new PayosWebhookController(
      payos as never,
      plans as never,
    );

    await expect(controller.receive({})).resolves.toEqual({ success: true });
    expect(plans.confirmPurchaseFromWebhook).toHaveBeenCalledWith(7, undefined);
    expect(payos.markWebhookFulfilled).toHaveBeenCalledWith(91);
  });

  it('acknowledges a verified PayOS probe with an unknown sample order', async () => {
    const payos = { resolveWebhook: jest.fn().mockResolvedValue(null) };
    const plans = { confirmPurchaseFromWebhook: jest.fn() };
    const controller = new PayosWebhookController(
      payos as never,
      plans as never,
    );

    await expect(controller.receive({})).resolves.toEqual({ success: true });
    expect(plans.confirmPurchaseFromWebhook).not.toHaveBeenCalled();
  });

  describe('a payment that cannot be applied automatically', () => {
    const intent = {
      id: 91,
      type: 'PLAN',
      planPayment: { planPurchaseId: 7 },
    };
    const make = (confirmError: Error, held: boolean) => {
      const payos = {
        resolveWebhook: jest.fn().mockResolvedValue(intent),
        markWebhookFulfilled: jest.fn().mockResolvedValue(undefined),
      };
      const plans = {
        confirmPurchaseFromWebhook: jest.fn().mockRejectedValue(confirmError),
        holdPaidPurchaseForReview: jest.fn().mockResolvedValue(held),
      };
      return {
        payos,
        plans,
        controller: new PayosWebhookController(payos as never, plans as never),
      };
    };

    it('holds money that arrived after the purchase expired for an admin', async () => {
      const { controller, plans, payos } = make(
        new ConflictException(
          'Không thể xác nhận giao dịch ở trạng thái EXPIRED.',
        ),
        true,
      );

      await expect(controller.receive({})).resolves.toEqual({ success: true });
      expect(plans.holdPaidPurchaseForReview).toHaveBeenCalledWith(7);
      expect(payos.markWebhookFulfilled).toHaveBeenCalledWith(91);
    });

    it('still fails when the payment could not be held either', async () => {
      const { controller, payos } = make(
        new ConflictException(
          'Không thể xác nhận giao dịch ở trạng thái EXPIRED.',
        ),
        false,
      );

      await expect(controller.receive({})).rejects.toThrow(ConflictException);
      expect(payos.markWebhookFulfilled).not.toHaveBeenCalled();
    });

    it('does not hide an unexpected error behind a review', async () => {
      const { controller, plans } = make(new Error('database down'), true);

      await expect(controller.receive({})).rejects.toThrow('database down');
      expect(plans.holdPaidPurchaseForReview).not.toHaveBeenCalled();
    });
  });
});
