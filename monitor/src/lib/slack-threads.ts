import { optionalEnv } from './env.js';
import { log } from './logger.js';
import { sendAlert } from '../slack.js';

type AlertSeverity = 'success' | 'warning' | 'danger';

export interface ThreadedAlert {
  severity: AlertSeverity;
  title: string;
  message: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
}

interface ThreadRecord {
  channelId: string;
  threadTs: string;
  lastUpdatedAt: number;
}

const THREAD_TTL_MS = 24 * 60 * 60 * 1000;
const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  success: '#36a64f',
  warning: '#daa038',
  danger: '#cc0000',
};

const threads = new Map<string, ThreadRecord>();

export function evictStaleThreads(): void {
  const cutoff = Date.now() - THREAD_TTL_MS;
  for (const [fingerprint, record] of threads) {
    if (record.lastUpdatedAt < cutoff) {
      threads.delete(fingerprint);
    }
  }
}

export function getOpenThreadCount(): number {
  evictStaleThreads();
  return threads.size;
}

/**
 * Send an alert, threading related alerts together by fingerprint.
 * Fingerprint format: "<type>:<service>" e.g. "ci-failure:storscale-agents"
 *
 * Falls back to webhook sendAlert() when SLACK_BOT_TOKEN or SLACK_CHANNEL_ID
 * is not set — safe to use without configuring the Bot Token.
 */
export async function sendThreadedAlert(
  fingerprint: string,
  alert: ThreadedAlert,
): Promise<boolean> {
  const botToken = optionalEnv('SLACK_BOT_TOKEN');
  const channelId = optionalEnv('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    log('warn', `Slack Bot Token/Channel not configured — falling back to webhook: ${alert.title}`);
    return sendAlert({ ...alert });
  }

  const record = threads.get(fingerprint);
  const isActive = record !== undefined && (Date.now() - record.lastUpdatedAt) < THREAD_TTL_MS;

  if (isActive) {
    const ok = await postMessage(botToken, channelId, alert, record.threadTs);
    if (ok) record.lastUpdatedAt = Date.now();
    return ok;
  }

  const ts = await openThread(botToken, channelId, alert);
  if (ts) {
    threads.set(fingerprint, { channelId, threadTs: ts, lastUpdatedAt: Date.now() });
    return true;
  }
  return false;
}

async function openThread(
  token: string,
  channel: string,
  alert: ThreadedAlert,
): Promise<string | null> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        attachments: [buildAttachment(alert)],
      }),
    });

    const data = await res.json() as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) {
      log('error', `Slack openThread failed: ${data.error ?? 'unknown'}`);
      return null;
    }
    return data.ts ?? null;
  } catch (e) {
    log('error', `Slack openThread error: ${e}`);
    return null;
  }
}

async function postMessage(
  token: string,
  channel: string,
  alert: ThreadedAlert,
  threadTs: string,
): Promise<boolean> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs,
        attachments: [buildAttachment(alert)],
      }),
    });

    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      log('error', `Slack postMessage failed: ${data.error ?? 'unknown'}`);
      return false;
    }
    return true;
  } catch (e) {
    log('error', `Slack postMessage error: ${e}`);
    return false;
  }
}

function buildAttachment(alert: ThreadedAlert): Record<string, unknown> {
  const attachment: Record<string, unknown> = {
    color: SEVERITY_COLORS[alert.severity],
    title: alert.title,
    text: alert.message,
    ts: Math.floor(Date.now() / 1000),
  };

  if (alert.fields) {
    attachment.fields = alert.fields.map(f => ({
      title: f.title,
      value: f.value,
      short: f.short ?? true,
    }));
  }

  return attachment;
}
