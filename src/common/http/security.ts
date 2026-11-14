import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

/**
 * HTTP security shared by the API and the QA servers (owner 2026-11-14).
 * helmet's standard headers; no page CSP on a JSON API (Swagger keeps
 * working); media served from here may be embedded by the web app on another
 * origin. TRUST_PROXY gives rate limits the real client IP behind Caddy or
 * Cloudflare (unset: trust nothing).
 */
export function applyHttpSecurity(app: INestApplication) {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  const trust = process.env.TRUST_PROXY;
  if (trust) {
    const express = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    express.set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust);
  }
}
