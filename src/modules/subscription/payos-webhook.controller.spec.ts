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

  it('grants nothing for a retired classroom tuition intent', async () => {
    const payos = {
      resolveWebhook: jest.fn().mockResolvedValue({
        id: 92,
        type: 'COURSE',
        planPayment: null,
        coursePayment: { id: 3, amountVnd: 500000 },
      }),
      markWebhookFulfilled: jest.fn(),
    };
    const plans = { confirmPurchaseFromWebhook: jest.fn() };
    const controller = new PayosWebhookController(
      payos as never,
      plans as never,
    );

    await expect(controller.receive({})).resolves.toEqual({ success: true });
    expect(plans.confirmPurchaseFromWebhook).not.toHaveBeenCalled();
    expect(payos.markWebhookFulfilled).not.toHaveBeenCalled();
  });
});
