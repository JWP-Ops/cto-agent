import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { createRenderDeploysPoller } from '../../monitor/src/pollers/render-deploys.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return { dispatch: vi.fn(() => Promise.resolve(result)) };
}

/** URL-based fetch mock — deterministic even under Promise.allSettled parallelism */
function mockFetch(handler: (url: string) => { ok: boolean; json: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const { ok, json } = handler(String(url));
      return Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        json: () => Promise.resolve(json),
      });
    }),
  );
}

const SERVICES = [
  { service: { id: 'srv-aaa', name: 'storscale-agents', slug: 'storscale-agents', type: 'web_service' } },
];

const TWO_SERVICES = [
  { service: { id: 'srv-aaa', name: 'storscale-agents', slug: 'storscale-agents', type: 'web_service' } },
  { service: { id: 'srv-bbb', name: 'cto-agent-monitor', slug: 'cto-agent-monitor', type: 'web_service' } },
];

const LIVE_DEPLOY = [{ deploy: { id: 'dep-111', status: 'live', commit: { message: 'feat: live' } } }];
const FAILED_DEPLOY = [{ deploy: { id: 'dep-222', status: 'failed', commit: { message: 'feat: broke it' } } }];
const BUILD_FAILED_DEPLOY = [{ deploy: { id: 'dep-333', status: 'build_failed', commit: { message: 'feat: build error' } } }];

describe('render-deploys poller', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, RENDER_API_KEY: 'test-render-key' };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = OLD_ENV;
  });

  it('sends no alerts when all deploys are live', async () => {
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: LIVE_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(sendAlert).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('sends danger alert and dispatches auto-fix on failed deploy', async () => {
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      severity: 'danger',
      title: expect.stringContaining('storscale-agents'),
    });
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'e2e-fix',
        repo: 'JWP-Ops/cto-agent',
        inputs: expect.objectContaining({
          task_type: 'fix-deploy-failure',
          deploy_service: 'storscale-agents',
          deploy_id: 'dep-222',
        }),
      }),
    );
  });

  it('detects build_failed status', async () => {
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: BUILD_FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({ deploy_id: 'dep-333' }),
      }),
    );
  });

  it('does NOT re-alert the same deploy ID on the next poll', async () => {
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);

    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    await poller();
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Same dep-222 still the latest deploy
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    await poller();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('skips gracefully when RENDER_API_KEY is not set', async () => {
    delete process.env.RENDER_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(fetch).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('detects update_failed status', async () => {
    const UPDATE_FAILED_DEPLOY = [{ deploy: { id: 'dep-444', status: 'update_failed', commit: { message: 'feat: update broke' } } }];
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: UPDATE_FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({ deploy_id: 'dep-444' }),
      }),
    );
  });

  it('continues to other services when one deploy fetch fails (HTTP 500)', async () => {
    mockFetch((url) => {
      if (url.includes('/services?'))       return { ok: true, json: TWO_SERVICES };
      if (url.includes('srv-aaa/deploys'))  return { ok: false, json: [] };
      if (url.includes('srv-bbb/deploys'))  return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
  });
});
