import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

interface CheckResult {
  ok: boolean;
  actual?: unknown;
  expected?: string;
}

interface SyntheticCheck {
  name: string;
  run: () => Promise<CheckResult>;
}

function repoForCheck(checkName: string): string {
  if (checkName === 'dashboard-login-page') {
    return 'StorScale-AI/storscale-website';
  }
  return 'StorScale-AI/storscale-agents';
}

function escalationDedupeId(checkName: string): string {
  return `synthetic-${checkName}-${Math.floor(Date.now() / (2 * 60 * 60 * 1000))}`;
}

export function createSyntheticChecksPoller(dispatcher: Dispatcher) {
  const consecutiveFailures = new Map<string, number>();

  const checks: SyntheticCheck[] = [
    {
      name: 'api-health',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://agent-api.storscale.ai/api/health', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return { ok: false, actual: `HTTP ${res.status}`, expected: 'HTTP 200' };
        }
        const body = (await res.json()) as Record<string, unknown>;
        const ok = typeof body === 'object' && body !== null && body['status'] === 'ok';
        return { ok, actual: body, expected: '{ status: "ok" }' };
      },
    },
    {
      name: 'intelligence-report',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://agent-api.storscale.ai/api/intelligence/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zip_code: '78701', radius_miles: 5 }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          return {
            ok: false,
            actual: `HTTP ${res.status}`,
            expected: 'HTTP 200 with non-empty report key',
          };
        }
        const body = (await res.json()) as Record<string, unknown>;
        const report = body['report'];
        const ok = typeof report === 'string' && report.length > 0;
        return {
          ok,
          actual: ok ? 'has non-empty report' : `report=${JSON.stringify(report)}`,
          expected: 'object with non-empty string report key',
        };
      },
    },
    {
      name: 'facilities-list',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://agent-api.storscale.ai/api/facilities', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return { ok: false, actual: `HTTP ${res.status}`, expected: 'HTTP 200 with array ≥1 item' };
        }
        const body = (await res.json()) as unknown;
        const ok = Array.isArray(body) && body.length >= 1;
        return {
          ok,
          actual: Array.isArray(body) ? `array(${body.length})` : typeof body,
          expected: 'array with ≥1 item',
        };
      },
    },
    {
      name: 'dashboard-login-page',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://app.storscale.ai', {
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          return { ok: false, actual: `HTTP ${res.status}`, expected: 'HTTP 200' };
        }
        const html = await res.text();
        const hasMeta = html.includes('<meta');
        const hasStorScale = html.includes('StorScale');
        const ok = hasMeta && hasStorScale;
        return {
          ok,
          actual: `hasMeta=${hasMeta} hasStorScale=${hasStorScale}`,
          expected: 'HTML with <meta tags and "StorScale" text',
        };
      },
    },
  ];

  return async function syntheticChecksPoller(): Promise<void> {
    const results = await Promise.allSettled(
      checks.map(async (check) => {
        try {
          const result = await check.run();
          return { name: check.name, ...result };
        } catch (err) {
          return {
            name: check.name,
            ok: false,
            actual: err instanceof Error ? err.message : String(err),
            expected: 'no network error',
          };
        }
      }),
    );

    for (const settled of results) {
      if (settled.status === 'rejected') continue;
      const { name, ok, actual, expected } = settled.value;

      if (ok) {
        consecutiveFailures.set(name, 0);
        continue;
      }

      const prev = consecutiveFailures.get(name) ?? 0;
      const failCount = prev + 1;
      consecutiveFailures.set(name, failCount);

      log('warn', `Synthetic check failed: ${name} (consecutive=${failCount})`, {
        check: name,
        actual,
        expected,
      });

      if (failCount === 1) {
        await sendAlert({
          severity: 'warning',
          title: `CTO Agent: Synthetic Check Failed — ${name}`,
          message: `*Check:* ${name}\n*Expected:* ${expected}\n*Got:* ${JSON.stringify(actual)}`,
        });
      }

      if (failCount >= 2) {
        await sendAlert({
          severity: 'danger',
          title: `CTO Agent: Synthetic Check Escalating — ${name}`,
          message: `*Check:* ${name} has failed ${failCount} times in a row.\n*Expected:* ${expected}\n*Got:* ${JSON.stringify(actual)}\nDispatching auto-fix.`,
        });

        await dispatcher.dispatch({
          category: 'e2e-fix',
          repo: 'JWP-Ops/cto-agent',
          workflow: 'auto-fix.yml',
          inputs: {
            repo: repoForCheck(name),
            run_id: '0',
            workflow_name: 'synthetic-checks',
            task_type: 'fix-e2e-failure',
            e2e_test_file: `synthetic-check:${name}`,
            e2e_error_message: `Synthetic check '${name}' failed ${failCount} consecutive times. Expected: ${expected}. Got: ${JSON.stringify(actual)}`,
          },
          dedupeId: escalationDedupeId(name),
        });
      }
    }
  };
}
