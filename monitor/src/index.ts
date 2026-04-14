import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { discoverRepos } from './discovery.js';
import { pollGitHub, loadSeenRuns } from './pollers/github.js';
import { pollRender } from './pollers/render.js';
import { pollStripe } from './pollers/stripe.js';
import { pollSupabase } from './pollers/supabase.js';
import { pollVercel } from './pollers/vercel.js';
import { pollCloudflare } from './pollers/cloudflare.js';
import { pollAgentHealth } from './pollers/agents.js';
import { pollDomains } from './pollers/domains.js';
import { pollSelfHealth } from './pollers/self-health.js';
import { pollAirtable } from './pollers/airtable.js';
import { pollAttio } from './pollers/attio.js';
import { pollLiveness } from './pollers/liveness.js';
import { createSentryPoller } from './pollers/sentry.js';
import { healthRoutes } from './health-api.js';
import { loadDispatchState } from './dispatch.js';
import { Dispatcher } from './lib/dispatch-v2.js';
import { log, setCorrelationId } from './lib/logger.js';
import { initSentry } from './lib/sentry.js';
import { sendWeeklyDigest } from './weekly-digest.js';
import { registerPoller } from './lib/register-poller.js';

const app = new Hono();

app.use('/api/*', cors({
  origin: ['https://app.storscale.ai', 'http://localhost:5173'],
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'cto-agent-monitor', uptime: process.uptime() }));

// Health API routes (consumed by Cockpit dashboard)
app.route('/api', healthRoutes);

// State
let repos: string[] = [];
const POLL_INTERVALS = {
  discovery: 60 * 60 * 1000,  // 1 hour — refresh repo list
  render: 2 * 60 * 1000,       // 2 min
  github: 5 * 60 * 1000,       // 5 min
  stripe: 5 * 60 * 1000,       // 5 min
  supabase: 5 * 60 * 1000,     // 5 min
  vercel: 5 * 60 * 1000,       // 5 min
  cloudflare: 5 * 60 * 1000,   // 5 min
  agents: 10 * 60 * 1000,      // 10 min
  selfHealth: 15 * 60 * 1000,   // 15 min — CTO agent self-monitoring
  domains: 24 * 60 * 60 * 1000, // daily
  airtable: 5 * 60 * 1000,      // 5 min
  attio: 5 * 60 * 1000,          // 5 min
  liveness: 2 * 60 * 1000,       // 2 min
  sentry: 10 * 60 * 1000,        // 10 min
};

// T4.30: Track intervals for graceful shutdown
const intervalIds: NodeJS.Timeout[] = [];

async function startPollers() {
  // T4.28: Initialize Sentry error reporting (no-op if SENTRY_DSN not set)
  initSentry();

  log('info', 'Starting CTO Agent Monitor');

  // Dispatcher instance shared by v2 pollers (rate-limited, dedup-aware)
  const dispatcher = new Dispatcher();

  // T2.10: Load persisted state from Supabase before polling
  await Promise.allSettled([
    loadDispatchState(),
    loadSeenRuns(),
  ]);

  // Initial repo discovery
  repos = await discoverRepos();
  log('info', `Discovered ${repos.length} repos`);

  // Sentry poller instance (needs dispatcher)
  const sentryPoller = createSentryPoller(dispatcher);

  // GitHub CI poller
  intervalIds.push(registerPoller('github', () => {
    setCorrelationId();
    return pollGitHub(repos);
  }, POLL_INTERVALS.github));

  // Render deploy poller
  intervalIds.push(registerPoller('render', () => {
    setCorrelationId();
    return pollRender();
  }, POLL_INTERVALS.render));

  // Stripe webhook poller
  intervalIds.push(registerPoller('stripe', () => {
    setCorrelationId();
    return pollStripe();
  }, POLL_INTERVALS.stripe));

  // Supabase health poller
  intervalIds.push(registerPoller('supabase', () => {
    setCorrelationId();
    return pollSupabase();
  }, POLL_INTERVALS.supabase));

  // Vercel deploy poller
  intervalIds.push(registerPoller('vercel', () => {
    setCorrelationId();
    return pollVercel();
  }, POLL_INTERVALS.vercel));

  // Cloudflare Workers poller
  intervalIds.push(registerPoller('cloudflare', () => {
    setCorrelationId();
    return pollCloudflare();
  }, POLL_INTERVALS.cloudflare));

  // Agent health poller
  intervalIds.push(registerPoller('agents', () => {
    setCorrelationId();
    return pollAgentHealth();
  }, POLL_INTERVALS.agents));

  // Domain/SSL expiry poller
  intervalIds.push(registerPoller('domains', () => {
    setCorrelationId();
    return pollDomains();
  }, POLL_INTERVALS.domains));

  // Self-health poller — the CTO agent monitors itself
  intervalIds.push(registerPoller('self-health', () => {
    setCorrelationId();
    return pollSelfHealth(repos);
  }, POLL_INTERVALS.selfHealth));

  // Airtable health poller
  intervalIds.push(registerPoller('airtable', () => {
    setCorrelationId();
    return pollAirtable();
  }, POLL_INTERVALS.airtable));

  // Attio CRM health poller
  intervalIds.push(registerPoller('attio', () => {
    setCorrelationId();
    return pollAttio();
  }, POLL_INTERVALS.attio));

  // Liveness probe poller
  intervalIds.push(registerPoller('liveness', () => {
    setCorrelationId();
    return pollLiveness();
  }, POLL_INTERVALS.liveness));

  // Sentry issue poller — dispatches auto-fix for unresolved production errors
  intervalIds.push(registerPoller('sentry', () => {
    setCorrelationId();
    return sentryPoller();
  }, POLL_INTERVALS.sentry));

  // Repo discovery refresh
  intervalIds.push(registerPoller('discovery', async () => {
    setCorrelationId();
    repos = await discoverRepos();
    log('info', `Refreshed repo list: ${repos.length} repos`);
  }, POLL_INTERVALS.discovery));

  // T4.26: Weekly digest — sends Slack summary every 7 days
  intervalIds.push(registerPoller('weekly-digest', () => {
    setCorrelationId();
    return sendWeeklyDigest();
  }, 7 * 24 * 60 * 60 * 1000));

  log('info', 'All pollers initialized');

  // T1.6: External dead man's switch — ping every 5 min
  // Configure HEALTHCHECK_PING_URL with Healthchecks.io, BetterStack, or UptimeRobot
  const pingUrl = process.env.HEALTHCHECK_PING_URL;
  if (pingUrl) {
    intervalIds.push(registerPoller('dead-mans-switch', async () => {
      try { await fetch(pingUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) }); }
      catch { log('warn', 'Dead man switch ping failed'); }
    }, 5 * 60 * 1000));
    log('info', 'External dead man switch configured');
  } else {
    log('warn', 'No HEALTHCHECK_PING_URL set — dead man switch disabled. Set up at healthchecks.io or betterstack.com');
  }
}

// T4.30: Graceful shutdown handler
let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return; // Prevent double-shutdown
  shuttingDown = true;
  log('info', `Received ${signal} — shutting down gracefully`);

  // Clear all polling intervals
  for (const id of intervalIds) clearInterval(id);
  intervalIds.length = 0;

  // Allow 5s for in-flight requests to complete
  setTimeout(() => {
    log('info', 'Shutdown complete');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const port = parseInt(process.env.PORT || '3002', 10);
serve({ fetch: app.fetch, port }, () => {
  log('info', `CTO Agent Monitor running on port ${port}`);
  startPollers();
});

export { app };
