import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { createSentryPoller } from '../../monitor/src/pollers/sentry.js';
import { log } from '../../monitor/src/lib/logger.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

// Minimal mock matching the Dispatcher interface
function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return {
    dispatch: vi.fn(() => Promise.resolve(result)),
  };
}

function recentIso(offsetMs = 0): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function oldIso(): string {
  // 25 hours ago — outside the 24h window
  return new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
}

function makeSentryIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc123',
    title: 'TypeError: Cannot read property of undefined',
    culprit: 'storscale-agents/src/agent.ts',
    status: 'unresolved',
    lastSeen: recentIso(30 * 60 * 1000), // 30 min ago
    metadata: {
      filename: 'src/agent.ts',
      lineNo: 42,
    },
    ...overrides,
  };
}

describe('Sentry poller', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    process.env = {
      ...OLD_ENV,
      SENTRY_API_TOKEN: 'test-sentry-token',
      SENTRY_ORG: 'storscale',
    };
  });

  it('dispatches a fix for a new unresolved issue seen in the last hour', async () => {
    const issue = makeSentryIssue();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([issue]),
    });
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = makeDispatcher({ dispatched: true });
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      category: 'sentry-fix',
      workflow: 'auto-fix.yml',
      inputs: expect.objectContaining({
        task_type: 'fix-sentry-issue',
        sentry_issue_title: issue.title,
        sentry_issue_file: issue.metadata.filename,
        sentry_issue_line: String(issue.metadata.lineNo),
      }),
      dedupeId: `sentry-${issue.id}`,
    }));
  });

  it('sends a Slack notification when a fix is dispatched', async () => {
    const issue = makeSentryIssue();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([issue]),
    }));

    const dispatcher = makeDispatcher({ dispatched: true });
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Sentry'),
      message: expect.stringContaining(issue.title),
    }));
  });

  it('skips issues older than 24 hours', async () => {
    const issue = makeSentryIssue({ lastSeen: oldIso() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([issue]),
    }));

    const dispatcher = makeDispatcher();
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('returns early with warning when SENTRY_API_TOKEN is not set', async () => {
    delete process.env.SENTRY_API_TOKEN;
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = makeDispatcher();
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('SENTRY_API_TOKEN'));
  });

  it('returns early with warning when SENTRY_ORG is not set', async () => {
    delete process.env.SENTRY_ORG;
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = makeDispatcher();
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('SENTRY_ORG'));
  });

  it('routes to storscale-agents when culprit includes agent-api', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ([{
        id: 'routing-test',
        title: 'Error in agent-api',
        culprit: 'agent-api/src/routes/facilities.ts',
        status: 'unresolved',
        lastSeen: new Date().toISOString(),
        metadata: { filename: 'agent-api/src/routes/facilities.ts', lineNo: 42 },
      }]),
    });
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = makeDispatcher({ dispatched: true });
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'StorScale-AI/storscale-agents' })
    );
  });

  it('routes to storscale-website for non-agent-api culprits', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ([{
        id: 'routing-test-2',
        title: 'Error in dashboard',
        culprit: 'src/components/Dashboard.tsx',
        status: 'unresolved',
        lastSeen: new Date().toISOString(),
        metadata: { filename: 'src/components/Dashboard.tsx', lineNo: 10 },
      }]),
    });
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = makeDispatcher({ dispatched: true });
    const poller = createSentryPoller(dispatcher);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'StorScale-AI/storscale-website' })
    );
  });

  it('returns early without crashing when Sentry API returns non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }));

    const dispatcher = makeDispatcher();
    const poller = createSentryPoller(dispatcher);

    // Should not throw
    await poller();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('403'));
  });

  it('does not dispatch when dispatcher returns { dispatched: false } (dedup working)', async () => {
    const issue = makeSentryIssue();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([issue]),
    }));

    const dispatcher = makeDispatcher({ dispatched: false, reason: 'duplicate: sentry-abc123 already dispatched' });
    const poller = createSentryPoller(dispatcher);
    await poller();

    // dispatch was called but returned false — no Slack notification
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('handles fetch exceptions gracefully without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));

    const dispatcher = makeDispatcher();
    const poller = createSentryPoller(dispatcher);

    // Should not throw
    await poller();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Failed to fetch'), expect.any(Object));
  });
});
