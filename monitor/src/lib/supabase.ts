import { optionalEnv } from './env.js';
import { log } from './logger.js';

const SUPABASE_URL = () => optionalEnv('SUPABASE_URL');
const SUPABASE_KEY = () => optionalEnv('SUPABASE_SERVICE_ROLE_KEY');

function isConfigured(): boolean {
  return !!(SUPABASE_URL() && SUPABASE_KEY());
}

async function supabaseInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const url = SUPABASE_URL();
  const key = SUPABASE_KEY();

  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert to ${table} failed (${res.status}): ${body}`);
  }
}

/**
 * Persist a health snapshot to Supabase. No-op if credentials are missing.
 */
export async function insertHealthSnapshot(
  platform: string,
  status: string,
  details: Record<string, unknown>,
  checkedAt: string,
): Promise<void> {
  if (!isConfigured()) return;

  await supabaseInsert('cto_agent_health_snapshots', {
    platform,
    status,
    details,
    checked_at: checkedAt,
  });
}

/**
 * Persist an incident record to Supabase. No-op if credentials are missing.
 */
export async function insertIncident(incident: {
  repo: string;
  run_id: number;
  failure_type: string;
  pattern_matched?: string;
  fix_applied?: boolean;
  fix_commit_sha?: string;
  diff_summary?: Record<string, unknown>;
  escalated?: boolean;
  escalation_reason?: string;
  detected_at: string;
  resolved_at?: string;
}): Promise<void> {
  if (!isConfigured()) return;

  await supabaseInsert('cto_agent_incidents', incident);
}
