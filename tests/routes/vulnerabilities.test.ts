import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { Hono } from 'hono';
import { vulnerabilityRoutes } from '../../monitor/src/routes/vulnerabilities.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return { dispatch: vi.fn(() => Promise.resolve(result)) };
}

function makeApp(dispatcher = makeDispatcher()) {
  const app = new Hono();
  vulnerabilityRoutes(app, dispatcher as never);
  return { app, dispatcher };
}

async function post(app: Hono, body: unknown, apiKey = 'test-key') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return app.request('/api/vulnerabilities', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const CRITICAL_VULN = {
  cveId: 'GHSA-xxxx-yyyy-zzzz',
  packageName: 'lodash',
  currentVersion: '4.17.20',
  fixedVersion: '4.17.21',
  severity: 'critical',
  title: 'Prototype Pollution in lodash',
};

const HIGH_VULN = {
  cveId: 'CVE-2021-99999',
  packageName: 'axios',
  currentVersion: '0.21.0',
  fixedVersion: '0.21.2',
  severity: 'high',
  title: 'SSRF vulnerability in axios',
};

const MODERATE_VULN = {
  cveId: 'CVE-2021-00001',
  packageName: 'minimist',
  currentVersion: '1.2.0',
  fixedVersion: '1.2.6',
  severity: 'moderate',
  title: 'Prototype Pollution in minimist',
};

describe('POST /api/vulnerabilities', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, CTO_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns 401 when API key is missing', async () => {
    const { app } = makeApp();
    const res = await post(app, {}, '');
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is missing required fields', async () => {
    const { app } = makeApp();
    const res = await post(app, { repo: 'StorScale-AI/storscale-agents' });
    expect(res.status).toBe(400);
  });

  it('dispatches dep-patch for critical and high CVEs', async () => {
    const { app, dispatcher } = makeApp();
    const res = await post(app, {
      repo: 'StorScale-AI/storscale-agents',
      vulnerabilities: [CRITICAL_VULN, HIGH_VULN],
    });

    expect(res.status).toBe(200);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'dep-patch',
        inputs: expect.objectContaining({
          task_type: 'dep-patch',
          vulnerable_package: 'lodash',
          fixed_version: '4.17.21',
          severity: 'critical',
          cve_id: 'GHSA-xxxx-yyyy-zzzz',
        }),
      }),
    );
  });

  it('skips moderate, low, and info CVEs', async () => {
    const { app, dispatcher } = makeApp();
    const res = await post(app, {
      repo: 'StorScale-AI/storscale-agents',
      vulnerabilities: [MODERATE_VULN],
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { dispatched: number };
    expect(json.dispatched).toBe(0);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('caps at 3 dispatches even when many CVEs are actionable', async () => {
    const { app, dispatcher } = makeApp();
    const manyVulns = Array.from({ length: 6 }, (_, i) => ({
      ...CRITICAL_VULN,
      cveId: `GHSA-${i}`,
      packageName: `pkg-${i}`,
    }));

    const res = await post(app, {
      repo: 'StorScale-AI/storscale-agents',
      vulnerabilities: manyVulns,
    });

    expect(res.status).toBe(200);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it('sends a Slack warning alert summarising dispatched jobs', async () => {
    const { app } = makeApp();
    await post(app, {
      repo: 'StorScale-AI/storscale-agents',
      vulnerabilities: [CRITICAL_VULN],
    });

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      severity: 'warning',
      title: expect.stringContaining('Vulnerability'),
    });
  });

  it('does NOT send a Slack alert when all CVEs are below threshold', async () => {
    const { app } = makeApp();
    await post(app, {
      repo: 'StorScale-AI/storscale-agents',
      vulnerabilities: [MODERATE_VULN],
    });

    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('deduplicates via the Dispatcher when the same CVE is posted twice', async () => {
    const { app, dispatcher } = makeApp();

    vi.mocked(dispatcher.dispatch)
      .mockResolvedValueOnce({ dispatched: true })
      .mockResolvedValueOnce({ dispatched: false, reason: 'duplicate: dep-patch-...' });

    const payload = {
      repo: 'StorScale-AI/storscale-agents',
      vulnerabilities: [CRITICAL_VULN],
    };

    const res1 = await post(app, payload);
    const res2 = await post(app, payload);

    const j1 = (await res1.json()) as { dispatched: number };
    const j2 = (await res2.json()) as { dispatched: number };

    expect(j1.dispatched).toBe(1);
    expect(j2.dispatched).toBe(0);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });
});
