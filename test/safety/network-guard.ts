/**
 * Fail-closed outbound network guard for test workers (P12.9).
 *
 * Every TCP/TLS client in Node ends in `net.Socket.prototype.connect`: http,
 * https, http2, tls, the global fetch (undici), the AWS SDK, ioredis,
 * nodemailer, ws. The guard replaces that method and refuses any target that
 * is not loopback before the original runs, so no DNS lookup and no packet
 * happen; the socket is destroyed with an error, as a refused connection
 * would be. Direct DNS queries and UDP sends to non-loopback targets are
 * refused the same way.
 *
 * Not covered (documented limits): native addons with their own sockets
 * (the Prisma query engine, which only gets the sentinel/verified database
 * URL), child processes and worker threads (separate module instances).
 *
 * Error messages name the host and port only: never a path, query, header or
 * credential.
 */
import type { Socket as UdpSocket } from 'node:dgram';
import { isIP, type Socket as NetSocket } from 'node:net';

// The real module objects (an `import * as` namespace is read-only): patching
// them is what every other importer, including Node's own fetch, sees.
/* eslint-disable @typescript-eslint/no-require-imports */
const dgram: typeof import('node:dgram') = require('node:dgram');
const dns: typeof import('node:dns') = require('node:dns');
const net: typeof import('node:net') = require('node:net');
/* eslint-enable @typescript-eslint/no-require-imports */

const STATE = Symbol.for('breadtrans.test.networkGuard');

type GuardState = { installed: true; blocked: number; allowed: number };

const GUARDED = Symbol.for('breadtrans.test.networkGuard.wrapped');
const mark = <T extends object>(fn: T): T =>
  Object.defineProperty(fn, GUARDED, { value: true });

/** True when `fn` is one of the guard's wrappers. */
export function isGuarded(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    (fn as unknown as Record<symbol, unknown>)[GUARDED] === true
  );
}

export function isLoopbackHost(host: string | undefined | null): boolean {
  if (host === undefined || host === null || host === '') return true; // net defaults to localhost
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0.0.0.0' || h === '::') return true;
  const v4 = h.startsWith('::ffff:') ? h.slice(7) : h;
  return isIP(v4) === 4 && v4.startsWith('127.');
}

export class OutboundNetworkBlockedError extends Error {
  readonly code = 'ERR_TEST_OUTBOUND_NETWORK_BLOCKED';
  constructor(target: string) {
    super(`[test-safety] outbound network blocked in tests: ${target}`);
    // Also on stderr, so a block that the code under test swallows still shows
    // up in the run log (host and port only).
    process.stderr.write(`${this.message}
`);
  }
}

/** Host and port of a `socket.connect(...)` call, or a local IPC path. */
function connectTarget(args: unknown[]): {
  host?: string;
  port?: unknown;
  path?: string;
} {
  // net.connect() passes the normalised [options, callback] array.
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first && typeof first === 'object') {
    const o = first as { host?: string; port?: unknown; path?: unknown };
    // Like net itself (`const pipe = !!path`): only a non-empty string is IPC;
    // http's agent passes `path: null` for TCP.
    return {
      host: o.host,
      port: o.port,
      path: typeof o.path === 'string' && o.path !== '' ? o.path : undefined,
    };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first };
  return {
    port: first,
    host: typeof args[1] === 'string' ? args[1] : undefined,
  };
}

/** Exported for the canary: how the guard reads a connect call. */
export { connectTarget };

export function networkGuardState(): GuardState | undefined {
  return (globalThis as Record<symbol, GuardState | undefined>)[STATE];
}

export function installNetworkGuard(): void {
  if (networkGuardState()) return;
  const state: GuardState = { installed: true, blocked: 0, allowed: 0 };
  (globalThis as Record<symbol, GuardState>)[STATE] = state;

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = mark(function guardedConnect(
    this: NetSocket,
    ...args: unknown[]
  ) {
    const target = connectTarget(args);
    if (target.path === undefined && !isLoopbackHost(target.host)) {
      state.blocked += 1;
      const error = new OutboundNetworkBlockedError(
        `${target.host}:${String(target.port)}`,
      );
      process.nextTick(() => this.destroy(error));
      return this;
    }
    state.allowed += 1;
    return originalConnect.apply(this, args);
  });

  // Direct DNS queries for non-loopback names.
  // A name lookup needs the network unless it is an IP literal; a reverse
  // lookup needs it for any non-loopback address.
  const refuse = (key: string, name: unknown) =>
    typeof name === 'string' &&
    !isLoopbackHost(name) &&
    (key === 'reverse' || key === 'lookupService' || isIP(name) === 0);
  const guardCallback = (target: Record<string, unknown>, key: string) => {
    const original = target[key];
    if (typeof original !== 'function') return;
    target[key] = mark(function (this: unknown, ...args: unknown[]) {
      if (refuse(key, args[0])) {
        state.blocked += 1;
        const error = new OutboundNetworkBlockedError(`dns:${String(args[0])}`);
        const callback = args[args.length - 1];
        if (typeof callback === 'function')
          process.nextTick(() => (callback as (e: Error) => void)(error));
        return undefined;
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    });
  };
  const guardPromise = (target: Record<string, unknown>, key: string) => {
    const original = target[key];
    if (typeof original !== 'function') return;
    target[key] = mark(function (this: unknown, ...args: unknown[]) {
      if (refuse(key, args[0])) {
        state.blocked += 1;
        return Promise.reject(
          new OutboundNetworkBlockedError(`dns:${String(args[0])}`),
        );
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    });
  };
  const dnsNames = (target: object) =>
    Object.keys(target).filter(
      (k) =>
        k === 'lookup' ||
        k === 'lookupService' ||
        k === 'reverse' ||
        k.startsWith('resolve'),
    );
  const dnsCallbacks = dns as unknown as Record<string, unknown>;
  for (const key of dnsNames(dns)) guardCallback(dnsCallbacks, key);
  for (const key of Object.getOwnPropertyNames(dns.Resolver.prototype).filter(
    (k) => k.startsWith('resolve') || k === 'reverse',
  ))
    guardCallback(
      dns.Resolver.prototype as unknown as Record<string, unknown>,
      key,
    );
  const dnsPromises = dns.promises as unknown as Record<string, unknown>;
  for (const key of dnsNames(dns.promises)) guardPromise(dnsPromises, key);
  for (const key of Object.getOwnPropertyNames(
    dns.promises.Resolver.prototype,
  ).filter((k) => k.startsWith('resolve') || k === 'reverse'))
    guardPromise(
      dns.promises.Resolver.prototype as unknown as Record<string, unknown>,
      key,
    );

  // UDP to non-loopback addresses.
  const udp = dgram.Socket.prototype as unknown as Record<string, unknown>;
  for (const key of ['send', 'connect']) {
    const original = udp[key];
    if (typeof original !== 'function') continue;
    udp[key] = mark(function (this: UdpSocket, ...args: unknown[]) {
      const address = args.find((a, i) => i > 0 && typeof a === 'string') as
        string | undefined;
      if (address !== undefined && !isLoopbackHost(address)) {
        state.blocked += 1;
        throw new OutboundNetworkBlockedError(`udp:${address}`);
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    });
  }
}
