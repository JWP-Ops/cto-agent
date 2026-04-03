import { optionalEnv } from './lib/env.js';
import { log } from './lib/logger.js';

// Rate limiting: max dispatches per repo per hour
const dispatchLog = new Map<string, number[]>();
const MAX_DISPATCHES_PER_HOUR = 3;

function isRateLimited(repo: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const repoLog = (dispatchLog.get(repo) || []).filter(t => t > oneHourAgo);
  dispatchLog.set(repo, repoLog);
  return repoLog.length >= MAX_DISPATCHES_PER_HOUR;
}

function recordDispatch(repo: string) {
  const repoLog = dispatchLog.get(repo) || [];
  repoLog.push(Date.now());
  dispatchLog.set(repo, repoLog);
}

/**
 * Trigger the CTO auto-fix workflow via GitHub API workflow_dispatch.
 */
export async function dispatchAutoFix(repo: string, runId: number, workflowName: string): Promise<boolean> {
  if (isRateLimited(repo)) {
    log('warn', `Rate limited: ${repo} has reached ${MAX_DISPATCHES_PER_HOUR} dispatches/hour`);
    return false;
  }

  const token = optionalEnv('GITHUB_PAT');
  if (!token) {
    log('warn', 'GITHUB_PAT not set — cannot dispatch auto-fix');
    return false;
  }

  try {
    const res = await fetch(
      'https://api.github.com/repos/StorScale-AI/cto-agent/actions/workflows/auto-fix.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            repo,
            run_id: String(runId),
            workflow_name: workflowName,
          },
        }),
      }
    );

    if (res.status === 204) {
      recordDispatch(repo);
      log('info', `Dispatched auto-fix for ${repo} run ${runId}`);
      return true;
    }

    log('error', `Failed to dispatch auto-fix: ${res.status} ${await res.text()}`);
    return false;
  } catch (e) {
    log('error', `Dispatch error for ${repo}: ${e}`);
    return false;
  }
}
