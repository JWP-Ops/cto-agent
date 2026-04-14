import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { Hono } from 'hono';
import { coverageRoutes } from '../../monitor/src/routes/coverage.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return {
    dispatch: vi.fn(() => Promise.resolve(result)),
  };
}

function makeApp(dispatcher = makeDispatcher()) {
  const app = new Hono();
  coverageRoutes(app, dispatcher as never);
  return { app, dispatcher };
}

async function post(app: Hono, body: unknown, apiKey = 'test-key') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return app.request('/api/coverage-gaps', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/coverage-gaps', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, CTO_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns 401 when API key missing', async () => {
    const { app } = makeApp();
    const res = await post(app, {}, '');
    expect(res.status).toBe(401);
  });

  it('dispatches generate-tests for top 3 lowest-coverage files', async () => {
    const { app, dispatcher } = makeApp();
    const payload = {
      repo: 'StorScale-AI/storscale-agents',
      coverage: [
        { file: 'src/a.ts', linePct: 0 },
        { file: 'src/b.ts', linePct: 10 },
        { file: 'src/c.ts', linePct: 20 },
        { file: 'src/d.ts', linePct: 30 },
        { file: 'src/e.ts', linePct: 90 },
      ],
    };

    const res = await post(app, payload);
    expect(res.status).toBe(200);

    const json = await res.json() as { dispatched: number; files: string[] };
    expect(json.dispatched).toBe(3);
    expect(json.files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'test-gen',
        repo: 'JWP-Ops/cto-agent',
        workflow: 'auto-fix.yml',
        inputs: expect.objectContaining({
          repo: 'StorScale-AI/storscale-agents',
          task_type: 'generate-tests',
          uncovered_file: 'src/a.ts',
        }),
      }),
    );
  });

  it('skips files above 80% coverage threshold', async () => {
    const { app, dispatcher } = makeApp();
    const payload = {
      repo: 'StorScale-AI/storscale-agents',
      coverage: [
        { file: 'src/covered.ts', linePct: 85 },
        { file: 'src/also-covered.ts', linePct: 95 },
      ],
    };

    const res = await post(app, payload);
    expect(res.status).toBe(200);

    const json = await res.json() as { dispatched: number };
    expect(json.dispatched).toBe(0);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches at most 3 files even when many are below threshold', async () => {
    const { app, dispatcher } = makeApp();
    const coverage = Array.from({ length: 10 }, (_, i) => ({
      file: `src/file${i}.ts`,
      linePct: i * 5,
    }));

    const res = await post(app, { repo: 'StorScale-AI/storscale-agents', coverage });
    expect(res.status).toBe(200);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it('sends a Slack alert summarising dispatched jobs', async () => {
    const { app } = makeApp();
    await post(app, {
      repo: 'StorScale-AI/storscale-agents',
      coverage: [{ file: 'src/gap.ts', linePct: 0 }],
    });

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('Test Gap Detection'),
    });
  });

  it('deduplicates dispatches for the same file on the same day', async () => {
    const { app, dispatcher } = makeApp();
    const payload = {
      repo: 'StorScale-AI/storscale-agents',
      coverage: [{ file: 'src/gap.ts', linePct: 0 }],
    };

    vi.mocked(dispatcher.dispatch)
      .mockResolvedValueOnce({ dispatched: true })
      .mockResolvedValueOnce({ dispatched: false, reason: 'duplicate: test-gen-...' });

    const res1 = await post(app, payload);
    const res2 = await post(app, payload);

    const j1 = await res1.json() as { dispatched: number };
    const j2 = await res2.json() as { dispatched: number };

    expect(j1.dispatched).toBe(1);
    expect(j2.dispatched).toBe(0);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });
});
