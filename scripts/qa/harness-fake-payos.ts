/**
 * Local stand-in for the PayOS merchant API (MOCK PROVIDER, harness only).
 * The harness backend reaches it through the SDK's PAYOS_BASE_URL; responses
 * are signed with the harness checksum key exactly as the SDK verifies them.
 * No request ever leaves this machine and no money moves.
 *
 *   POST /v2/payment-requests            create a link (PENDING)
 *   GET  /v2/payment-requests/:id        read by orderCode or link id
 *   POST /v2/payment-requests/:id/cancel cancel
 *   POST /__mock/pay/:orderCode          test control: mark PAID {amountPaid?}
 *   GET  /__mock/requests                every API call received
 *
 * Usage: ts-node scripts/qa/harness-fake-payos.ts <port> <clientId> <apiKey> <checksumKey>
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NodeCryptoProvider } = require('@payos/node/lib/crypto/node-crypto');

const [port, clientId, apiKey, checksumKey] = process.argv.slice(2);
const crypto = new NodeCryptoProvider();
type Link = {
  id: string;
  orderCode: number;
  amount: number;
  amountPaid: number;
  description: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  createdAt: string;
  expiredAt: number | null;
};
const links = new Map<number, Link>();
const calls: Array<{ method: string; path: string; authorized: boolean }> = [];

const send = (res: any, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const signed = async (data: Record<string, unknown>) => ({
  code: '00',
  desc: 'success',
  data,
  signature: await crypto.createSignatureFromObj(data, checksumKey),
});
const view = (l: Link) => ({
  id: l.id,
  orderCode: l.orderCode,
  amount: l.amount,
  amountPaid: l.amountPaid,
  amountRemaining: l.amount - l.amountPaid,
  status: l.status,
  createdAt: l.createdAt,
  transactions: [],
  canceledAt: l.status === 'CANCELLED' ? new Date().toISOString() : null,
  cancellationReason: null,
});
const find = (key: string) =>
  links.get(Number(key)) ?? [...links.values()].find((l) => l.id === key);

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => void handle());
  const handle = async () => {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = raw ? JSON.parse(raw) : {};
    const authorized =
      req.headers['x-client-id'] === clientId &&
      req.headers['x-api-key'] === apiKey;
    if (!url.pathname.startsWith('/__mock'))
      calls.push({ method: req.method ?? '', path: url.pathname, authorized });
    try {
      if (url.pathname === '/__mock/requests') return send(res, 200, calls);
      const pay = /^\/__mock\/pay\/(\d+)$/.exec(url.pathname);
      if (pay && req.method === 'POST') {
        const l = links.get(Number(pay[1]));
        if (!l) return send(res, 404, { error: 'unknown order' });
        l.amountPaid = body.amountPaid ?? l.amount;
        l.status = l.amountPaid >= l.amount ? 'PAID' : 'PENDING';
        return send(res, 200, view(l));
      }
      if (!authorized)
        return send(res, 401, { code: '401', desc: 'unauthorized' });
      if (url.pathname === '/v2/payment-requests' && req.method === 'POST') {
        // The merchant must sign amount/cancelUrl/description/orderCode/returnUrl.
        const expected = await crypto.createSignatureOfPaymentRequest(
          body,
          checksumKey,
        );
        if (body.signature !== expected)
          return send(res, 400, {
            code: '20',
            desc: 'invalid request signature',
          });
        const l: Link = {
          id: randomUUID().replace(/-/g, ''),
          orderCode: body.orderCode,
          amount: body.amount,
          amountPaid: 0,
          description: body.description,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          expiredAt: body.expiredAt ?? null,
        };
        links.set(l.orderCode, l);
        return send(
          res,
          200,
          await signed({
            bin: '970422',
            accountNumber: '0000000000',
            accountName: 'BREADTRANS MOCK',
            amount: l.amount,
            description: l.description,
            orderCode: l.orderCode,
            currency: 'VND',
            paymentLinkId: l.id,
            status: l.status,
            expiredAt: l.expiredAt,
            checkoutUrl: `http://127.0.0.1:${port}/web/${l.id}`,
            qrCode: `MOCKQR${l.orderCode}`,
          }),
        );
      }
      const cancel = /^\/v2\/payment-requests\/([^/]+)\/cancel$/.exec(
        url.pathname,
      );
      if (cancel && req.method === 'POST') {
        const l = find(cancel[1]);
        if (!l) return send(res, 404, { code: '101', desc: 'not found' });
        l.status = 'CANCELLED';
        return send(res, 200, await signed(view(l)));
      }
      const get = /^\/v2\/payment-requests\/([^/]+)$/.exec(url.pathname);
      if (get && req.method === 'GET') {
        const l = find(get[1]);
        if (!l) return send(res, 404, { code: '101', desc: 'not found' });
        return send(res, 200, await signed(view(l)));
      }
      send(res, 404, { code: '404', desc: 'no route' });
    } catch (error) {
      send(res, 500, { error: String(error) });
    }
  };
}).listen(Number(port), '127.0.0.1', () =>
  console.log(`fake PayOS on 127.0.0.1:${port}`),
);
