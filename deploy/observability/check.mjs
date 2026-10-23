// Checks a running Prometheus against this directory's rules and dashboard:
//   node check.mjs [prometheus-url]        (default http://localhost:9090)
// Every scrape target must be up, every alert rule must have loaded and evaluated without error, and every
// query on the Grafana dashboard must be valid PromQL that Prometheus can run (an empty result is fine).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prometheus = process.argv[2] ?? 'http://localhost:9090';
const here = path.dirname(fileURLToPath(import.meta.url));
const problems = [];

async function api(pathAndQuery) {
  const res = await fetch(new URL(pathAndQuery, prometheus));
  return res.json();
}

const targets = (await api('/api/v1/targets')).data.activeTargets;
for (const t of targets) {
  console.log(`target ${t.labels.job} ${t.scrapeUrl}: ${t.health}`);
  if (t.health !== 'up') problems.push(`target ${t.scrapeUrl} is ${t.health}: ${t.lastError}`);
}

const rules = (await api('/api/v1/rules')).data.groups.flatMap((g) => g.rules);
console.log(`${rules.length} alert rules loaded`);
if (rules.length === 0) problems.push('no alert rules loaded');
for (const r of rules) if (r.health !== 'ok') problems.push(`rule ${r.name} is ${r.health}: ${r.lastError}`);

const dashboard = JSON.parse(fs.readFileSync(path.join(here, 'grafana/dashboards/orvo.json'), 'utf8'));
let queries = 0;
let withData = 0;
for (const panel of dashboard.panels) {
  for (const target of panel.targets) {
    queries++;
    const result = await api(`/api/v1/query?query=${encodeURIComponent(target.expr)}`);
    if (result.status !== 'success') problems.push(`panel "${panel.title}": ${result.error}`);
    else if (result.data.result.length > 0) withData++;
  }
}
console.log(`${queries} dashboard queries ran, ${withData} returned data`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('OK');
