import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

// Known Cloudflare Workers health endpoints
const WORKER_ENDPOINTS = [
  {
    name: 'storops-dashboard-api',
    url: 'https://storops-dashboard-api.storscale.workers.dev/health',
  },
];

export async function pollCloudflare(): Promise<void> {
  const results: Array<{ name: string; status: string; latencyMs?: number }> = [];

  for (const worker of WORKER_ENDPOINTS) {
    try {
      const start = Date.now();
      const res = await fetch(worker.url, {
        signal: AbortSignal.timeout(10000), // 10s timeout
      });
      const latencyMs = Date.now() - start;

      if (res.ok) {
        results.push({ name: worker.name, status: 'healthy', latencyMs });
      } else {
        results.push({ name: worker.name, status: `http_${res.status}` });
        await alertPlatformIssue('Cloudflare', `Worker *${worker.name}* returned ${res.status}`);
      }
    } catch (e) {
      results.push({ name: worker.name, status: 'unreachable' });
      await alertPlatformIssue('Cloudflare', `Worker *${worker.name}* is unreachable: ${e}`);
    }
  }

  // Also check via API if token is available
  const cfToken = optionalEnv('CLOUDFLARE_API_TOKEN');
  if (cfToken) {
    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${cfToken}` },
      });
      if (res.ok) {
        const data = await res.json() as { success?: boolean };
        if (!data.success) {
          log('warn', 'Cloudflare API token verification failed');
        }
      }
    } catch (e) {
      log('warn', `Cloudflare API check failed: ${e}`);
    }
  }

  const unhealthy = results.filter(r => r.status !== 'healthy');

  recordHealth('cloudflare', {
    status: unhealthy.length === 0 ? 'healthy' : 'degraded',
    workers: results,
    checked_at: new Date().toISOString(),
  });
}
