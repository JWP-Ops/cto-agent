import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { createSyntheticChecksPoller } from '../../monitor/src/pollers/synthetic-checks.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return {
    dispatch: vi.fn(() => Promise.resolve(result)),
  };
}

function mockFetch(responses: Array<{ ok: boolean; status?: number; json?: unknown; text?: string }>) {
  let callIndex = 0;
  vi.stubGlobal('fetch', vi.fn(() => {
    const r = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: () => Promise.resolve(r.json ?? {}),
      text: () => Promise.resolve(r.text ?? ''),
    });
  }));
}

describe('synthetic-checks poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends no alerts when all checks pass', async () => {
    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { report: 'some content here' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta name="x"><title>StorScale</title>' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('sends a warning alert on first consecutive failure', async () => {
    mockFetch([
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      severity: 'warning',
      title: expect.stringContaining('Synthetic Check Failed'),
    });
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('escalates to auto-fix after 2 consecutive failures of the same check', async () => {
    const failResponses = [
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ];
    mockFetch(failResponses);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);

    await poller(); // first failure — alert only
    await poller(); // second failure — escalate

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'e2e-fix',
        repo: 'JWP-Ops/cto-agent',
        workflow: 'auto-fix.yml',
        inputs: expect.objectContaining({
          repo: 'StorScale-AI/storscale-agents',
          task_type: 'fix-e2e-failure',
          e2e_test_file: expect.stringContaining('synthetic-check:api-health'),
        }),
      }),
    );
  });

  it('resets consecutive failure count when a check recovers', async () => {
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);

    mockFetch([
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    await poller();

    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    await poller();

    mockFetch([
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    await poller();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('detects intelligence-report shape failure', async () => {
    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { result: 'wrong key' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('intelligence-report'),
    });
  });

  it('detects empty facilities array as failure', async () => {
    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('facilities-list'),
    });
  });
});
