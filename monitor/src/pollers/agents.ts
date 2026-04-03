import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

interface AgentRunRow {
  agent_slug: string;
  status: string;
  created_at: string;
}

/**
 * Monitor agent health by querying the agent_runs table in Supabase.
 * Checks success/failure rates over the last 24 hours.
 */
export async function pollAgentHealth(): Promise<void> {
  const url = optionalEnv('SUPABASE_URL');
  const serviceKey = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    log('debug', 'Agent health poller skipped — missing Supabase credentials');
    return;
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

    // Get recent agent runs
    const res = await fetch(
      `${url}/rest/v1/agent_runs?select=agent_slug,status,created_at&created_at=gte.${oneDayAgo}&order=created_at.desc&limit=500`,
      { headers }
    );

    if (!res.ok) {
      log('warn', `Agent health query failed: ${res.status}`);
      recordHealth('agents', { status: 'error', error: `Query failed: ${res.status}`, checked_at: new Date().toISOString() });
      return;
    }

    const runs = await res.json() as AgentRunRow[];

    // Aggregate by agent
    const byAgent = new Map<string, { success: number; failure: number; total: number }>();
    for (const run of runs) {
      const stats = byAgent.get(run.agent_slug) || { success: 0, failure: 0, total: 0 };
      stats.total++;
      if (run.status === 'success' || run.status === 'completed') {
        stats.success++;
      } else if (run.status === 'error' || run.status === 'failed') {
        stats.failure++;
      }
      byAgent.set(run.agent_slug, stats);
    }

    // Flag agents with >25% failure rate
    const unhealthyAgents: string[] = [];
    const agentSummary: Record<string, { success: number; failure: number; rate: number }> = {};

    for (const [agentId, stats] of byAgent) {
      const failureRate = stats.total > 0 ? stats.failure / stats.total : 0;
      agentSummary[agentId] = {
        success: stats.success,
        failure: stats.failure,
        rate: Math.round(failureRate * 100),
      };
      if (failureRate > 0.25 && stats.total >= 3) {
        unhealthyAgents.push(agentId);
      }
    }

    if (unhealthyAgents.length > 0) {
      await alertPlatformIssue('Agent Health',
        `${unhealthyAgents.length} agent(s) with >25% failure rate (24h): ${unhealthyAgents.join(', ')}`
      );
    }

    recordHealth('agents', {
      status: unhealthyAgents.length === 0 ? 'healthy' : 'degraded',
      total_runs_24h: runs.length,
      agents_monitored: byAgent.size,
      unhealthy_agents: unhealthyAgents,
      summary: agentSummary,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    log('error', `Agent health poller error: ${e}`);
    recordHealth('agents', { status: 'error', error: String(e), checked_at: new Date().toISOString() });
  }
}
