import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
vi.mock('../monitor/src/slack.js', () => ({ sendAlert: vi.fn().mockResolvedValue(true) }));
vi.mock('../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn((key: string) => {
    if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-key';
    return '';
  }),
}));
vi.mock('../monitor/src/cost-tracker.js', () => ({
  getWeeklyCostByCategory: vi.fn(() => new Map([['ci-fix', 2.5], ['sentry-fix', 1.0]])),
  getWeeklyTotalCost: vi.fn(() => 3.5),
}));

let sendWeeklyDigest: typeof import('../monitor/src/weekly-digest.js').sendWeeklyDigest;
let sendAlertMock: ReturnType<typeof vi.fn>;

describe('sendWeeklyDigest', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();

    vi.doMock('../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
    vi.doMock('../monitor/src/slack.js', () => ({
      sendAlert: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock('../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-key';
        return '';
      }),
    }));
    vi.doMock('../monitor/src/cost-tracker.js', () => ({
      getWeeklyCostByCategory: vi.fn(() => new Map([['ci-fix', 2.5], ['sentry-fix', 1.0]])),
      getWeeklyTotalCost: vi.fn(() => 3.5),
    }));

    const slackMod = await import('../monitor/src/slack.js');
    sendAlertMock = slackMod.sendAlert as ReturnType<typeof vi.fn>;

    const mod = await import('../monitor/src/weekly-digest.js');
    sendWeeklyDigest = mod.sendWeeklyDigest;
  });

  it('includes "Fixed automatically" section in digest message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { repo: 'storscale-agents', failure_type: 'ci', pattern_matched: 'broken-require', fix_applied: true, escalated: false, resolved_at: new Date().toISOString() },
        { repo: 'storscale-agents', failure_type: 'synthetic-check', pattern_matched: null, fix_applied: false, escalated: false, resolved_at: null },
      ]),
    }));

    await sendWeeklyDigest();

    expect(sendAlertMock).toHaveBeenCalledOnce();
    const message: string = sendAlertMock.mock.calls[0][0].message;
    expect(message).toContain('Fixed automatically');
    expect(message).toContain('1');
  });

  it('includes "Caught before users" section for synthetic-check and e2e incidents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { repo: 'agent-api', failure_type: 'synthetic-check', pattern_matched: null, fix_applied: false, escalated: false, resolved_at: null },
        { repo: 'storscale-dashboard', failure_type: 'e2e', pattern_matched: null, fix_applied: false, escalated: false, resolved_at: null },
        { repo: 'storscale-agents', failure_type: 'ci', pattern_matched: 'console-leak', fix_applied: true, escalated: false, resolved_at: new Date().toISOString() },
      ]),
    }));

    await sendWeeklyDigest();

    const message: string = sendAlertMock.mock.calls[0][0].message;
    expect(message).toContain('Caught before users');
    expect(message).toContain('2');
  });

  it('includes cost breakdown section with per-category spend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    await sendWeeklyDigest();

    const message: string = sendAlertMock.mock.calls[0][0].message;
    expect(message).toContain('Claude Code cost');
    expect(message).toContain('$3.50');
    expect(message).toContain('ci-fix');
    expect(message).toContain('$2.50');
  });

  it('skips digest when Supabase credentials are missing', async () => {
    vi.resetModules();
    vi.doMock('../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn(() => ''),
    }));
    vi.doMock('../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
    vi.doMock('../monitor/src/slack.js', () => ({ sendAlert: vi.fn() }));
    vi.doMock('../monitor/src/cost-tracker.js', () => ({
      getWeeklyCostByCategory: vi.fn(() => new Map()),
      getWeeklyTotalCost: vi.fn(() => 0),
    }));

    const slackModLocal = await import('../monitor/src/slack.js');
    const localSendAlert = slackModLocal.sendAlert as ReturnType<typeof vi.fn>;
    const mod = await import('../monitor/src/weekly-digest.js');

    await mod.sendWeeklyDigest();

    expect(localSendAlert).not.toHaveBeenCalled();
  });
});
