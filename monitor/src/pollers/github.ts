import { requireEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { dispatchAutoFix } from '../dispatch.js';
import { alertEscalation } from '../slack.js';
import { recordHealth } from '../health-api.js';

// Track which run IDs we've already seen to avoid duplicate dispatches
const seenRuns = new Set<number>();
const MAX_SEEN = 1000;

function pruneSeenRuns() {
  if (seenRuns.size > MAX_SEEN) {
    const arr = Array.from(seenRuns);
    arr.slice(0, arr.length - MAX_SEEN / 2).forEach(id => seenRuns.delete(id));
  }
}

interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  head_branch: string;
  head_commit: { message: string; author: { name: string } };
  html_url: string;
  created_at: string;
}

/**
 * Poll GitHub CI status across all discovered repos.
 * For each repo, check the latest workflow runs on main.
 * If a failure is found that hasn't been seen, dispatch auto-fix.
 */
export async function pollGitHub(repos: string[]): Promise<void> {
  const token = requireEnv('GITHUB_PAT');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let healthyCount = 0;
  let failedCount = 0;
  const failures: string[] = [];

  for (const repo of repos) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=3&status=completed`,
        { headers }
      );

      if (!res.ok) {
        if (res.status === 404) continue; // Repo has no workflows
        log('warn', `GitHub API error for ${repo}: ${res.status}`);
        continue;
      }

      const data: { workflow_runs: WorkflowRun[] } = await res.json() as { workflow_runs: WorkflowRun[] };
      const runs = data.workflow_runs || [];

      if (runs.length === 0) continue;

      const latestRun = runs[0];

      if (latestRun.conclusion === 'failure' && !seenRuns.has(latestRun.id)) {
        seenRuns.add(latestRun.id);
        failedCount++;
        failures.push(repo);

        // Skip if it's a CTO agent fix attempt
        if (latestRun.head_commit?.message?.includes('[cto-fix]')) {
          log('warn', `Skipping ${repo} — last commit was a CTO fix attempt`);
          await alertEscalation(repo, 'CTO auto-fix failed — manual intervention needed', latestRun.html_url);
          continue;
        }

        log('info', `CI failure detected: ${repo} run ${latestRun.id}`);
        const dispatched = await dispatchAutoFix(repo, latestRun.id, latestRun.name);
        if (!dispatched) {
          await alertEscalation(repo, 'Could not dispatch auto-fix (rate limited or API error)', latestRun.html_url);
        }
      } else if (latestRun.conclusion === 'success') {
        healthyCount++;
      }
    } catch (e) {
      log('error', `Error polling ${repo}: ${e}`);
    }
  }

  pruneSeenRuns();

  recordHealth('github', {
    status: failedCount === 0 ? 'healthy' : 'degraded',
    repos_checked: repos.length,
    healthy: healthyCount,
    failed: failedCount,
    failures,
    checked_at: new Date().toISOString(),
  });
}
