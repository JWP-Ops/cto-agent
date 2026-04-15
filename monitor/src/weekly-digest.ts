import { log } from './lib/logger.js';
import { optionalEnv } from './lib/env.js';
import { sendAlert } from './slack.js';
import { getWeeklyCostByCategory, getWeeklyTotalCost } from './cost-tracker.js';

const PROACTIVE_FAILURE_TYPES = new Set(['synthetic-check', 'e2e', 'render-deploy']);

export async function sendWeeklyDigest(): Promise<void> {
  const url = optionalEnv('SUPABASE_URL');
  const key = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    log('debug', 'Weekly digest skipped — no Supabase credentials');
    return;
  }

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };

  try {
    const incidentsRes = await fetch(
      `${url}/rest/v1/cto_agent_incidents?detected_at=gte.${oneWeekAgo}&order=detected_at.desc`,
      { headers }
    );

    const incidents = incidentsRes.ok
      ? (await incidentsRes.json() as Array<{
          repo: string;
          failure_type: string;
          pattern_matched: string | null;
          fix_applied: boolean;
          escalated: boolean;
          resolved_at: string | null;
        }>)
      : [];

    const totalIncidents = incidents.length;
    const fixApplied = incidents.filter(i => i.fix_applied).length;
    const escalated = incidents.filter(i => i.escalated).length;
    const resolved = incidents.filter(i => i.resolved_at).length;
    const patternMatched = incidents.filter(i => i.pattern_matched && i.pattern_matched !== 'claude-code').length;
    const caughtBeforeUsers = incidents.filter(i => PROACTIVE_FAILURE_TYPES.has(i.failure_type)).length;

    const patternCounts = new Map<string, number>();
    for (const i of incidents) {
      const p = i.pattern_matched || 'unmatched';
      patternCounts.set(p, (patternCounts.get(p) || 0) + 1);
    }
    const topPatterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}: ${count}`)
      .join('\n');

    const repoCounts = new Map<string, number>();
    for (const i of incidents) {
      repoCounts.set(i.repo, (repoCounts.get(i.repo) || 0) + 1);
    }
    const topRepos = [...repoCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}: ${count}`)
      .join('\n');

    const fixRate = totalIncidents > 0
      ? Math.round((fixApplied / totalIncidents) * 100)
      : 0;
    const resolveRate = totalIncidents > 0
      ? Math.round((resolved / totalIncidents) * 100)
      : 0;

    const weeklyCostByCategory = getWeeklyCostByCategory();
    const weeklyTotal = getWeeklyTotalCost();
    const costBreakdownLines = [...weeklyCostByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, cost]) => `${cat}: $${cost.toFixed(2)}`)
      .join('\n');

    const riskSummary = await buildRiskSummary(oneWeekAgo, escalated);

    const message = [
      `*Weekly CTO Agent Digest*`,
      `_${oneWeekAgo.split('T')[0]} — ${new Date().toISOString().split('T')[0]}_`,
      ``,
      `*Summary*`,
      `• Total incidents: ${totalIncidents}`,
      `• Fixes applied automatically: ${fixApplied} (${fixRate}%)`,
      `• Verified resolved: ${resolved} (${resolveRate}%)`,
      `• Escalated to human: ${escalated}`,
      `• Pattern-matched (fast path): ${patternMatched}`,
      ``,
      `*Fixed automatically*`,
      fixApplied > 0
        ? `The agent fixed ${fixApplied} issue${fixApplied !== 1 ? 's' : ''} without anyone touching it.`
        : `Nothing needed auto-fixing this week — clean run.`,
      ``,
      `*Caught before users saw it*`,
      caughtBeforeUsers > 0
        ? `Proactive checks flagged ${caughtBeforeUsers} issue${caughtBeforeUsers !== 1 ? 's' : ''} (synthetic checks, E2E, deploy failures) before any user was affected.`
        : `No proactive catches this week — checks all green.`,
      ``,
      `*Claude Code cost this week*`,
      weeklyTotal > 0
        ? [`Total: $${weeklyTotal.toFixed(2)}`, costBreakdownLines].join('\n')
        : `No Claude Code dispatches this week — $0.00 spent.`,
      ``,
      `*Risk summary*`,
      riskSummary,
      ``,
      `*Top Patterns*`,
      topPatterns || '(none)',
      ``,
      `*Most Affected Repos*`,
      topRepos || '(none)',
    ].join('\n');

    await sendAlert({
      severity: totalIncidents === 0 ? 'success' : escalated > 3 ? 'warning' : 'success',
      title: 'CTO Agent: Weekly Digest',
      message,
    });

    log('info', 'Weekly digest sent', { totalIncidents, fixApplied, escalated, resolved, caughtBeforeUsers, weeklyTotal });
  } catch (e) {
    log('error', `Weekly digest failed: ${e}`);
  }
}

async function buildRiskSummary(
  oneWeekAgo: string,
  escalated: number,
): Promise<string> {
  const lines: string[] = [];

  if (escalated > 0) {
    lines.push(`• ${escalated} incident${escalated !== 1 ? 's' : ''} needed human attention`);
  }

  const githubPat = optionalEnv('GITHUB_PAT');
  if (githubPat) {
    try {
      const since = oneWeekAgo.split('T')[0];
      const res = await fetch(
        `https://api.github.com/search/issues?q=label:risk:high+is:pr+org:StorScale-AI+created:>=${since}&per_page=10`,
        {
          headers: {
            Authorization: `Bearer ${githubPat}`,
            Accept: 'application/vnd.github+json',
          },
        }
      );
      if (res.ok) {
        const data = await res.json() as { total_count: number };
        if (data.total_count > 0) {
          lines.push(`• ${data.total_count} high-risk PR${data.total_count !== 1 ? 's' : ''} opened this week (labeled risk:high)`);
        }
      }
    } catch {
      // Non-critical — skip if GitHub API is unavailable
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No high-risk events this week.';
}
