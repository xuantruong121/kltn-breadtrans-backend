/**
 * A minimal S3-compatible object store for the disposable harness only.
 *
 * The harness blanks every R2 credential, so private uploads (diagnostic
 * speaking audio) have nowhere to go. This server stands in for the private
 * bucket: path-style PUT / GET / HEAD / DELETE, objects kept as files under
 * the given directory. Signatures are not checked and nothing leaves the
 * machine. It listens on 127.0.0.1 only.
 *
 * Usage: node harness-fake-s3.js <port> <dataDir>
 */
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 9460);
const root = process.argv[3];
if (!root) throw new Error('usage: harness-fake-s3 <port> <dataDir>');
mkdirSync(root, { recursive: true });

function pathOf(url: string) {
  const key = decodeURIComponent(new URL(url, 'http://x').pathname).replace(
    /^\/+/,
    '',
  );
  const file = normalize(join(root, key));
  if (!file.startsWith(normalize(root)) || !key) throw new Error('bad key');
  return file;
}

createServer((req, res) => {
  // The browser uploads speaking audio straight to a presigned PUT URL, like
  // it does to R2, so the fake bucket answers CORS the same way.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ?? '*',
  );
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  let file: string;
  try {
    file = pathOf(req.url ?? '/');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (req.method === 'PUT') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"harness"' }).end();
    });
    return;
  }
  if (req.method === 'DELETE') {
    rmSync(file, { force: true });
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!existsSync(file)) {
      res
        .writeHead(404, { 'Content-Type': 'application/xml' })
        .end(
          req.method === 'GET'
            ? '<Error><Code>NoSuchKey</Code></Error>'
            : undefined,
        );
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Length': body.length,
      'Content-Type': 'application/octet-stream',
      ETag: '"harness"',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(req.method === 'GET' ? body : undefined);
    return;
  }
  res.writeHead(405).end();
}).listen(port, '127.0.0.1', () =>
  console.log(`harness fake s3 on 127.0.0.1:${port}`),
);
