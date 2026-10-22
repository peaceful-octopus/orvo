import { keyRingFromJson } from '@chillcall/protocol';
import http from 'node:http';
import os from 'node:os';
import { SignalingServer } from './server';

// Standalone signaling node, used when the beacon runs as a separate service.
const port = Number(process.env.PORT ?? 9000);
const signaling = new SignalingServer({
  nodeId: process.env.NODE_ID ?? os.hostname(),
  keys: keyRingFromJson(process.env.TRUSTED_KEYS),
});

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/healthz') return void res.end('ok');
  if (path === '/readyz') {
    res.statusCode = signaling.draining ? 503 : 200;
    return void res.end(signaling.draining ? 'draining' : 'ready');
  }
  if (path === '/metrics') return void res.setHeader('content-type', 'text/plain').end(signaling.renderMetrics());
  res.statusCode = 404;
  res.end();
});
signaling.attach(server);
server.listen(port, () => console.log(`signaling node listening on :${port}`));

// Stop admitting new rooms, give clients time to finish, then disconnect them so they reconnect elsewhere.
process.on('SIGTERM', () => {
  signaling.drain();
  setTimeout(() => {
    signaling.close();
    server.close(() => process.exit(0));
  }, Number(process.env.DRAIN_MS ?? 30_000));
});
