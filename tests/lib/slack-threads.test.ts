import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let sendThreadedAlert: typeof import('../../monitor/src/lib/slack-threads.js').sendThreadedAlert;
let getOpenThreadCount: typeof import('../../monitor/src/lib/slack-threads.js').getOpenThreadCount;
let evictStaleThreads: typeof import('../../monitor/src/lib/slack-threads.js').evictStaleThreads;
let optionalEnvMock: ReturnType<typeof vi.fn>;
let sendAlertMock: ReturnType<typeof vi.fn>;

describe('slack-threads', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();

    vi.doMock('../../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn(),
    }));
    vi.doMock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
    vi.doMock('../../monitor/src/slack.js', () => ({
      sendAlert: vi.fn().mockResolvedValue(true),
      SEVERITY_COLORS: { success: '#36a64f', warning: '#daa038', danger: '#cc0000' },
    }));

    const envMod = await import('../../monitor/src/lib/env.js');
    optionalEnvMock = envMod.optionalEnv as ReturnType<typeof vi.fn>;

    const slackMod = await import('../../monitor/src/slack.js');
    sendAlertMock = slackMod.sendAlert as ReturnType<typeof vi.fn>;

    const mod = await import('../../monitor/src/lib/slack-threads.js');
    sendThreadedAlert = mod.sendThreadedAlert;
    getOpenThreadCount = mod.getOpenThreadCount;
    evictStaleThreads = mod.evictStaleThreads;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to sendAlert when SLACK_BOT_TOKEN is not set', async () => {
    optionalEnvMock.mockReturnValue('');

    const result = await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'CI Failed',
      message: 'Build broken',
    });

    expect(sendAlertMock).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('falls back to sendAlert when SLACK_CHANNEL_ID is not set', async () => {
    optionalEnvMock.mockImplementation((key: string) =>
      key === 'SLACK_BOT_TOKEN' ? 'xoxb-token' : ''
    );

    await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'CI Failed',
      message: 'Build broken',
    });

    expect(sendAlertMock).toHaveBeenCalledOnce();
  });

  it('creates a new thread when no existing fingerprint', async () => {
    optionalEnvMock.mockImplementation((key: string) => {
      if (key === 'SLACK_BOT_TOKEN') return 'xoxb-test';
      if (key === 'SLACK_CHANNEL_ID') return 'C12345';
      return '';
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, ts: '1234567890.000100' }),
    }));

    const result = await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'CI Failed',
      message: 'Build broken',
    });

    expect(result).toBe(true);
    expect(getOpenThreadCount()).toBe(1);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.thread_ts).toBeUndefined();
    expect(body.channel).toBe('C12345');
  });

  it('appends to existing thread when fingerprint exists and is < 24h old', async () => {
    optionalEnvMock.mockImplementation((key: string) => {
      if (key === 'SLACK_BOT_TOKEN') return 'xoxb-test';
      if (key === 'SLACK_CHANNEL_ID') return 'C12345';
      return '';
    });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, ts: '1234567890.000100' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, ts: '1234567890.000200' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    // First call — creates thread
    await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'CI Failed',
      message: 'First failure',
    });

    // Second call — should append to thread
    await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'CI Failed Again',
      message: 'Still broken',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(secondCallBody.thread_ts).toBe('1234567890.000100');
  });

  it('creates new thread when existing thread is > 24h old', async () => {
    optionalEnvMock.mockImplementation((key: string) => {
      if (key === 'SLACK_BOT_TOKEN') return 'xoxb-test';
      if (key === 'SLACK_CHANNEL_ID') return 'C12345';
      return '';
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, ts: '9999999999.000100' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // First call
    await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'Old Failure',
      message: 'From yesterday',
    });

    // Advance time by 25 hours
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    // Second call — should start fresh thread
    await sendThreadedAlert('ci-failure:agents', {
      severity: 'danger',
      title: 'New Failure',
      message: 'New day, new pain',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(secondCallBody.thread_ts).toBeUndefined();
  });

  it('evictStaleThreads removes threads older than 24h', async () => {
    optionalEnvMock.mockImplementation((key: string) => {
      if (key === 'SLACK_BOT_TOKEN') return 'xoxb-test';
      if (key === 'SLACK_CHANNEL_ID') return 'C12345';
      return '';
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, ts: '1111111111.000100' }),
    }));

    await sendThreadedAlert('incident:render', {
      severity: 'warning',
      title: 'Render Down',
      message: 'Service crashed',
    });

    expect(getOpenThreadCount()).toBe(1);

    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    evictStaleThreads();

    expect(getOpenThreadCount()).toBe(0);
  });
});
