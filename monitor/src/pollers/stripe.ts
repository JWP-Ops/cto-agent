import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

export async function pollStripe(): Promise<void> {
  const secretKey = optionalEnv('STRIPE_SECRET_KEY');
  if (!secretKey) {
    log('debug', 'Stripe poller skipped — no STRIPE_SECRET_KEY');
    return;
  }

  const endpointId = optionalEnv('STRIPE_WEBHOOK_ENDPOINT_ID');
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  try {
    // Check webhook endpoint status if configured
    let webhookStatus = 'unknown';
    if (endpointId) {
      const res = await fetch(`https://api.stripe.com/v1/webhook_endpoints/${endpointId}`, { headers });
      if (res.ok) {
        const endpoint = await res.json() as { status?: string };
        webhookStatus = endpoint.status || 'active';
        if (endpoint.status === 'disabled') {
          await alertPlatformIssue('Stripe', `Webhook endpoint *${endpointId}* is disabled!`);
        }
      } else {
        log('warn', `Stripe webhook check failed: ${res.status}`);
      }
    }

    // Check for recent webhook failures (disabled events in last 24h)
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const eventsRes = await fetch(
      `https://api.stripe.com/v1/events?type=webhook_endpoint.disabled&created[gte]=${oneDayAgo}&limit=5`,
      { headers }
    );

    let recentDisables = 0;
    if (eventsRes.ok) {
      const events = await eventsRes.json() as { data?: Array<unknown> };
      recentDisables = events.data?.length || 0;
      if (recentDisables > 0) {
        await alertPlatformIssue('Stripe', `${recentDisables} webhook endpoint disable event(s) in last 24h`);
      }
    }

    recordHealth('stripe', {
      status: webhookStatus === 'disabled' || recentDisables > 0 ? 'degraded' : 'healthy',
      webhook_status: webhookStatus,
      recent_disables: recentDisables,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    log('error', `Stripe poller error: ${e}`);
    recordHealth('stripe', {
      status: 'error',
      error: String(e),
      checked_at: new Date().toISOString(),
    });
  }
}
