/**
 * Role boundary sweep (P3 acceptance, 2026-11-17): every route that requires ADMIN must refuse an anonymous
 * caller (401) and a learner (403). Routes are read from Nest metadata (class and method @Roles), not from a
 * grep, so admin routes outside /admin are included; then each is called on the harness backend :3101 with
 * ":param = 1" and an empty body. Admin GETs are called too, to show the guard lets an admin through.
 * Routes that check the role by hand inside the handler are not covered.
 *
 * Usage (harness only; refuses another DATABASE_URL):
 *   DATABASE_URL=postgresql://harness:harness-disposable@127.0.0.1:5460/<db> REDIS_URL=redis://127.0.0.1:6392  *   HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/role-boundary-sweep.ts <out.json>
 */
import { NestFactory, Reflector } from '@nestjs/core';
import { DiscoveryService, DiscoveryModule } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { writeFileSync } from 'node:fs';

import { AppModule } from '../../src/app.module';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { newStudent, newAdmin, BE } from './harness-api';

if (!(process.env.DATABASE_URL ?? '').includes('127.0.0.1:5460/'))
  throw new Error('refused: not the harness DB');

@Module({ imports: [AppModule, DiscoveryModule] })
class ProbeModule {}

const join = (...parts: string[]) =>
  '/' +
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

void (async () => {
  const app = await NestFactory.createApplicationContext(ProbeModule, {
    logger: false,
  });
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const routes: { method: string; path: string; roles: string[] }[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = [
      Reflect.getMetadata(PATH_METADATA, metatype) ?? '',
    ].flat()[0] as string;
    const proto = Object.getPrototypeOf(instance);
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (path === undefined || method === undefined) continue;
      const roles =
        reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, metatype]) ??
        [];
      if (!roles.length || roles.includes('STUDENT')) continue;
      routes.push({
        method: RequestMethod[method],
        path: join(base, [path].flat()[0] as string),
        roles,
      });
    }
  }
  await app.close();

  const student = await newStudent('role-boundary');
  const admin = await newAdmin('role-boundary-admin');
  const fill = (p: string) => p.replace(/:[A-Za-z]+/g, '1');
  const results: any[] = [];
  for (const r of routes) {
    const url = BE + fill(r.path);
    const call = async (token?: string) => {
      const res = await fetch(url, {
        method: r.method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: ['GET', 'HEAD'].includes(r.method) ? undefined : '{}',
      });
      return res.status;
    };
    const anon = await call();
    const learner = await call(student.token);
    // The admin call is GET only: proves the route exists and the guard lets an admin through.
    const adminStatus = r.method === 'GET' ? await call(admin.token) : null;
    results.push({ ...r, anon, learner, adminStatus });
  }
  const leaks = results.filter(
    (x) => x.anon < 400 || x.learner < 400 || ![401, 403].includes(x.learner),
  );
  const adminGets = results.filter((x) => x.adminStatus !== null);
  const adminBlocked = adminGets.filter((x) =>
    [401, 403].includes(x.adminStatus),
  );
  writeFileSync(
    process.argv[2] ?? 'role-boundary.json',
    JSON.stringify(results, null, 2),
  );
  console.log(`ADMIN_ONLY_ROUTES=${results.length}`);
  console.log(`ANON_OR_LEARNER_NOT_REFUSED=${leaks.length}`);
  for (const l of leaks.slice(0, 20))
    console.log(
      `  LEAK ${l.method} ${l.path} anon=${l.anon} learner=${l.learner}`,
    );
  console.log(
    `LEARNER_STATUS_SET=${[...new Set(results.map((x) => x.learner))].join(',')} ANON_STATUS_SET=${[...new Set(results.map((x) => x.anon))].join(',')}`,
  );
  console.log(
    `ADMIN_GET_ROUTES=${adminGets.length} ADMIN_GET_REFUSED=${adminBlocked.length}`,
  );
  for (const b of adminBlocked.slice(0, 10))
    console.log(`  ADMIN_REFUSED ${b.method} ${b.path} ${b.adminStatus}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
