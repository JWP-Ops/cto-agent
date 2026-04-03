import { Hono } from 'hono';

type HealthStatus = 'healthy' | 'degraded' | 'warning' | 'error' | 'unknown';

interface HealthRecord {
  platform: string;
  status: HealthStatus;
  details: Record<string, unknown>;
  checked_at: string;
}

// In-memory health state (most recent snapshot per platform)
const healthState = new Map<string, HealthRecord>();

/**
 * Record a health check result. Called by each poller.
 */
export function recordHealth(platform: string, data: Record<string, unknown>) {
  healthState.set(platform, {
    platform,
    status: (data.status as HealthStatus) || 'unknown',
    details: data,
    checked_at: (data.checked_at as string) || new Date().toISOString(),
  });
}

/**
 * Get current health state for a platform.
 */
export function getHealth(platform: string): HealthRecord | undefined {
  return healthState.get(platform);
}

/**
 * Get all health records.
 */
export function getAllHealth(): HealthRecord[] {
  return Array.from(healthState.values());
}

// REST API routes (mounted at /api)
export const healthRoutes = new Hono();

// GET /api/health/summary — all platforms at a glance
healthRoutes.get('/health/summary', (c) => {
  const records = getAllHealth();
  const overallStatus = records.some(r => r.status === 'error')
    ? 'error'
    : records.some(r => r.status === 'degraded')
      ? 'degraded'
      : records.some(r => r.status === 'warning')
        ? 'warning'
        : 'healthy';

  return c.json({
    status: overallStatus,
    platforms: records.map(r => ({
      platform: r.platform,
      status: r.status,
      checked_at: r.checked_at,
    })),
    checked_at: new Date().toISOString(),
  });
});

// GET /api/health/:platform — detailed health for one platform
healthRoutes.get('/health/:platform', (c) => {
  const platform = c.req.param('platform');
  const record = getHealth(platform);
  if (!record) {
    return c.json({ error: `No health data for platform: ${platform}` }, 404);
  }
  return c.json(record);
});

// GET /api/health/platforms — list all monitored platforms
healthRoutes.get('/health/platforms', (c) => {
  return c.json({
    platforms: [
      'github', 'render', 'stripe', 'supabase',
      'vercel', 'cloudflare', 'agents', 'domains',
    ],
  });
});
