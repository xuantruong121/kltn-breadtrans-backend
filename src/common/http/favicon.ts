import type { INestApplication } from '@nestjs/common';

type Res = { status: (code: number) => { end: () => void } };

/** 204 with no body: the API has no icon, and nothing to log. */
export function noFavicon(_req: unknown, res: Res) {
  res.status(204).end();
}

/**
 * Browsers, link previews and scanners ask any public host for /favicon.ico.
 * The API has none; answering here, before the request logger, keeps those
 * 404 warnings out of the log (owner 2026-11-19, BE behind Tailscale Funnel).
 */
export function answerFavicon(app: INestApplication) {
  app.use('/favicon.ico', noFavicon);
}
