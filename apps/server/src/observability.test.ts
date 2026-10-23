import { createBeaconApp } from '@orvo/beacon';
import { Metrics } from '@orvo/metrics';
import { MemoryPlacementStore } from '@orvo/placement';
import { SignalingServer } from '@orvo/signaling';
import { testKeys } from '@orvo/testkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The alert rules and dashboard only help if the metrics they name exist and the runbook says what to do. These
// tests build the real services, collect every metric they register, and check the files against them.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

interface Rule {
  alert: string;
  expr: string;
  for?: string;
  labels?: { severity?: string };
  annotations?: { summary?: string };
}

const alerts = parse(read('deploy/observability/alerts.yml')) as { groups: { name: string; rules: Rule[] }[] };
const rules = alerts.groups.flatMap((g) => g.rules);
const dashboard = JSON.parse(read('deploy/observability/grafana/dashboards/orvo.json')) as {
  panels: { id: number; title: string; datasource: { uid: string }; targets: { expr: string; datasource: { uid: string } }[] }[];
};

let known: Set<string>;
let closeApp: () => Promise<void>;

beforeAll(async () => {
  const metrics = new Metrics({ defaultMetrics: true });
  const key = testKeys('obs-1');
  const app = await createBeaconApp({
    signingKey: { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey },
    store: new MemoryPlacementStore(),
    stunUrls: [],
    metrics,
  });
  const signaling = new SignalingServer({ nodeId: 'obs', keys: key.keys, metrics: { registry: metrics.registry } });
  known = new Set(await metrics.names());
  closeApp = async () => {
    signaling.close();
    await app.close();
  };
});

afterAll(() => closeApp());

/** `orvo_*` metric names an expression refers to, with histogram suffixes folded into the family name. */
function referenced(expr: string): string[] {
  const names = expr.match(/orvo_[a-z0-9_]+/g) ?? [];
  return names.map((n) => (known.has(n) ? n : n.replace(/_(bucket|sum|count)$/, '')));
}

describe('alert rules', () => {
  it('only use metrics that the services register', () => {
    for (const rule of rules) {
      for (const name of referenced(rule.expr)) expect(known.has(name), `${rule.alert} uses unknown metric ${name}`).toBe(true);
    }
  });

  it('are complete: unique names, a severity, a summary, and a duration so blips do not page', () => {
    const names = rules.map((r) => r.alert);
    expect(new Set(names).size).toBe(names.length);
    for (const rule of rules) {
      expect(['page', 'ticket'], rule.alert).toContain(rule.labels?.severity);
      expect(rule.annotations?.summary?.length ?? 0, rule.alert).toBeGreaterThan(10);
      expect(rule.for, `${rule.alert} needs a for: duration`).toBeTruthy();
      expect(rule.expr.trim().length, rule.alert).toBeGreaterThan(0);
    }
  });

  it('are each explained in the runbook, under their own heading', () => {
    const runbook = read('docs/runbook.md');
    for (const rule of rules) expect(runbook, `${rule.alert} is missing from docs/runbook.md`).toContain(`### ${rule.alert}`);
  });

  it('refer to scrape jobs that prometheus.yml defines', () => {
    const prometheus = parse(read('deploy/observability/prometheus.yml')) as {
      rule_files: string[];
      scrape_configs: { job_name: string }[];
    };
    expect(prometheus.rule_files).toContain('alerts.yml');
    const jobs = new Set(prometheus.scrape_configs.map((c) => c.job_name));
    for (const rule of rules) {
      for (const job of rule.expr.match(/job="([^"]+)"/g) ?? []) expect(jobs.has(job.slice(5, -1)), `${rule.alert}: ${job}`).toBe(true);
    }
  });
});

describe('dashboard', () => {
  it('only graphs metrics that the services register', () => {
    for (const panel of dashboard.panels) {
      for (const target of panel.targets) {
        expect(target.expr.trim().length, panel.title).toBeGreaterThan(0);
        for (const name of referenced(target.expr)) expect(known.has(name), `${panel.title} uses unknown metric ${name}`).toBe(true);
      }
    }
  });

  it('has unique panel ids and uses the provisioned data source', () => {
    const ids = dashboard.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const datasource = parse(read('deploy/observability/grafana/provisioning/datasources/prometheus.yml')) as {
      datasources: { uid: string }[];
    };
    const uid = datasource.datasources[0]!.uid;
    for (const panel of dashboard.panels) {
      expect(panel.datasource.uid).toBe(uid);
      for (const target of panel.targets) expect(target.datasource.uid).toBe(uid);
    }
  });
});
