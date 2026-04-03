import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

interface RenderDeploy {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  commit: { message: string } | null;
}

/**
 * Parse RENDER_SERVICE_IDS env var.
 * Format: "name1:id1,name2:id2"
 */
function getServices(): Array<{ name: string; id: string }> {
  const raw = optionalEnv('RENDER_SERVICE_IDS');
  if (!raw) return [];
  return raw.split(',').map(pair => {
    const [name, id] = pair.split(':');
    return { name: name.trim(), id: id.trim() };
  }).filter(s => s.name && s.id);
}

export async function pollRender(): Promise<void> {
  const apiKey = optionalEnv('RENDER_API_KEY');
  if (!apiKey) {
    log('debug', 'Render poller skipped — no RENDER_API_KEY');
    return;
  }

  const services = getServices();
  if (services.length === 0) {
    log('debug', 'Render poller skipped — no RENDER_SERVICE_IDS configured');
    return;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  const results: Array<{ name: string; status: string; deployId?: string }> = [];

  for (const service of services) {
    try {
      const res = await fetch(
        `https://api.render.com/v1/services/${service.id}/deploys?limit=1`,
        { headers }
      );

      if (!res.ok) {
        log('warn', `Render API error for ${service.name}: ${res.status}`);
        results.push({ name: service.name, status: 'unknown' });
        continue;
      }

      const deploys = await res.json() as RenderDeploy[];
      if (deploys.length === 0) {
        results.push({ name: service.name, status: 'no_deploys' });
        continue;
      }

      const latest = deploys[0];
      results.push({ name: service.name, status: latest.status, deployId: latest.id });

      if (latest.status === 'build_failed' || latest.status === 'update_failed') {
        await alertPlatformIssue('Render', `Deploy failed for *${service.name}* (${latest.status})`);
      }
    } catch (e) {
      log('error', `Error polling Render service ${service.name}: ${e}`);
      results.push({ name: service.name, status: 'error' });
    }
  }

  const failedServices = results.filter(r =>
    r.status === 'build_failed' || r.status === 'update_failed' || r.status === 'error'
  );

  recordHealth('render', {
    status: failedServices.length === 0 ? 'healthy' : 'degraded',
    services: results,
    checked_at: new Date().toISOString(),
  });
}
