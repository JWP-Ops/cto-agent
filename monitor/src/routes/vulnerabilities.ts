import type { Hono } from 'hono';
import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

export interface VulnerabilityEntry {
  cveId: string;
  packageName: string;
  currentVersion: string;
  fixedVersion: string;
  severity: string;
  title: string;
}

interface VulnerabilityPayload {
  repo: string;
  vulnerabilities: VulnerabilityEntry[];
}

const ACTIONABLE_SEVERITIES = new Set(['critical', 'high']);
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1 };
const MAX_DISPATCHES = 3;

/**
 * Registers POST /api/vulnerabilities on the given Hono app.
 * Called by the npm-audit.yml GitHub Actions workflow after running
 * `npm audit --json` on monitored repos.
 * Dispatches dep-patch jobs for the top MAX_DISPATCHES critical/high CVEs
 * sorted by severity (critical before high). Dedup by (repo + package + cveId + day)
 * is delegated to the Dispatcher's dedupeId mechanism.
 */
export function vulnerabilityRoutes(app: Hono, dispatcher: Dispatcher): void {
  app.post('/api/vulnerabilities', async (c) => {
    const apiKey = optionalEnv('CTO_API_KEY');
    if (apiKey) {
      const auth = c.req.header('Authorization') ?? '';
      if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    let body: VulnerabilityPayload;
    try {
      body = await c.req.json<VulnerabilityPayload>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.repo || !Array.isArray(body.vulnerabilities)) {
      return c.json({ error: 'Missing required fields: repo, vulnerabilities' }, 400);
    }

    const actionable = body.vulnerabilities
      .filter((v) => ACTIONABLE_SEVERITIES.has(v.severity))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99))
      .slice(0, MAX_DISPATCHES);

    if (actionable.length === 0) {
      log('info', `Vulnerability report: no critical/high CVEs in ${body.repo}`);
      return c.json({ dispatched: 0, message: 'No critical or high severity vulnerabilities' });
    }

    const today = new Date().toISOString().slice(0, 10);
    let dispatched = 0;
    const dispatchedCves: string[] = [];

    for (const vuln of actionable) {
      const result = await dispatcher.dispatch({
        category: 'dep-patch',
        repo: 'JWP-Ops/cto-agent',
        workflow: 'auto-fix.yml',
        inputs: {
          repo: body.repo,
          run_id: '0',
          workflow_name: 'npm-audit',
          task_type: 'dep-patch',
          vulnerable_package: vuln.packageName,
          fixed_version: vuln.fixedVersion,
          severity: vuln.severity,
          cve_id: vuln.cveId,
        },
        dedupeId: `dep-patch-${body.repo}-${vuln.packageName}-${vuln.cveId}-${today}`,
      });

      if (result.dispatched) {
        dispatched++;
        dispatchedCves.push(`${vuln.packageName}@${vuln.fixedVersion} (${vuln.cveId})`);
        log('info', 'Dispatched dep-patch', {
          repo: body.repo,
          package: vuln.packageName,
          severity: vuln.severity,
          cveId: vuln.cveId,
        });
      }
    }

    if (dispatched > 0) {
      await sendAlert({
        severity: 'warning',
        title: 'CTO Agent: Vulnerability Scan — Patches Dispatched',
        message: `*Repo:* ${body.repo}\nDispatched ${dispatched} patch job(s).\n*Packages:* ${dispatchedCves.join(', ')}`,
      });
    }

    return c.json({ dispatched, cves: dispatchedCves });
  });
}
