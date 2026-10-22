import { generateRoomId } from '@chillcall/protocol';
import { SimClient, type SimReporter } from './client';
import {
  DEFAULT_ROOM_SIZES,
  planRooms,
  sampleSessionSeconds,
  seededRandom,
  type RoomSizeWeight,
} from './scenario';
import { Counts, Samples, scrapeValue } from './stats';

export interface LoadConfig {
  beaconUrl: string;
  users: number;
  rampSeconds: number;
  /** How long to keep everyone connected after the ramp finishes. */
  holdSeconds: number;
  roomSizes?: RoomSizeWeight[];
  signalsPerPair?: number;
  /** Mean session length. When set, people leave and are replaced, so the population stays near `users`. */
  churnSeconds?: number;
  /** `/metrics` URLs of signaling nodes, scraped during the run for connections, memory and event-loop lag. */
  scrapeUrls?: string[];
  seed?: number;
  /** Fail the run if the 99th percentile join time (beacon plus node) exceeds this. */
  maxJoinP99Ms?: number;
  progress?: (line: string) => void;
}

export interface NodeScrape {
  url: string;
  maxConnections: number;
  maxRooms: number;
  maxRssMb: number;
  maxEventLoopLagP99Ms: number;
  avgCpuPercent: number;
}

export interface LoadReport {
  users: number;
  rooms: number;
  durationSeconds: number;
  peakActive: number;
  /** Clients still connected when the run ended; fewer than `peakActive` means some were left stranded. */
  connectedAtEnd: number;
  joinsOk: number;
  joinFailures: Record<string, number>;
  joinMs: ReturnType<Samples['summary']>;
  signalRttMs: ReturnType<Samples['summary']>;
  signalsSent: number;
  signalsReceived: number;
  reconnects: number;
  reconnectMs: ReturnType<Samples['summary']>;
  nodes: NodeScrape[];
  passed: boolean;
  problems: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs a load scenario against a beacon and its signaling nodes and reports what the servers did. */
export async function runLoad(config: LoadConfig): Promise<LoadReport> {
  const random = seededRandom(config.seed ?? 1);
  const rooms = planRooms(config.users, config.roomSizes ?? DEFAULT_ROOM_SIZES, random);
  const progress = config.progress ?? (() => {});

  const joinMs = new Samples();
  const rtt = new Samples();
  const reconnectMs = new Samples();
  const failures = new Counts();
  let joinsOk = 0;
  let signalsSent = 0;
  let signalsReceived = 0;
  let reconnects = 0;
  let active = 0;
  let peak = 0;

  const reporter: SimReporter = {
    joinOk: (ms) => {
      joinsOk++;
      joinMs.add(ms);
    },
    joinFailed: (reason) => failures.inc(reason),
    reconnected: (ms) => {
      reconnects++;
      reconnectMs.add(ms);
    },
    signalRtt: (ms) => rtt.add(ms),
    signalsSent: (n) => void (signalsSent += n),
    signalsReceived: (n) => void (signalsReceived += n),
  };

  const rampMs = config.rampSeconds * 1000;
  const endAt = Date.now() + rampMs + config.holdSeconds * 1000;
  const clients = new Set<SimClient>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopping = false;

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => (timers.delete(t), fn()), ms);
    timers.add(t);
  };

  const joinMember = async (room: string, name: string) => {
    if (stopping) return;
    const client = new SimClient({ beaconUrl: config.beaconUrl, room, name, reporter, signalsPerPair: config.signalsPerPair });
    clients.add(client);
    try {
      await client.start();
    } catch {
      clients.delete(client);
      return;
    }
    active++;
    peak = Math.max(peak, active);
    if (config.churnSeconds) {
      const stay = sampleSessionSeconds(config.churnSeconds, random) * 1000;
      if (Date.now() + stay < endAt - 2000) {
        later(stay, () => {
          client.stop();
          clients.delete(client);
          active--;
          // The same room gets a replacement shortly after, so room sizes stay realistic.
          later(random() * 2000, () => void joinMember(room, name));
        });
      }
    }
  };

  rooms.forEach((size, r) => {
    const room = generateRoomId();
    const start = random() * rampMs;
    for (let i = 0; i < size; i++) later(start + random() * 3000, () => void joinMember(room, `sim-${r}-${i}`));
  });

  // Scrape the nodes while the run is going, keeping the worst values seen.
  const scrapes = new Map<string, NodeScrape & { cpuFirst?: number; cpuLast?: number; firstAt?: number; lastAt?: number }>();
  const scrapeOnce = async () => {
    for (const url of config.scrapeUrls ?? []) {
      try {
        const text = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text();
        const s = scrapes.get(url) ?? { url, maxConnections: 0, maxRooms: 0, maxRssMb: 0, maxEventLoopLagP99Ms: 0, avgCpuPercent: 0 };
        s.maxConnections = Math.max(s.maxConnections, scrapeValue(text, 'chillcall_signaling_connections') ?? 0);
        s.maxRooms = Math.max(s.maxRooms, scrapeValue(text, 'chillcall_signaling_rooms') ?? 0);
        s.maxRssMb = Math.max(s.maxRssMb, (scrapeValue(text, 'chillcall_process_resident_memory_bytes') ?? 0) / 1024 / 1024);
        s.maxEventLoopLagP99Ms = Math.max(s.maxEventLoopLagP99Ms, (scrapeValue(text, 'chillcall_nodejs_eventloop_lag_p99_seconds') ?? 0) * 1000);
        const cpu = (scrapeValue(text, 'chillcall_process_cpu_user_seconds_total') ?? 0) + (scrapeValue(text, 'chillcall_process_cpu_system_seconds_total') ?? 0);
        s.cpuFirst ??= cpu;
        s.firstAt ??= Date.now();
        s.cpuLast = cpu;
        s.lastAt = Date.now();
        scrapes.set(url, s);
      } catch {
        // A node that cannot be scraped is itself a finding; the run's join failures will show it.
      }
    }
  };

  const started = Date.now();
  await scrapeOnce();
  let lastLog = 0;
  while (Date.now() < endAt) {
    await sleep(1000);
    if (Date.now() - lastLog >= 5000) {
      lastLog = Date.now();
      const failed = Object.values(failures.toObject()).reduce((a, b) => a + b, 0);
      progress(
        `t=${Math.round((Date.now() - started) / 1000)}s active=${active} joined=${joinsOk} failed=${failed} joinP99=${Math.round(joinMs.percentile(99))}ms reconnects=${reconnects}`,
      );
      await scrapeOnce();
    }
  }
  await scrapeOnce();

  const connectedAtEnd = [...clients].filter((c) => c.state === 'connected').length;
  stopping = true;
  for (const t of timers) clearTimeout(t);
  for (const c of clients) c.stop();
  await sleep(500);

  const nodes: NodeScrape[] = [...scrapes.values()].map((s) => ({
    url: s.url,
    maxConnections: s.maxConnections,
    maxRooms: s.maxRooms,
    maxRssMb: Math.round(s.maxRssMb),
    maxEventLoopLagP99Ms: Math.round(s.maxEventLoopLagP99Ms * 10) / 10,
    avgCpuPercent: s.lastAt && s.firstAt && s.lastAt > s.firstAt ? Math.round((((s.cpuLast ?? 0) - (s.cpuFirst ?? 0)) / ((s.lastAt - s.firstAt) / 1000)) * 1000) / 10 : 0,
  }));

  const problems: string[] = [];
  const failedTotal = Object.values(failures.toObject()).reduce((a, b) => a + b, 0);
  if (failedTotal > 0) problems.push(`${failedTotal} joins failed: ${JSON.stringify(failures.toObject())}`);
  const limit = config.maxJoinP99Ms ?? 1500;
  if (joinMs.count > 0 && joinMs.percentile(99) > limit) problems.push(`join p99 ${Math.round(joinMs.percentile(99))}ms exceeds ${limit}ms`);
  if (joinsOk < config.users * (config.churnSeconds ? 1 : 0.999)) problems.push(`only ${joinsOk} of ${config.users} users joined`);
  if (!config.churnSeconds && connectedAtEnd < joinsOk * 0.999) problems.push(`${joinsOk - connectedAtEnd} of ${joinsOk} clients were not connected at the end`);

  return {
    users: config.users,
    rooms: rooms.length,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    peakActive: peak,
    connectedAtEnd,
    joinsOk,
    joinFailures: failures.toObject(),
    joinMs: joinMs.summary(),
    signalRttMs: rtt.summary(),
    signalsSent,
    signalsReceived,
    reconnects,
    reconnectMs: reconnectMs.summary(),
    nodes,
    passed: problems.length === 0,
    problems,
  };
}

