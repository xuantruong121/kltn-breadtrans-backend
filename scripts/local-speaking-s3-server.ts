/** Disposable local S3-compatible HTTP server for the speaking browser demo. */
import * as http from 'http';
import { createHash } from 'crypto';

const port = Number(process.env.LOCAL_S3_PORT ?? 9000);
const bucket = process.env.LOCAL_S3_BUCKET ?? 'breadtrans-speaking-local';
const objects = new Map<string, { body: Buffer; contentType: string; etag: string }>();

function objectKey(pathname: string): string {
  const path = decodeURIComponent(pathname).replace(/^\/+/, '');
  return path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path;
}

function cors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Type');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (parsed.pathname === '/minio/health/live') {
    res.writeHead(200);
    res.end('OK');
    return;
  }
  const key = objectKey(parsed.pathname);
  if (req.method === 'PUT') {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const etag = `"${createHash('md5').update(body).digest('hex')}"`;
      objects.set(key, {
        body,
        contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
        etag,
      });
      res.setHeader('ETag', etag);
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<PutObjectResult/>');
    });
    return;
  }
  const object = objects.get(key);
  if (req.method === 'HEAD') {
    if (!object) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      ETag: object.etag,
      'Content-Type': object.contentType,
      'Content-Length': object.body.length,
    });
    res.end();
    return;
  }
  if (req.method === 'GET') {
    if (!object) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      ETag: object.etag,
      'Content-Type': object.contentType,
      'Content-Length': object.body.length,
    });
    res.end(object.body);
    return;
  }
  if (req.method === 'DELETE') {
    objects.delete(key);
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(405);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local S3-compatible speaking storage listening on 127.0.0.1:${port}`);
  console.log(`Bucket: ${bucket}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
