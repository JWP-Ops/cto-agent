import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import { optionalEnv } from '../lib/env.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

const RENDER_API_BASE = 'https://api.render.com/v1';
const FAILED_STATUSES = new Set(['failed', 'build_failed', 'update_failed']);

interface RenderService {
  id: string;
  name: string;
  slug: string;
  type: string;
}

interface RenderDeploy {
  id: string;
  status: string;
  commit?: { message?: string };
  finishedAt?: string;
}

/** Map a Render service slug/name to the GitHub repo that owns it */
function repoForService(service: RenderService): string {
  const mapping: Record<string, string> = {
    'cto-agent-monitor': 'JWP-Ops/cto-agent',
    'storscale-agents':  'StorScale-AI/storscale-agents',
    'finops-api':        'JWP-Ops/cfo-agent',
  };
  return mapping[service.slug] ?? mapping[service.name] ?? `StorScale-AI/${service.slug}`;
}

/**
 * Factory — returns a render-deploys poller with an injected dispatcher.
 *
 * Each poll fetches all Render services then checks the latest deploy for each.
 * A failed deploy (status: failed | build_failed) triggers a Slack danger alert
 * and dispatches task_type:fix-deploy-failure to JWP-Ops/cto-agent/auto-fix.yml.
 *
 * Dedup is handled by a closure-scoped Set of alerted deploy IDs — each unique
 * deploy ID is dispatched exactly once. The Dispatcher adds a secondary dedup
 * via dedupeId, but the Set is the first gate (avoids unnecessary API calls).
 */
export function createRenderDeploysPoller(dispatcher: Dispatcher) {
  const alertedDeployIds = new Set<string>();

  async function fetchServices(apiKey: string): Promise<RenderService[]> {
    const res = await fetch(`${RENDER_API_BASE}/services?limit=20`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log('warn', `Render services fetch failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as Array<{ service: RenderService }>;
    return data.map((d) => d.service);
  }

  async function fetchLatestDeploy(
    apiKey: string,
    serviceId: string,
  ): Promise<RenderDeploy | null> {
    const res = await fetch(
      `${RENDER_API_BASE}/services/${serviceId}/deploys?limit=1`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      log('warn', `Render deploys fetch failed for ${serviceId}: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as Array<{ deploy: RenderDeploy }>;
    return data[0]?.deploy ?? null;
  }

  return async function renderDeploysPoller(): Promise<void> {
    const apiKey = optionalEnv('RENDER_API_KEY');
    if (!apiKey) {
      log('debug', 'RENDER_API_KEY not set — render-deploys poller skipped');
      return;
    }

    let services: RenderService[];
    try {
      services = await fetchServices(apiKey);
    } catch (err) {
      log('warn', 'render-deploys: failed to fetch services list', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await Promise.allSettled(
      services.map(async (service) => {
        let deploy: RenderDeploy | null;
        try {
          deploy = await fetchLatestDeploy(apiKey, service.id);
        } catch (err) {
          log('warn', `render-deploys: deploy fetch failed for ${service.name}`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        if (!deploy) return;
        if (!FAILED_STATUSES.has(deploy.status)) return;
        if (alertedDeployIds.has(deploy.id)) return;

        alertedDeployIds.add(deploy.id);

        const commitMsg = deploy.commit?.message ?? 'unknown commit';
        const repo = repoForService(service);

        log('warn', `Render deploy failed: ${service.name} (${deploy.id})`, {
          service: service.name,
          deployId: deploy.id,
          status: deploy.status,
          commit: commitMsg,
        });

        await dispatcher.dispatch({
          category: 'e2e-fix',
          repo: 'JWP-Ops/cto-agent',
          workflow: 'auto-fix.yml',
          inputs: {
            repo,
            run_id: '0',
            workflow_name: 'render-deploys',
            task_type: 'fix-deploy-failure',
            deploy_service: service.name,
            deploy_id: deploy.id,
            deploy_logs: `Render deploy ${deploy.id} for service "${service.name}" failed with status: ${deploy.status}. Last commit: ${commitMsg}`,
          },
          dedupeId: `render-deploy-${deploy.id}`,
        });

        // Alert after dispatch so a Slack outage cannot block the auto-fix
        await sendAlert({
          severity: 'danger',
          title: `CTO Agent: Render Deploy Failed — ${service.name}`,
          message: `*Service:* ${service.name}\n*Status:* ${deploy.status}\n*Deploy:* \`${deploy.id}\`\n*Commit:* ${commitMsg}\nAuto-fix dispatched.`,
        }).catch((err) => log('warn', 'render-deploys: Slack alert failed', { error: String(err) }));
      }),
    );
  };
}
