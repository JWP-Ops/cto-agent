-- CTO Agent — Supabase Schema
-- Tables for incident tracking and health snapshots

-- Incident tracking: every CI failure detected and fix attempted
CREATE TABLE IF NOT EXISTS cto_agent_incidents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  repo text NOT NULL,
  run_id bigint,
  failure_type text NOT NULL,
  pattern_matched text,
  fix_applied boolean DEFAULT false,
  fix_commit_sha text,
  diff_summary jsonb,
  escalated boolean DEFAULT false,
  escalation_reason text,
  detected_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cto_agent_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_incidents" ON cto_agent_incidents
  FOR ALL USING (true);

-- Health snapshots: time-series data from each poller
CREATE TABLE IF NOT EXISTS cto_agent_health_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  platform text NOT NULL,
  status text NOT NULL,
  details jsonb,
  checked_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cto_agent_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_snapshots" ON cto_agent_health_snapshots
  FOR ALL USING (true);

-- Index for querying recent snapshots per platform
CREATE INDEX IF NOT EXISTS idx_health_snapshots_platform_checked
  ON cto_agent_health_snapshots (platform, checked_at DESC);

-- Index for querying incidents by repo
CREATE INDEX IF NOT EXISTS idx_incidents_repo_detected
  ON cto_agent_incidents (repo, detected_at DESC);
