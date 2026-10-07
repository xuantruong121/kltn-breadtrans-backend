import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';

async function createWebhookApp(reconciliation: { ingestWebhook: jest.Mock }) {
  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentWebhookController],
    providers: [
      {
        provide: PaymentReconciliationService,
        useValue: reconciliation,
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  return app;
}

describe('PaymentWebhookController', () => {
  const secret = 'test-webhook-secret';

  beforeEach(() => {
    process.env.SEPAY_WEBHOOK_SECRET = secret;
    process.env.SEPAY_WEBHOOK_MAX_SKEW_SECONDS = '300';
  });

  afterEach(() => {
    delete process.env.SEPAY_WEBHOOK_SECRET;
    delete process.env.SEPAY_WEBHOOK_MAX_SKEW_SECONDS;
  });

  it('accepts an HMAC signature over the exact raw body', async () => {
    const body = JSON.stringify({ id: 92704, content: 'BTP00000031' });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`;
    const reconciliation = {
      ingestWebhook: jest.fn().mockResolvedValue({
        matchStatus: 'MATCHED',
        duplicate: false,
      }),
    };
    const controller = new PaymentWebhookController(reconciliation as never);
    const request = {
      body: JSON.parse(body),
      rawBody: Buffer.from(body),
      header: (name: string) =>
        name === 'X-SePay-Signature'
          ? signature
          : name === 'X-SePay-Timestamp'
            ? timestamp
            : undefined,
    };

    await expect(controller.receiveSepay(request as never)).resolves.toEqual({
      success: true,
    });
    expect(reconciliation.ingestWebhook).toHaveBeenCalledWith(request.body);
  });

  it('returns the exact success contract for an idempotent replay', async () => {
    const body = JSON.stringify({ id: 92704, content: 'BTP00000031' });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`;
    const reconciliation = {
      ingestWebhook: jest.fn().mockResolvedValue({
        matchStatus: 'MATCHED',
        duplicate: true,
      }),
    };
    const controller = new PaymentWebhookController(reconciliation as never);
    const request = {
      body: JSON.parse(body),
      rawBody: Buffer.from(body),
      header: (name: string) =>
        name === 'X-SePay-Signature'
          ? signature
          : name === 'X-SePay-Timestamp'
            ? timestamp
            : undefined,
    };

    await expect(controller.receiveSepay(request as never)).resolves.toEqual({
      success: true,
    });
  });

  it('rejects missing or invalid authentication before reconciliation', async () => {
    const reconciliation = { ingestWebhook: jest.fn() };
    const controller = new PaymentWebhookController(reconciliation as never);
    const request = {
      body: {},
      rawBody: Buffer.from('{}'),
      header: () => undefined,
    };

    await expect(controller.receiveSepay(request as never)).rejects.toThrow(
      'Invalid webhook authentication',
    );
    expect(reconciliation.ingestWebhook).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    const reconciliation = { ingestWebhook: jest.fn() };
    const controller = new PaymentWebhookController(reconciliation as never);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const request = {
      body: { id: 92704 },
      rawBody: Buffer.from('{"id":92704}'),
      header: (name: string) =>
        name === 'X-SePay-Signature'
          ? `sha256=${'0'.repeat(64)}`
          : name === 'X-SePay-Timestamp'
            ? timestamp
            : undefined,
    };

    await expect(controller.receiveSepay(request as never)).rejects.toThrow(
      'Invalid webhook authentication',
    );
    expect(reconciliation.ingestWebhook).not.toHaveBeenCalled();
  });

  it('rejects a stale timestamp even when its signature is valid', async () => {
    const reconciliation = { ingestWebhook: jest.fn() };
    const controller = new PaymentWebhookController(reconciliation as never);
    const body = JSON.stringify({ id: 92704 });
    const timestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`;
    const request = {
      body: JSON.parse(body),
      rawBody: Buffer.from(body),
      header: (name: string) =>
        name === 'X-SePay-Signature'
          ? signature
          : name === 'X-SePay-Timestamp'
            ? timestamp
            : undefined,
    };

    await expect(controller.receiveSepay(request as never)).rejects.toThrow(
      'Invalid webhook authentication',
    );
    expect(reconciliation.ingestWebhook).not.toHaveBeenCalled();
  });

  it('writes the exact unwrapped success body on the HTTP wire', async () => {
    const body = { id: 92704, content: 'BTP00000031' };
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')}`;
    const reconciliation = {
      ingestWebhook: jest.fn().mockResolvedValue({
        matchStatus: 'MATCHED',
        duplicate: false,
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentWebhookController],
      providers: [
        {
          provide: PaymentReconciliationService,
          useValue: reconciliation,
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .post('/payments/webhooks/sepay')
        .set('Content-Type', 'application/json')
        .set('X-SePay-Timestamp', timestamp)
        .set('X-SePay-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({ success: true });
    } finally {
      await app.close();
    }
  });

  it('writes the same exact body for an idempotent replay on the HTTP wire', async () => {
    const body = { id: 92704, content: 'BTP00000031' };
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')}`;
    const reconciliation = {
      ingestWebhook: jest.fn().mockResolvedValue({
        matchStatus: 'MATCHED',
        duplicate: true,
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentWebhookController],
      providers: [
        {
          provide: PaymentReconciliationService,
          useValue: reconciliation,
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .post('/payments/webhooks/sepay')
        .set('Content-Type', 'application/json')
        .set('X-SePay-Timestamp', timestamp)
        .set('X-SePay-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(reconciliation.ingestWebhook).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('rejects an invalid signature with a non-2xx HTTP response', async () => {
    const body = { id: 92704, content: 'BTP00000031' };
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const app = await createWebhookApp({ ingestWebhook: jest.fn() });

    try {
      await request(app.getHttpServer())
        .post('/payments/webhooks/sepay')
        .set('Content-Type', 'application/json')
        .set('X-SePay-Timestamp', timestamp)
        .set('X-SePay-Signature', `sha256=${'0'.repeat(64)}`)
        .send(body)
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('rejects a stale timestamp with a non-2xx HTTP response', async () => {
    const body = { id: 92704, content: 'BTP00000031' };
    const timestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')}`;
    const app = await createWebhookApp({ ingestWebhook: jest.fn() });

    try {
      await request(app.getHttpServer())
        .post('/payments/webhooks/sepay')
        .set('Content-Type', 'application/json')
        .set('X-SePay-Timestamp', timestamp)
        .set('X-SePay-Signature', signature)
        .send(body)
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
