import fs from 'node:fs';
import { startLocalFleet } from './fleet';
import { formatReport, runLoad } from './run';

const USAGE = `chillcall-loadgen: simulated signaling load, no media

  --users <n>          people to simulate (default 1000)
  --ramp <seconds>     time over which rooms start joining (default 30)
  --hold <seconds>     time to stay connected after the ramp (default 30)
  --churn <seconds>    mean session length; people leave and are replaced (default: off)
  --signals <n>        signals per peer pair and direction (default 14)
  --seed <n>           repeat a run exactly (default 1)
  --max-join-p99 <ms>  fail above this join time (default 1500)
  --out <file>         also write the report as JSON

  Against a running deployment:
  --target <url>       beacon address, for example http://localhost:8080
  --scrape <urls>      comma-separated /metrics URLs of signaling nodes

  Or start a local fleet (beacon + nodes as separate processes) and test that:
  --fleet <nodes>      for example --fleet 3
`;

function parse(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    flags.set(arg.slice(2), value);
    i++;
  }
  return flags;
}

const num = (flags: Map<string, string>, key: string, fallback: number) => (flags.has(key) ? Number(flags.get(key)) : fallback);

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return void console.log(USAGE);
  const flags = parse(process.argv.slice(2));

  let fleet;
  let beaconUrl = flags.get('target');
  let scrapeUrls = flags.get('scrape')?.split(',').filter(Boolean);
  if (flags.has('fleet')) {
    const nodes = Number(flags.get('fleet'));
    console.log(`starting a local fleet: 1 beacon and ${nodes} signaling node(s)`);
    fleet = await startLocalFleet(nodes);
    beaconUrl = fleet.beaconUrl;
    scrapeUrls = fleet.metricsUrls;
  }
  if (!beaconUrl) throw new Error('give --target <beacon url> or --fleet <nodes>\n\n' + USAGE);

  try {
    const report = await runLoad({
      beaconUrl,
      users: num(flags, 'users', 1000),
      rampSeconds: num(flags, 'ramp', 30),
      holdSeconds: num(flags, 'hold', 30),
      churnSeconds: flags.has('churn') ? num(flags, 'churn', 0) : undefined,
      signalsPerPair: flags.has('signals') ? num(flags, 'signals', 14) : undefined,
      seed: num(flags, 'seed', 1),
      maxJoinP99Ms: num(flags, 'max-join-p99', 1500),
      scrapeUrls,
      progress: (line) => console.log(line),
    });
    console.log(`\n${formatReport(report)}`);
    if (flags.has('out')) fs.writeFileSync(flags.get('out')!, JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } finally {
    await fleet?.stop();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
