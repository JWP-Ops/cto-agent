import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

export async function pollSupabase(): Promise<void> {
  const url = optionalEnv('SUPABASE_URL');
  const serviceKey = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    log('debug', 'Supabase poller skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    // Health check via REST API — simple query to verify connectivity
    const healthRes = await fetch(`${url}/rest/v1/`, {
      method: 'HEAD',
      headers,
    });

    const isReachable = healthRes.ok || healthRes.status === 404; // 404 = no default table, but API is up

    // Check agent_runs table for recent activity (verifies data layer is working)
    const runsRes = await fetch(
      `${url}/rest/v1/agent_runs?select=id&limit=1&order=created_at.desc`,
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );

    const agentRunsAccessible = runsRes.ok;

    if (!isReachable) {
      await alertPlatformIssue('Supabase', 'Supabase REST API is unreachable');
    }

    recordHealth('supabase', {
      status: isReachable ? 'healthy' : 'degraded',
      api_reachable: isReachable,
      agent_runs_accessible: agentRunsAccessible,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    log('error', `Supabase poller error: ${e}`);
    recordHealth('supabase', {
      status: 'error',
      error: String(e),
      checked_at: new Date().toISOString(),
    });
  }
}
