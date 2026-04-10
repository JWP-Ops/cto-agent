import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock everything that causes side effects on import
vi.mock('@hono/node-server', () => ({ serve: vi.fn() }));
vi.mock('../monitor/src/discovery.js', () => ({ discoverRepos: vi.fn(() => Promise.resolve([])) }));
vi.mock('../monitor/src/pollers/github.js', () => ({ pollGitHub: vi.fn(), loadSeenRuns: vi.fn() }));
vi.mock('../monitor/src/pollers/render.js', () => ({ pollRender: vi.fn() }));
vi.mock('../monitor/src/pollers/stripe.js', () => ({ pollStripe: vi.fn() }));
vi.mock('../monitor/src/pollers/supabase.js', () => ({ pollSupabase: vi.fn() }));
vi.mock('../monitor/src/pollers/vercel.js', () => ({ pollVercel: vi.fn() }));
vi.mock('../monitor/src/pollers/cloudflare.js', () => ({ pollCloudflare: vi.fn() }));
vi.mock('../monitor/src/pollers/agents.js', () => ({ pollAgentHealth: vi.fn() }));
vi.mock('../monitor/src/pollers/domains.js', () => ({ pollDomains: vi.fn() }));
vi.mock('../monitor/src/pollers/self-health.js', () => ({ pollSelfHealth: vi.fn() }));
vi.mock('../monitor/src/pollers/airtable.js', () => ({ pollAirtable: vi.fn() }));
vi.mock('../monitor/src/pollers/attio.js', () => ({ pollAttio: vi.fn() }));
vi.mock('../monitor/src/pollers/liveness.js', () => ({ pollLiveness: vi.fn() }));
vi.mock('../monitor/src/dispatch.js', () => ({ loadDispatchState: vi.fn() }));
vi.mock('../monitor/src/health-api.js', async () => {
  const { Hono } = await import('hono');
  return { healthRoutes: new Hono(), recordHealth: vi.fn() };
});
vi.mock('../monitor/src/lib/logger.js', () => ({ log: vi.fn(), setCorrelationId: vi.fn() }));
vi.mock('../monitor/src/lib/sentry.js', () => ({ initSentry: vi.fn() }));
vi.mock('../monitor/src/weekly-digest.js', () => ({ sendWeeklyDigest: vi.fn() }));

import { app } from '../monitor/src/index.js';

describe('CORS middleware', () => {
  it('allows requests from app.storscale.ai', async () => {
    const req = new Request('http://localhost/api/health/summary', {
      headers: { Origin: 'https://app.storscale.ai' },
    });
    const res = await app.fetch(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.storscale.ai');
  });

  it('allows requests from localhost dev server', async () => {
    const req = new Request('http://localhost/api/health/summary', {
      headers: { Origin: 'http://localhost:5173' },
    });
    const res = await app.fetch(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('does not set CORS header for unknown origins', async () => {
    const req = new Request('http://localhost/api/health/summary', {
      headers: { Origin: 'https://evil.example.com' },
    });
    const res = await app.fetch(req);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
