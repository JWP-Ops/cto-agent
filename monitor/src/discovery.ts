import { requireEnv } from './lib/env.js';
import { log } from './lib/logger.js';

interface GitHubRepo {
  full_name: string;
  archived: boolean;
  disabled: boolean;
  pushed_at: string;
}

/**
 * Auto-discover all repos accessible via the GitHub PAT.
 * Lists repos from all orgs the user belongs to + personal repos.
 * Returns full_name format (e.g., "StorScale-AI/storscale-agents").
 */
export async function discoverRepos(): Promise<string[]> {
  const token = requireEnv('GITHUB_PAT');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const repos: string[] = [];

  // Get all orgs
  const orgsRes = await fetch('https://api.github.com/user/orgs?per_page=100', { headers });
  const orgs: Array<{ login: string }> = orgsRes.ok ? await orgsRes.json() as Array<{ login: string }> : [];

  // Fetch repos from each org
  for (const org of orgs) {
    try {
      const res = await fetch(
        `https://api.github.com/orgs/${org.login}/repos?per_page=100&sort=pushed&type=all`,
        { headers }
      );
      if (!res.ok) continue;
      const orgRepos: GitHubRepo[] = await res.json() as GitHubRepo[];
      for (const repo of orgRepos) {
        if (!repo.archived && !repo.disabled) {
          repos.push(repo.full_name);
        }
      }
    } catch (e) {
      log('warn', `Failed to fetch repos for org ${org.login}: ${e}`);
    }
  }

  // Personal repos
  try {
    const res = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner',
      { headers }
    );
    if (res.ok) {
      const personalRepos: GitHubRepo[] = await res.json() as GitHubRepo[];
      for (const repo of personalRepos) {
        if (!repo.archived && !repo.disabled && !repos.includes(repo.full_name)) {
          repos.push(repo.full_name);
        }
      }
    }
  } catch (e) {
    log('warn', `Failed to fetch personal repos: ${e}`);
  }

  log('info', `Discovered repos: ${repos.join(', ')}`);
  return repos;
}
