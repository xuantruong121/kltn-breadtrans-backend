import * as fs from 'fs';

const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE || '/tmp/worker-heartbeat';
const MAX_AGE_MS = 25000; // 25s threshold (heartbeat updates every 5s)

try {
  if (!fs.existsSync(HEARTBEAT_FILE)) {
    process.exit(1);
  }
  const content = fs.readFileSync(HEARTBEAT_FILE, 'utf8').trim();
  const timestamp = Number(content);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > MAX_AGE_MS) {
    process.exit(1);
  }
  process.exit(0);
} catch {
  process.exit(1);
}
