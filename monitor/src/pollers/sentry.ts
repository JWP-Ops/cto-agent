import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  status: string;
  lastSeen: string;
  metadata: {
    filename?: string;
    lineNo?: number;
  };
}

const SENTRY_API = 'https://sentry.io/api/0';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Determine which repo to target based on issue culprit string.
 */
function repoForIssue(issue: SentryIssue): string {
  const culprit = issue.culprit ?? '';
  if (culprit.includes('agent-api') || culprit.includes('storscale-agents')) {
    return 'StorScale-AI/storscale-agents';
  }
  return 'StorScale-AI/storscale-website';
}

/**
 * Factory that returns a Sentry poller function with an injected dispatcher.
 * Polls the Sentry REST API for unresolved issues in the last 24 hours and
 * dispatches auto-fix.yml for each new issue via the dispatcher.
 */
export function createSentryPoller(dispatcher: Dispatcher) {
  return async function sentryPoller(): Promise<void> {
    const token = process.env.SENTRY_API_TOKEN;
    const org = process.env.SENTRY_ORG;

    if (!token || !org) {
      log('warn', 'SENTRY_API_TOKEN or SENTRY_ORG not set — skipping Sentry poller');
      return;
    }

    let issues: SentryIssue[];
    try {
      const res = await fetch(
        `${SENTRY_API}/organizations/${org}/issues/?query=is:unresolved&limit=25&sort=date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        log('error', `Sentry API returned ${res.status}`);
        return;
      }
      issues = await res.json() as SentryIssue[];
    } catch (err) {
      log('error', 'Failed to fetch Sentry issues', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    for (const issue of issues) {
      const ageMs = Date.now() - new Date(issue.lastSeen).getTime();
      if (ageMs > TWENTY_FOUR_HOURS_MS) continue;

      const result = await dispatcher.dispatch({
        category: 'sentry-fix',
        repo: repoForIssue(issue),
        workflow: 'auto-fix.yml',
        inputs: {
          task_type: 'fix-sentry-issue',
          sentry_issue_title: issue.title,
          sentry_issue_file: issue.metadata.filename ?? issue.culprit ?? '',
          sentry_issue_line: String(issue.metadata.lineNo ?? ''),
        },
        dedupeId: `sentry-${issue.id}`,
      });

      if (result.dispatched) {
        await sendAlert({
          severity: 'warning',
          title: 'CTO Agent: Sentry Auto-Fix Dispatched',
          message: `*Issue:* ${issue.title}\n*File:* ${issue.metadata.filename ?? issue.culprit ?? 'unknown'}\nAuto-fix in progress — check GitHub Actions for status.`,
        });
        log('info', 'Dispatched Sentry fix', { issueId: issue.id, title: issue.title });
      }
    }
  };
}
