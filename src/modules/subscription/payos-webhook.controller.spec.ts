import { PayosWebhookController } from './payos-webhook.controller';

describe('PayosWebhookController', () => {
  it('returns success for the PayOS endpoint verification probe', () => {
    const controller = new PayosWebhookController(
      {} as never,
      {} as never,
      {} as never,
    );

    expect(controller.health()).toEqual({ success: true });
  });

  it('returns the exact PayOS acknowledgement after canonical fulfillment', async () => {
    const payos = {
      resolveWebhook: jest.fn().mockResolvedValue({
        type: 'PLAN',
        planPayment: { planPurchaseId: 7 },
        coursePayment: null,
      }),
    };
    const plans = {
      confirmPurchaseFromWebhook: jest.fn().mockResolvedValue({}),
    };
    const courses = { confirmPaymentFromPayos: jest.fn() };
    const controller = new PayosWebhookController(
      payos as never,
      plans as never,
      courses as never,
    );

    await expect(controller.receive({})).resolves.toEqual({ success: true });
    expect(plans.confirmPurchaseFromWebhook).toHaveBeenCalledWith(7, undefined);
    expect(courses.confirmPaymentFromPayos).not.toHaveBeenCalled();
  });

  it('acknowledges a verified PayOS probe with an unknown sample order', async () => {
    const payos = { resolveWebhook: jest.fn().mockResolvedValue(null) };
    const plans = { confirmPurchaseFromWebhook: jest.fn() };
    const courses = { confirmPaymentFromPayos: jest.fn() };
    const controller = new PayosWebhookController(
      payos as never,
      plans as never,
      courses as never,
    );

    await expect(controller.receive({})).resolves.toEqual({ success: true });
    expect(plans.confirmPurchaseFromWebhook).not.toHaveBeenCalled();
    expect(courses.confirmPaymentFromPayos).not.toHaveBeenCalled();
  });
});
