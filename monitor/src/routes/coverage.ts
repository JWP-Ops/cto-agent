import type { Hono } from 'hono';
import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

export interface CoverageEntry {
  file: string;
  linePct: number;
}

interface CoveragePayload {
  repo: string;
  coverage: CoverageEntry[];
}

const COVERAGE_THRESHOLD = 80;

export function coverageRoutes(app: Hono, dispatcher: Dispatcher): void {
  app.post('/api/coverage-gaps', async (c) => {
    const apiKey = optionalEnv('CTO_API_KEY');
    if (apiKey) {
      const auth = c.req.header('Authorization') ?? '';
      if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    let body: CoveragePayload;
    try {
      body = await c.req.json<CoveragePayload>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.repo || !Array.isArray(body.coverage)) {
      return c.json({ error: 'Missing required fields: repo, coverage' }, 400);
    }

    const uncovered = body.coverage
      .filter((e) => e.linePct < COVERAGE_THRESHOLD)
      .sort((a, b) => a.linePct - b.linePct)
      .slice(0, 3);

    if (uncovered.length === 0) {
      log('info', `Coverage gap check: all files above ${COVERAGE_THRESHOLD}% threshold`, {
        repo: body.repo,
      });
      return c.json({ dispatched: 0, message: `All files above ${COVERAGE_THRESHOLD}% coverage threshold` });
    }

    let dispatched = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const entry of uncovered) {
      const result = await dispatcher.dispatch({
        category: 'test-gen',
        repo: 'JWP-Ops/cto-agent',
        workflow: 'auto-fix.yml',
        inputs: {
          repo: body.repo,
          run_id: '0',
          workflow_name: 'test-gap-detection',
          task_type: 'generate-tests',
          uncovered_file: entry.file,
          coverage_pct: String(Math.round(entry.linePct)),
        },
        dedupeId: `test-gen-${body.repo}-${entry.file}-${today}`,
      });

      if (result.dispatched) {
        dispatched++;
        log('info', 'Dispatched generate-tests', {
          repo: body.repo,
          file: entry.file,
          linePct: entry.linePct,
        });
      }
    }

    if (dispatched > 0) {
      await sendAlert({
        severity: 'warning',
        title: 'CTO Agent: Test Gap Detection',
        message: `*Repo:* ${body.repo}\nDispatched ${dispatched} test-generation job(s).\n*Files:* ${uncovered.map((e) => `${e.file} (${e.linePct}%)`).join(', ')}`,
      });
    }

    return c.json({ dispatched, files: uncovered.map((e) => e.file) });
  });
}