export function formatReport(report: LoadReport): string {
  const ms = (n: number) => (Number.isNaN(n) ? 'n/a' : `${Math.round(n)}ms`);
  const lines = [
    `users ${report.users} in ${report.rooms} rooms, ran ${report.durationSeconds}s, peak ${report.peakActive} connected, ${report.connectedAtEnd} at the end`,
    `joins: ${report.joinsOk} ok, failures ${JSON.stringify(report.joinFailures)}`,
    `join time: p50 ${ms(report.joinMs.p50)}, p95 ${ms(report.joinMs.p95)}, p99 ${ms(report.joinMs.p99)}, max ${ms(report.joinMs.max)}`,
    `signal round trip: p50 ${ms(report.signalRttMs.p50)}, p95 ${ms(report.signalRttMs.p95)}, p99 ${ms(report.signalRttMs.p99)} (${report.signalsSent} sent, ${report.signalsReceived} received)`,
    `reconnects: ${report.reconnects}${report.reconnects ? `, p99 ${ms(report.reconnectMs.p99)}` : ''}`,
    ...report.nodes.map(
      (n) => `node ${n.url}: peak ${n.maxConnections} connections / ${n.maxRooms} rooms, ${n.maxRssMb} MB RSS, event-loop lag p99 ${n.maxEventLoopLagP99Ms}ms, avg CPU ${n.avgCpuPercent}%`,
    ),
    report.passed ? 'PASSED' : `FAILED: ${report.problems.join('; ')}`,
  ];
  return lines.join('\n');
}
