import { generateKeyPair, toBase64Url } from '@chillcall/protocol';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LocalFleet {
  beaconUrl: string;
  /** `/metrics` URLs of the signaling nodes. */
  metricsUrls: string[];
  stop(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const tsx = createRequire(import.meta.url).resolve('tsx/cli');

async function waitFor(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not come up`);
}

/**
 * Starts a beacon and `nodes` signaling nodes as separate processes on this machine (static node list, no Redis),
 * so a load run exercises the same code paths as a deployment, including each node's own event loop.
 */
export async function startLocalFleet(nodes: number, basePort = 8280): Promise<LocalFleet> {
  const pair = generateKeyPair();
  const kid = 'load-1';
  const children: ChildProcess[] = [];
  const launch = (cwd: string, env: Record<string, string>) => {
    const child = spawn(process.execPath, [tsx, 'src/main.ts'], {
      cwd: path.join(repo, cwd),
      env: { ...process.env, ...env, NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    children.push(child);
    return child;
  };

  const beaconPort = basePort;
  const nodeInfos = Array.from({ length: nodes }, (_, i) => ({ id: `n${i + 1}`, url: `ws://localhost:${basePort + 1 + i}/ws` }));

  launch('apps/beacon', {
    PORT: String(beaconPort),
    SIGNING_KEY: `${kid}:${toBase64Url(pair.secretKey)}`,
    NODES: JSON.stringify(nodeInfos),
    RATE_LIMIT_PER_MINUTE: '0',
    DATA_DIR: path.join(repo, 'data', 'loadgen'),
  });
  nodeInfos.forEach((node, i) =>
    launch('apps/signaling', {
      PORT: String(basePort + 1 + i),
      NODE_ID: node.id,
      TRUSTED_KEYS: JSON.stringify({ [kid]: toBase64Url(pair.publicKey) }),
    }),
  );

  const metricsUrls = nodeInfos.map((_, i) => `http://localhost:${basePort + 1 + i}/metrics`);
  try {
    await waitFor(`http://localhost:${beaconPort}/healthz`);
    for (let i = 0; i < nodes; i++) await waitFor(`http://localhost:${basePort + 1 + i}/healthz`);
  } catch (err) {
    for (const c of children) c.kill();
    throw err;
  }

  return {
    beaconUrl: `http://localhost:${beaconPort}`,
    metricsUrls,
    stop: async () => {
      for (const c of children) c.kill();
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}
