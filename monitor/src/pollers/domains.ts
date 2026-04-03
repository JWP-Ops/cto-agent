import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';
import * as tls from 'node:tls';

const DOMAINS = [
  'storscale.ai',
  'app.storscale.ai',
  'storagenearme.store',
  'storscale-agents-api.onrender.com',
];

const WARN_DAYS = 30; // Alert if SSL expires within 30 days

async function checkSSL(domain: string): Promise<{ domain: string; valid: boolean; expiresAt?: string; daysLeft?: number; error?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect(443, domain, { servername: domain }, () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();

      if (!cert || !cert.valid_to) {
        resolve({ domain, valid: false, error: 'No certificate' });
        return;
      }

      const expiresAt = new Date(cert.valid_to);
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);

      resolve({
        domain,
        valid: daysLeft > 0,
        expiresAt: expiresAt.toISOString(),
        daysLeft,
      });
    });

    socket.on('error', (err) => {
      resolve({ domain, valid: false, error: err.message });
    });

    socket.setTimeout(10000, () => {
      socket.destroy();
      resolve({ domain, valid: false, error: 'Timeout' });
    });
  });
}

export async function pollDomains(): Promise<void> {
  const results = await Promise.allSettled(DOMAINS.map(checkSSL));

  const domainResults = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { domain: DOMAINS[i], valid: false, error: String(r.reason) };
  });

  const expiring = domainResults.filter(d =>
    d.valid && d.daysLeft !== undefined && d.daysLeft <= WARN_DAYS
  );
  const invalid = domainResults.filter(d => !d.valid);

  if (expiring.length > 0) {
    await alertPlatformIssue('SSL/Domains',
      `SSL expiring soon: ${expiring.map(d => `${d.domain} (${d.daysLeft}d)`).join(', ')}`
    );
  }

  if (invalid.length > 0) {
    await alertPlatformIssue('SSL/Domains',
      `SSL issues: ${invalid.map(d => `${d.domain} (${d.error})`).join(', ')}`
    );
  }

  recordHealth('domains', {
    status: invalid.length > 0 ? 'degraded' : expiring.length > 0 ? 'warning' : 'healthy',
    domains: domainResults,
    checked_at: new Date().toISOString(),
  });
}
