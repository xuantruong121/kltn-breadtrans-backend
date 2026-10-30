import * as dgram from 'node:dgram';
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import * as net from 'node:net';
import * as tls from 'node:tls';

import {
  connectTarget,
  isGuarded,
  isLoopbackHost,
  networkGuardState,
  OutboundNetworkBlockedError,
} from './network-guard';

/**
 * Canary for the outbound network guard installed by the jest setup (P12.9).
 * Every external attempt first requires the guard to be installed, so a
 * missing guard fails the test before any request is made. Targets are the
 * RFC 5737 documentation range and the RFC 2606 `.invalid` TLD.
 */
const EXTERNAL_IP = '198.51.100.7';
const EXTERNAL_NAME = 'r2-canary.example.invalid';

function guard() {
  const state = networkGuardState();
  const wrapped = [
    net.Socket.prototype.connect,
    dns.lookup,
    dns.promises.lookup,
    dns.promises.resolve4,
    dns.promises.Resolver.prototype.resolveTxt,
    dgram.Socket.prototype.send,
  ].every(isGuarded);
  if (!state?.installed || !wrapped)
    throw new Error('network guard is not installed: refusing to try');
  return state;
}

// fetch (undici) re-wraps the cause as a plain Error, so match code or message.
const blockedBy = (error: unknown) => {
  const e = error as { cause?: { code?: string; message?: string } } & {
    code?: string;
    message?: string;
  };
  const inner = e?.cause ?? e;
  return (
    inner?.code === 'ERR_TEST_OUTBOUND_NETWORK_BLOCKED' ||
    /\[test-safety\] outbound network blocked/.test(String(inner?.message))
  );
};

const socketError = (socket: net.Socket) =>
  new Promise<Error>((resolve) => socket.once('error', resolve));

describe('outbound network guard', () => {
  it('is installed in this worker by the jest setup', () => {
    expect(networkGuardState()?.installed).toBe(true);
    expect(() => guard()).not.toThrow();
  });

  it('fetch to a non-loopback IP is refused before connecting', async () => {
    const state = guard();
    const before = { ...state };
    const error = await fetch(`http://${EXTERNAL_IP}/x`).catch((e) => e);
    expect(blockedBy(error)).toBe(true);
    expect(state.blocked).toBeGreaterThan(before.blocked);
    expect(state.allowed).toBe(before.allowed);
  });

  it('fetch over https to a hostname is refused with no DNS lookup', async () => {
    guard();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const realDns: typeof dns = require('node:dns');
    const lookup = jest.spyOn(realDns, 'lookup');
    const error = await fetch(`https://${EXTERNAL_NAME}/bucket/key.mp3`).catch(
      (e) => e,
    );
    expect(blockedBy(error)).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockRestore();
  });

  it('the error names host and port only, never path or query', async () => {
    guard();
    const error = await fetch(
      `https://${EXTERNAL_IP}/private/key.mp3?X-Amz-Signature=canary-signature`,
    ).catch((e) => e);
    const message = String((error as { cause?: Error }).cause?.message);
    expect(message).toContain(EXTERNAL_IP);
    expect(message).not.toMatch(/key\.mp3|Signature|canary-signature/);
  });

  it('http.request, https.request, net.connect and tls.connect are refused', async () => {
    const state = guard();
    const allowedBefore = state.allowed;
    const viaRequest = (mod: typeof http | typeof https) =>
      new Promise<Error>((resolve) => {
        const req = mod.request({ host: EXTERNAL_IP, port: 80, path: '/x' });
        req.once('error', resolve);
        req.end();
      });
    expect(blockedBy(await viaRequest(http))).toBe(true);
    expect(blockedBy(await viaRequest(https))).toBe(true);
    expect(
      blockedBy(
        await socketError(net.connect({ host: EXTERNAL_IP, port: 5432 })),
      ),
    ).toBe(true);
    expect(blockedBy(await socketError(net.connect(6379, EXTERNAL_NAME)))).toBe(
      true,
    );
    expect(
      blockedBy(
        await socketError(
          tls.connect({
            host: EXTERNAL_NAME,
            port: 443,
            servername: EXTERNAL_NAME,
          }),
        ),
      ),
    ).toBe(true);
    // Nothing reached the real connect.
    expect(state.allowed).toBe(allowedBefore);
  });

  it('direct DNS queries and UDP sends to external targets are refused', async () => {
    guard();
    const viaCallback = await new Promise<Error | null>((resolve) =>
      dns.lookup(EXTERNAL_NAME, (error) => resolve(error)),
    );
    expect(blockedBy(viaCallback)).toBe(true);
    await expect(dns.promises.lookup(EXTERNAL_NAME)).rejects.toBeInstanceOf(
      OutboundNetworkBlockedError,
    );
    await expect(dns.promises.resolve4(EXTERNAL_NAME)).rejects.toBeInstanceOf(
      OutboundNetworkBlockedError,
    );
    await expect(
      new dns.promises.Resolver().resolveTxt(EXTERNAL_NAME),
    ).rejects.toBeInstanceOf(OutboundNetworkBlockedError);
    await expect(dns.promises.reverse(EXTERNAL_IP)).rejects.toBeInstanceOf(
      OutboundNetworkBlockedError,
    );
    const udp = dgram.createSocket('udp4');
    expect(() => udp.send('x', 53, EXTERNAL_IP)).toThrow(
      OutboundNetworkBlockedError,
    );
    udp.close();
  });

  it('loopback test servers still work (127.0.0.1 and localhost)', async () => {
    const state = guard();
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const { port } = server.address() as AddressInfo;
    const allowedBefore = state.allowed;
    try {
      const viaIp = await fetch(`http://127.0.0.1:${port}/`);
      expect(await viaIp.text()).toBe('ok');
      const viaName = await new Promise<number>((resolve, reject) =>
        http
          .get({ host: 'localhost', port, family: 4 }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          })
          .once('error', reject),
      );
      expect(viaName).toBe(200);
      expect(state.allowed).toBeGreaterThan(allowedBefore);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reads TCP targets the way net does (http passes path: null)', () => {
    expect(
      connectTarget([[{ host: EXTERNAL_IP, port: 80, path: null }]]),
    ).toEqual({
      host: EXTERNAL_IP,
      port: 80,
      path: undefined,
    });
    expect(
      connectTarget([{ host: EXTERNAL_IP, port: 80, path: '' }]).path,
    ).toBe(undefined);
    expect(connectTarget([{ path: '/tmp/test.sock' }]).path).toBe(
      '/tmp/test.sock',
    );
    expect(connectTarget([443, EXTERNAL_NAME])).toEqual({
      port: 443,
      host: EXTERNAL_NAME,
    });
  });

  it('classifies loopback hosts', () => {
    for (const host of [
      undefined,
      '',
      'localhost',
      'a.localhost',
      '127.0.0.1',
      '127.5.5.5',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
    ])
      expect(isLoopbackHost(host)).toBe(true);
    for (const host of [
      EXTERNAL_IP,
      EXTERNAL_NAME,
      '10.0.0.1',
      '128.0.0.1',
      'localhost.evil.test',
      '::ffff:8.8.8.8',
    ])
      expect(isLoopbackHost(host)).toBe(false);
  });
});
