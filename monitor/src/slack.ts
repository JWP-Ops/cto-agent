import { optionalEnv } from './lib/env.js';
import { log } from './lib/logger.js';

type AlertSeverity = 'success' | 'warning' | 'danger';

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  success: '#36a64f',
  warning: '#daa038',
  danger: '#cc0000',
};

interface SlackAlert {
  severity: AlertSeverity;
  title: string;
  message: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  link?: { url: string; text: string };
}

export async function sendAlert(alert: SlackAlert): Promise<boolean> {
  const webhookUrl = optionalEnv('SLACK_WEBHOOK_URL');
  if (!webhookUrl) {
    log('warn', `Slack alert skipped (no webhook): ${alert.title}`);
    return false;
  }

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

  if (alert.link) {
    attachment.actions = [{
      type: 'button',
      text: alert.link.text,
      url: alert.link.url,
    }];
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments: [attachment] }),
    });

    if (!res.ok) {
      log('error', `Slack alert failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    log('error', `Slack alert error: ${e}`);
    return false;
  }
}

// Convenience methods
export const alertFixApplied = (repo: string, commit: string, pattern: string) =>
  sendAlert({
    severity: 'success',
    title: `CTO Agent: Fix Applied`,
    message: `Auto-fixed CI failure in *${repo}*`,
    fields: [
      { title: 'Commit', value: `\`${commit.slice(0, 7)}\`` },
      { title: 'Pattern', value: pattern },
    ],
  });

export const alertEscalation = (repo: string, reason: string, runUrl?: string) =>
  sendAlert({
    severity: 'danger',
    title: `CTO Agent: Escalation`,
    message: `Cannot auto-fix *${repo}*\n${reason}`,
    link: runUrl ? { url: runUrl, text: 'View Failure' } : undefined,
  });

export const alertPlatformIssue = (platform: string, message: string) =>
  sendAlert({
    severity: 'warning',
    title: `CTO Agent: ${platform} Issue`,
    message,
  });
