# CTO Agent M2 — Proactive Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three proactive testing capabilities to the CTO agent: hourly Playwright E2E cron, deep synthetic API checks with consecutive-failure escalation, and daily test gap detection with auto-dispatch.

**Architecture:** E2E cron and test-gap-detection are GitHub Actions workflows in JWP-Ops/cto-agent. Synthetic checks run as a new poller inside the Hono monitor (Render). Coverage gaps POST to a new `/api/coverage-gaps` endpoint on the monitor, which uses the existing Dispatcher to dispatch `generate-tests` fixes. Dispatch for synthetic-checks poller goes to `JWP-Ops/cto-agent` via `workflow_dispatch` (requires adding that trigger to auto-fix.yml). E2E cron uses intra-repo `workflow_call` directly.

**Tech Stack:** TypeScript strict mode, Hono, Vitest, GitHub Actions, existing `Dispatcher` + `registerPoller` from M1.

---

## Prerequisites

- [ ] Pull M1 changes: `cd ~/cto-agent && git pull origin main`
- [ ] Create worktree: `git worktree add ~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m2 -b feat/autopilot-m2`
- [ ] All work from here happens in `~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m2/`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/auto-fix.yml` | Modify | Add `workflow_dispatch` trigger, make `run_id` optional, add `generate-tests` inputs + routing |
| `.github/workflows/e2e-production.yml` | Create | Hourly Playwright E2E cron against app.storscale.ai |
| `.github/workflows/test-gap-detection.yml` | Create | Daily 6 AM UTC coverage collection + POST to monitor |
| `monitor/src/pollers/synthetic-checks.ts` | Create | Deep response-shape checks with consecutive-failure tracking |
| `monitor/src/routes/coverage.ts` | Create | POST /api/coverage-gaps handler — dispatches generate-tests for top 3 files |
| `monitor/src/index.ts` | Modify | Register synthetic-checks poller + coverage route |
| `prompts/generate-tests.md` | Create | Claude Code prompt for writing missing tests |
| `tests/pollers/synthetic-checks.test.ts` | Create | Unit tests for synthetic-checks poller |
| `tests/routes/coverage.test.ts` | Create | Unit tests for coverage-gaps route handler |

---

## Task 1: Enhance auto-fix.yml — workflow_dispatch + optional run_id + generate-tests

**Files:**
- Modify: `.github/workflows/auto-fix.yml`

The monitor's Dispatcher calls `workflow_dispatch` on `JWP-Ops/cto-agent`. Currently auto-fix.yml only has `workflow_call`. We need to add `workflow_dispatch`, make `run_id` optional (non-CI triggers don't have a foreign run ID), and add generate-tests inputs + routing.

- [ ] **Step 1: Add `workflow_dispatch` trigger and make `run_id` optional**

Open `.github/workflows/auto-fix.yml`. Find the `on:` block (line 1-52 approximately). Replace it:

```yaml
on:
  workflow_call:
    inputs:
      repo:
        description: 'Repository that failed (org/name format)'
        required: true
        type: string
      run_id:
        description: 'Failed workflow run ID (0 for synthetic/E2E triggers)'
        required: false
        default: 0
        type: number
      workflow_name:
        description: 'Name of the CI workflow that failed'
        required: false
        default: 'unknown'
        type: string
      task_type:
        description: 'Type of fix: fix-ci-failure | fix-sentry-issue | fix-e2e-failure | generate-tests'
        required: false
        default: 'fix-ci-failure'
        type: string
      sentry_issue_title:
        required: false
        default: ''
        type: string
      sentry_issue_file:
        required: false
        default: ''
        type: string
      sentry_issue_line:
        required: false
        default: ''
        type: string
      e2e_test_file:
        description: 'E2E test file that failed (or synthetic-check:name)'
        required: false
        default: ''
        type: string
      e2e_error_message:
        description: 'E2E error message or synthetic check failure details'
        required: false
        default: ''
        type: string
      uncovered_file:
        description: 'Source file with low test coverage (for generate-tests)'
        required: false
        default: ''
        type: string
      coverage_pct:
        description: 'Current line coverage percentage for the uncovered file'
        required: false
        default: ''
        type: string
    secrets:
      ANTHROPIC_API_KEY:
        required: true
      GH_PAT:
        required: true
      SLACK_WEBHOOK_URL:
        required: false

  workflow_dispatch:
    inputs:
      repo:
        description: 'Target repo to fix (org/name format)'
        required: true
        type: string
      run_id:
        description: 'Failed run ID (0 for non-CI triggers)'
        required: false
        default: 0
        type: number
      workflow_name:
        description: 'Source workflow name'
        required: false
        default: 'manual'
        type: string
      task_type:
        description: 'fix-ci-failure | fix-sentry-issue | fix-e2e-failure | generate-tests'
        required: false
        default: 'fix-ci-failure'
        type: string
      sentry_issue_title:
        required: false
        default: ''
        type: string
      sentry_issue_file:
        required: false
        default: ''
        type: string
      sentry_issue_line:
        required: false
        default: ''
        type: string
      e2e_test_file:
        required: false
        default: ''
        type: string
      e2e_error_message:
        required: false
        default: ''
        type: string
      uncovered_file:
        required: false
        default: ''
        type: string
      coverage_pct:
        required: false
        default: ''
        type: string
```

- [ ] **Step 2: Update loop guard to skip when run_id is 0**

Find the loop guard step (looks like `name: Check for fix loop`). Add a short-circuit at the very top of its `run:` block, before any `gh api` call:

```bash
# Skip loop guard for synthetic/E2E/non-CI triggers
if [ "${TARGET_RUN_ID}" = "0" ]; then
  echo "Loop guard skipped — non-CI trigger (run_id=0)"
  echo "loop_detected=false" >> "$GITHUB_OUTPUT"
  exit 0
fi
```

- [ ] **Step 3: Add generate-tests case to task_type routing**

Find where task_type routing happens (typically a step that sets `PROMPT_FILE` based on `task_type` env var). Add the generate-tests case:

```bash
elif [ "$TASK_TYPE" = "generate-tests" ]; then
  PROMPT_FILE="prompts/generate-tests.md"
  export UNCOVERED_FILE="${{ inputs.uncovered_file }}"
  export COVERAGE_PCT="${{ inputs.coverage_pct }}"
```

Also add `uncovered_file` and `coverage_pct` to the env block so the Claude Code action can reference them:

```yaml
env:
  UNCOVERED_FILE: ${{ inputs.uncovered_file }}
  COVERAGE_PCT: ${{ inputs.coverage_pct }}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/auto-fix.yml
git commit -m "feat(m2): add workflow_dispatch trigger, optional run_id, generate-tests routing to auto-fix.yml"
```

---

## Task 2: Write failing tests for synthetic-checks poller

**Files:**
- Create: `tests/pollers/synthetic-checks.test.ts`

Follow the sentry.test.ts pattern exactly: mock logger + slack, inject a mock Dispatcher.

- [ ] **Step 1: Write the failing tests**

Create `tests/pollers/synthetic-checks.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { createSyntheticChecksPoller } from '../../monitor/src/pollers/synthetic-checks.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return {
    dispatch: vi.fn(() => Promise.resolve(result)),
  };
}

function mockFetch(responses: Array<{ ok: boolean; status?: number; json?: unknown; text?: string }>) {
  let callIndex = 0;
  vi.stubGlobal('fetch', vi.fn(() => {
    const r = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: () => Promise.resolve(r.json ?? {}),
      text: () => Promise.resolve(r.text ?? ''),
    });
  }));
}

describe('synthetic-checks poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends no alerts when all checks pass', async () => {
    mockFetch([
      { ok: true, json: { status: 'ok' } },                              // api-health
      { ok: true, json: { report: 'some content here' } },               // intelligence-report
      { ok: true, json: [{ id: 1 }] },                                    // facilities-list
      { ok: true, text: '<meta name="x"><title>StorScale</title>' },     // dashboard
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('sends a warning alert on first consecutive failure', async () => {
    mockFetch([
      { ok: false, status: 503 },           // api-health fails
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      severity: 'warning',
      title: expect.stringContaining('Synthetic Check Failed'),
    });
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('escalates to auto-fix after 2 consecutive failures of the same check', async () => {
    // Both calls: api-health fails, others pass
    const failResponses = [
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ];
    mockFetch(failResponses);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);

    await poller(); // first failure — alert only
    await poller(); // second failure — escalate

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'e2e-fix',
        inputs: expect.objectContaining({
          task_type: 'fix-e2e-failure',
          e2e_test_file: expect.stringContaining('synthetic-check:api-health'),
        }),
      }),
    );
  });

  it('resets consecutive failure count when a check recovers', async () => {
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);

    // First call: api-health fails
    mockFetch([
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    await poller();

    // Second call: all pass (recovery)
    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    await poller();

    // Third call: api-health fails again
    mockFetch([
      { ok: false, status: 503 },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    await poller();

    // Should NOT escalate (consecutive count reset to 1 after recovery)
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('detects intelligence-report shape failure', async () => {
    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { result: 'wrong key' } }, // missing 'report' key
      { ok: true, json: [{ id: 1 }] },
      { ok: true, text: '<meta>StorScale' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('intelligence-report'),
    });
  });

  it('detects empty facilities array as failure', async () => {
    mockFetch([
      { ok: true, json: { status: 'ok' } },
      { ok: true, json: { report: 'ok' } },
      { ok: true, json: [] }, // empty array — check requires ≥1 item
      { ok: true, text: '<meta>StorScale' },
    ]);
    const dispatcher = makeDispatcher();
    const poller = createSyntheticChecksPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      title: expect.stringContaining('facilities-list'),
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd ~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m2
npx vitest run tests/pollers/synthetic-checks.test.ts
```

Expected: `FAIL — Cannot find module '../../monitor/src/pollers/synthetic-checks.js'`

---

## Task 3: Implement synthetic-checks poller

**Files:**
- Create: `monitor/src/pollers/synthetic-checks.ts`

- [ ] **Step 1: Write the implementation**

Create `monitor/src/pollers/synthetic-checks.ts`:

```typescript
import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

interface CheckResult {
  ok: boolean;
  actual?: unknown;
  expected?: string;
}

interface SyntheticCheck {
  name: string;
  run: () => Promise<CheckResult>;
}

// Repo routing: map check name → which repo's auto-fix to trigger
function repoForCheck(checkName: string): string {
  if (checkName === 'dashboard-login-page') {
    return 'StorScale-AI/storscale-website';
  }
  return 'StorScale-AI/storscale-agents';
}

// Deduplicate escalations: checkName → dedup window (2-hour buckets)
function escalationDedupeId(checkName: string): string {
  return `synthetic-${checkName}-${Math.floor(Date.now() / (2 * 60 * 60 * 1000))}`;
}

/**
 * Factory that returns a synthetic-checks poller with an injected dispatcher.
 * Validates response shapes (not just HTTP status) for critical API endpoints.
 * Escalates to auto-fix after 2 consecutive failures per check.
 *
 * Consecutive failure counts are stored in a closure-scoped Map.
 * Each createSyntheticChecksPoller() call gets its own fresh counter map —
 * in production, call this once and reuse the returned function.
 */
export function createSyntheticChecksPoller(dispatcher: Dispatcher) {
  // Per-check consecutive failure counter (lives for the process lifetime)
  const consecutiveFailures = new Map<string, number>();

  const checks: SyntheticCheck[] = [
    {
      name: 'api-health',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://agent-api.storscale.ai/api/health', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return { ok: false, actual: `HTTP ${res.status}`, expected: 'HTTP 200' };
        }
        const body = (await res.json()) as Record<string, unknown>;
        const ok = typeof body === 'object' && body !== null && body['status'] === 'ok';
        return { ok, actual: body, expected: '{ status: "ok" }' };
      },
    },
    {
      name: 'intelligence-report',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://agent-api.storscale.ai/api/intelligence/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zip_code: '78701', radius_miles: 5 }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          return {
            ok: false,
            actual: `HTTP ${res.status}`,
            expected: 'HTTP 200 with non-empty report key',
          };
        }
        const body = (await res.json()) as Record<string, unknown>;
        const report = body['report'];
        const ok = typeof report === 'string' && report.length > 0;
        return {
          ok,
          actual: ok ? 'has non-empty report' : `report=${JSON.stringify(report)}`,
          expected: 'object with non-empty string report key',
        };
      },
    },
    {
      name: 'facilities-list',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://agent-api.storscale.ai/api/facilities', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return { ok: false, actual: `HTTP ${res.status}`, expected: 'HTTP 200 with array ≥1 item' };
        }
        const body = (await res.json()) as unknown;
        const ok = Array.isArray(body) && body.length >= 1;
        return {
          ok,
          actual: Array.isArray(body) ? `array(${body.length})` : typeof body,
          expected: 'array with ≥1 item',
        };
      },
    },
    {
      name: 'dashboard-login-page',
      run: async (): Promise<CheckResult> => {
        const res = await fetch('https://app.storscale.ai', {
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          return { ok: false, actual: `HTTP ${res.status}`, expected: 'HTTP 200' };
        }
        const html = await res.text();
        const hasMeta = html.includes('<meta');
        const hasStorScale = html.includes('StorScale');
        const ok = hasMeta && hasStorScale;
        return {
          ok,
          actual: `hasMeta=${hasMeta} hasStorScale=${hasStorScale}`,
          expected: 'HTML with <meta tags and "StorScale" text',
        };
      },
    },
  ];

  return async function syntheticChecksPoller(): Promise<void> {
    const results = await Promise.allSettled(
      checks.map(async (check) => {
        try {
          const result = await check.run();
          return { name: check.name, ...result };
        } catch (err) {
          return {
            name: check.name,
            ok: false,
            actual: err instanceof Error ? err.message : String(err),
            expected: 'no network error',
          };
        }
      }),
    );

    for (const settled of results) {
      if (settled.status === 'rejected') continue;
      const { name, ok, actual, expected } = settled.value;

      if (ok) {
        consecutiveFailures.set(name, 0);
        continue;
      }

      const prev = consecutiveFailures.get(name) ?? 0;
      const failCount = prev + 1;
      consecutiveFailures.set(name, failCount);

      log('warn', `Synthetic check failed: ${name} (consecutive=${failCount})`, {
        check: name,
        actual,
        expected,
      });

      // Always alert on first failure
      if (failCount === 1) {
        await sendAlert({
          severity: 'warning',
          title: `CTO Agent: Synthetic Check Failed — ${name}`,
          message: `*Check:* ${name}\n*Expected:* ${expected}\n*Got:* ${JSON.stringify(actual)}`,
        });
      }

      // Escalate after 2 consecutive failures
      if (failCount >= 2) {
        await sendAlert({
          severity: 'danger',
          title: `CTO Agent: Synthetic Check Escalating — ${name}`,
          message: `*Check:* ${name} has failed ${failCount} times in a row.\n*Expected:* ${expected}\n*Got:* ${JSON.stringify(actual)}\nDispatching auto-fix.`,
        });

        await dispatcher.dispatch({
          category: 'e2e-fix',
          repo: 'JWP-Ops/cto-agent',
          workflow: 'auto-fix.yml',
          inputs: {
            repo: repoForCheck(name),
            run_id: '0',
            workflow_name: 'synthetic-checks',
            task_type: 'fix-e2e-failure',
            e2e_test_file: `synthetic-check:${name}`,
            e2e_error_message: `Synthetic check '${name}' failed ${failCount} consecutive times. Expected: ${expected}. Got: ${JSON.stringify(actual)}`,
          },
          dedupeId: escalationDedupeId(name),
        });
      }
    }
  };
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx vitest run tests/pollers/synthetic-checks.test.ts
```

Expected: `6 tests passed`

- [ ] **Step 3: Commit**

```bash
git add monitor/src/pollers/synthetic-checks.ts tests/pollers/synthetic-checks.test.ts
git commit -m "feat(m2): add synthetic-checks poller with consecutive-failure escalation"
```

---

## Task 4: Register synthetic-checks poller in index.ts

**Files:**
- Modify: `monitor/src/index.ts`

- [ ] **Step 1: Add import and interval constant**

At the top of `monitor/src/index.ts`, add after the sentry import:

```typescript
import { createSyntheticChecksPoller } from './pollers/synthetic-checks.js';
```

In the `POLL_INTERVALS` object, add:

```typescript
syntheticChecks: 5 * 60 * 1000,   // 5 min — response shape validation
```

- [ ] **Step 2: Register the poller in startPollers()**

In `startPollers()`, after the sentry poller registration and before the discovery refresh, add:

```typescript
// Synthetic checks — validates response shapes, escalates after 2 consecutive failures
const syntheticChecksPoller = createSyntheticChecksPoller(dispatcher);
intervalIds.push(registerPoller('synthetic-checks', () => {
  setCorrelationId();
  return syntheticChecksPoller();
}, POLL_INTERVALS.syntheticChecks));
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (102+ tests). Fix any regressions before continuing.

- [ ] **Step 4: Commit**

```bash
git add monitor/src/index.ts
git commit -m "feat(m2): register synthetic-checks poller at 5-minute interval"
```

---

## Task 5: Write failing tests for coverage-gaps route

**Files:**
- Create: `tests/routes/coverage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/routes/coverage.test.ts`:

```typescript
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
        { file: 'src/e.ts', linePct: 90 }, // above threshold — excluded
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
        inputs: expect.objectContaining({
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
      linePct: i * 5, // 0, 5, 10, 15, 20, 25, 30, 35, 40, 45
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

    // Same file posted twice on the same day
    vi.mocked(dispatcher.dispatch)
      .mockResolvedValueOnce({ dispatched: true })
      .mockResolvedValueOnce({ dispatched: false, reason: 'duplicate: test-gen-...' });

    const res1 = await post(app, payload);
    const res2 = await post(app, payload);

    const j1 = await res1.json() as { dispatched: number };
    const j2 = await res2.json() as { dispatched: number };

    expect(j1.dispatched).toBe(1);
    expect(j2.dispatched).toBe(0); // Dispatcher blocked the duplicate
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2); // Route called dispatch twice; Dispatcher blocked it
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/routes/coverage.test.ts
```

Expected: `FAIL — Cannot find module '../../monitor/src/routes/coverage.js'`

---

## Task 6: Implement coverage-gaps route

**Files:**
- Create: `monitor/src/routes/coverage.ts`

- [ ] **Step 1: Create the routes directory and file**

```bash
mkdir -p monitor/src/routes
```

Create `monitor/src/routes/coverage.ts`:

```typescript
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

/**
 * Registers POST /api/coverage-gaps on the given Hono app.
 * Called by the test-gap-detection GitHub Actions workflow after generating
 * coverage reports for storscale-agents and storscale-dashboard.
 * Dispatches generate-tests to auto-fix.yml for the top 3 lowest-coverage files.
 */
export function coverageRoutes(app: Hono, dispatcher: Dispatcher): void {
  app.post('/api/coverage-gaps', async (c) => {
    // Optional Bearer token auth (same pattern as health-api.ts)
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

    // Sort ascending by line coverage, filter below threshold, take top 3 lowest
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
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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

    await sendAlert({
      severity: 'warning',
      title: 'CTO Agent: Test Gap Detection',
      message: `*Repo:* ${body.repo}\nDispatched ${dispatched} test-generation job(s).\n*Files:* ${uncovered.map((e) => `${e.file} (${e.linePct}%)`).join(', ')}`,
    });

    return c.json({ dispatched, files: uncovered.map((e) => e.file) });
  });
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx vitest run tests/routes/coverage.test.ts
```

Expected: `6 tests passed`

- [ ] **Step 3: Commit**

```bash
git add monitor/src/routes/coverage.ts tests/routes/coverage.test.ts
git commit -m "feat(m2): add POST /api/coverage-gaps route with dispatcher integration"
```

---

## Task 7: Wire coverage route into index.ts

**Files:**
- Modify: `monitor/src/index.ts`

- [ ] **Step 1: Add import**

At the top of `monitor/src/index.ts`, add after the healthRoutes import:

```typescript
import { coverageRoutes } from './routes/coverage.js';
```

- [ ] **Step 2: Register the route**

The Hono app setup currently has:

```typescript
app.route('/api', healthRoutes);
```

The coverage route registers at `/api/coverage-gaps` on the app directly (not under a sub-router), so add after the health route line:

```typescript
// Coverage gap reporting — called by test-gap-detection.yml
// Route is registered after dispatcher is created in startPollers()
```

Wait — the issue is that `coverageRoutes` needs the `dispatcher` instance, which is created inside `startPollers()`. Move the route registration into `startPollers()` after the dispatcher is created:

```typescript
// Inside startPollers(), after: const dispatcher = new Dispatcher();
coverageRoutes(app, dispatcher);
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Fix any regressions.

- [ ] **Step 4: Commit**

```bash
git add monitor/src/index.ts
git commit -m "feat(m2): wire coverage-gaps route into Hono app"
```

---

## Task 8: Create generate-tests prompt

**Files:**
- Create: `prompts/generate-tests.md`

- [ ] **Step 1: Write the prompt**

Create `prompts/generate-tests.md`:

```markdown
# Generate Tests for Uncovered File

You are writing tests for a file with low or zero test coverage.

**To get the target file details, run these commands first:**
```bash
echo "Target file: $UNCOVERED_FILE"
echo "Current coverage: $COVERAGE_PCT%"
```

Then proceed to:

1. Read the target file at the path returned by `$UNCOVERED_FILE`
2. Identify all exported functions, classes, and methods
3. Write tests for the top-priority behaviours:
   - Happy path (expected input → expected output)
   - Edge cases (empty input, null, boundary values)
   - Error cases (invalid input, dependencies that fail)
4. Follow the existing test conventions in this repo:
   - Test files live in `tests/` (not co-located with source)
   - Use Vitest (`describe`, `it`, `expect`, `vi.mock`)
   - Mock external dependencies (HTTP calls, database, Slack)
   - Test file path mirrors source: `src/foo/bar.ts` → `tests/foo/bar.test.ts`
5. Run the tests to confirm they pass: `npx vitest run tests/<path>.test.ts`
6. Commit: `git add tests/<path>.test.ts && git commit -m "test: add coverage for $UNCOVERED_FILE"`

**Rules:**
- Write real tests with real assertions — no `expect(true).toBe(true)`
- Mock at the module boundary (vi.mock), not inside test functions
- Do NOT modify the source file unless it has a genuine bug
- Keep the diff under 5 files and 100 lines
- If the file is too complex to test safely in one pass, test the 3 most critical functions only

**If you cannot determine safe tests with confidence:**
Create a file named `ESCALATE.txt` in the repo root with one sentence explaining why.
Do not create or modify any other files.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/generate-tests.md
git commit -m "feat(m2): add generate-tests Claude Code prompt"
```

---

## Task 9: Create e2e-production.yml — Hourly Playwright E2E Cron

**Files:**
- Create: `.github/workflows/e2e-production.yml`

This workflow runs in JWP-Ops/cto-agent (not storscale-website). It checks out storscale-website to get the e2e tests, runs them against production, and calls auto-fix.yml via `workflow_call` (same-repo — no PAT needed for that) on failure.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/e2e-production.yml`:

```yaml
name: E2E Production Tests

on:
  schedule:
    - cron: '0 * * * *'   # every hour
  workflow_dispatch: {}

concurrency:
  group: e2e-production
  cancel-in-progress: true  # if the previous hour's run is still going, cancel it

jobs:
  e2e:
    name: Run Playwright E2E against app.storscale.ai
    runs-on: ubuntu-latest
    timeout-minutes: 20
    outputs:
      failed: ${{ steps.test.outcome == 'failure' && 'true' || 'false' }}
      test_file: ${{ steps.parse.outputs.test_file }}
      error_message: ${{ steps.parse.outputs.error_message }}

    steps:
      - name: Checkout storscale-website (E2E test suite)
        uses: actions/checkout@v4
        with:
          repository: StorScale-AI/storscale-website
          token: ${{ secrets.GH_PAT }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        id: test
        continue-on-error: true
        env:
          PLAYWRIGHT_BASE_URL: https://app.storscale.ai
          E2E_USER_EMAIL: e2e-test@storscale.ai
          E2E_USER_PASSWORD: ${{ secrets.E2E_USER_PASSWORD }}
        run: |
          npx playwright test \
            --reporter=list,json \
            --output=playwright-report \
            2>&1 | tee playwright-output.txt
          echo "exit_code=${PIPESTATUS[0]}" >> "$GITHUB_OUTPUT"

      - name: Parse failure details
        id: parse
        if: steps.test.outcome == 'failure'
        run: |
          # Extract the first failed test file (lines starting with ×)
          TEST_FILE=$(grep -E '^\s+×' playwright-output.txt | head -1 \
            | sed 's/.*× //' | sed 's/:.*//' || echo '')

          # Extract first error message (up to 400 chars)
          ERROR_MSG=$(grep -A2 'Error:' playwright-output.txt | head -6 \
            | tr '\n' ' ' | cut -c1-400 || echo 'See Playwright report for details')

          echo "test_file=${TEST_FILE}" >> "$GITHUB_OUTPUT"
          echo "error_message=${ERROR_MSG}" >> "$GITHUB_OUTPUT"

  dispatch-fix:
    name: Dispatch auto-fix on E2E failure
    needs: e2e
    if: needs.e2e.outputs.failed == 'true'
    uses: JWP-Ops/cto-agent/.github/workflows/auto-fix.yml@main
    with:
      repo: StorScale-AI/storscale-website
      run_id: 0
      workflow_name: e2e-production
      task_type: fix-e2e-failure
      e2e_test_file: ${{ needs.e2e.outputs.test_file }}
      e2e_error_message: ${{ needs.e2e.outputs.error_message }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      GH_PAT: ${{ secrets.GH_PAT }}
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/e2e-production.yml'))" \
  && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-production.yml
git commit -m "feat(m2): add hourly E2E production cron against app.storscale.ai"
```

---

## Task 10: Create test-gap-detection.yml — Daily Coverage Workflow

**Files:**
- Create: `.github/workflows/test-gap-detection.yml`

This workflow runs daily at 6 AM UTC on both monitored repos, generates coverage, parses the output with Node.js, and POSTs to the CTO agent's `/api/coverage-gaps` endpoint.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/test-gap-detection.yml`:

```yaml
name: Test Gap Detection

on:
  schedule:
    - cron: '0 6 * * *'   # 6 AM UTC daily
  workflow_dispatch: {}

jobs:
  coverage-storscale-agents:
    name: Coverage — storscale-agents
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout storscale-agents
        uses: actions/checkout@v4
        with:
          repository: StorScale-AI/storscale-agents
          token: ${{ secrets.GH_PAT }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Vitest coverage
        # Allow failure — missing coverage file just means no report posted
        run: npx vitest run --coverage --reporter=json 2>/dev/null || true

      - name: Post coverage to CTO agent
        if: hashFiles('coverage/coverage-final.json') != ''
        env:
          CTO_API_URL: https://cto-agent-monitor.onrender.com
          CTO_API_KEY: ${{ secrets.CTO_API_KEY }}
        run: |
          node --input-type=module <<'EOF'
          import fs from 'fs';
          const raw = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
          const cwd = process.cwd();
          const entries = Object.entries(raw).map(([absPath, data]) => {
            const file = absPath.replace(cwd + '/', '');
            const statements = Object.values(data.s ?? {});
            const covered = statements.filter(v => Number(v) > 0).length;
            const total = statements.length;
            const linePct = total > 0 ? Math.round((covered / total) * 100) : 100;
            return { file, linePct };
          });
          const payload = JSON.stringify({
            repo: 'StorScale-AI/storscale-agents',
            coverage: entries,
          });
          const res = await fetch(`${process.env.CTO_API_URL}/api/coverage-gaps`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.CTO_API_KEY}`,
            },
            body: payload,
          });
          const json = await res.json();
          console.log('Coverage gap report:', JSON.stringify(json));
          EOF

  coverage-storscale-dashboard:
    name: Coverage — storscale-dashboard
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout storscale-website (dashboard)
        uses: actions/checkout@v4
        with:
          repository: StorScale-AI/storscale-website
          token: ${{ secrets.GH_PAT }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Vitest coverage
        run: npx vitest run --coverage --reporter=json 2>/dev/null || true

      - name: Post coverage to CTO agent
        if: hashFiles('coverage/coverage-final.json') != ''
        env:
          CTO_API_URL: https://cto-agent-monitor.onrender.com
          CTO_API_KEY: ${{ secrets.CTO_API_KEY }}
        run: |
          node --input-type=module <<'EOF'
          import fs from 'fs';
          const raw = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
          const cwd = process.cwd();
          const entries = Object.entries(raw).map(([absPath, data]) => {
            const file = absPath.replace(cwd + '/', '');
            const statements = Object.values(data.s ?? {});
            const covered = statements.filter(v => Number(v) > 0).length;
            const total = statements.length;
            const linePct = total > 0 ? Math.round((covered / total) * 100) : 100;
            return { file, linePct };
          });
          const payload = JSON.stringify({
            repo: 'StorScale-AI/storscale-website',
            coverage: entries,
          });
          const res = await fetch(`${process.env.CTO_API_URL}/api/coverage-gaps`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.CTO_API_KEY}`,
            },
            body: payload,
          });
          const json = await res.json();
          console.log('Coverage gap report:', JSON.stringify(json));
          EOF
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/test-gap-detection.yml'))" \
  && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test-gap-detection.yml
git commit -m "feat(m2): add daily test-gap-detection workflow posting coverage to CTO agent"
```

---

## Task 11: Final test run and PR

- [ ] **Step 1: Run full test suite**

```bash
cd ~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m2
npx vitest run
```

Expected: all tests pass (at minimum 114 tests: 102 M1 + 6 synthetic-checks + 6 coverage-gaps).

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 3: Push branch and open PR**

```bash
git push origin feat/autopilot-m2
gh pr create \
  --repo JWP-Ops/cto-agent \
  --title "feat: CTO Agent M2 — Proactive Testing" \
  --body "## Summary
- Hourly E2E cron (\`.github/workflows/e2e-production.yml\`) against app.storscale.ai
- Deep synthetic checks poller — validates response shapes, escalates after 2 consecutive failures
- Daily test gap detection (\`.github/workflows/test-gap-detection.yml\`) + \`POST /api/coverage-gaps\` endpoint
- \`prompts/generate-tests.md\` for auto-generating missing tests
- \`workflow_dispatch\` added to auto-fix.yml so monitor can dispatch programmatically
- \`run_id\` made optional (default 0) for non-CI triggers

## Test Plan
- [ ] \`npx vitest run\` — all tests pass
- [ ] \`npx tsc --noEmit\` — clean compile
- [ ] Manually trigger e2e-production.yml → confirm it runs and reports outcome to Slack
- [ ] Temporarily return wrong shape from /api/health → confirm Slack alert within 5 min, escalation after 10 min
- [ ] Manually trigger test-gap-detection.yml → confirm /api/coverage-gaps receives payload + dispatches"
```

---

## Verification

After merging and Render redeploys (~2 min):

1. **E2E cron** — manually trigger `e2e-production.yml` from GitHub Actions UI → confirm Playwright runs and Slack shows pass/fail
2. **Synthetic checks** — temporarily make `https://agent-api.storscale.ai/api/health` return `{ status: "degraded" }` → Slack warning within 5 min; wait for second poll → Slack danger + auto-fix dispatch
3. **Coverage gaps** — manually trigger `test-gap-detection.yml` → `coverage/coverage-final.json` processed → `POST /api/coverage-gaps` succeeds → Slack alert shows dispatched count
4. **workflow_dispatch on auto-fix.yml** — from GitHub UI, manually dispatch auto-fix.yml with `task_type: generate-tests` and a test file path → confirm it runs with the generate-tests prompt

## Env Vars Needed

Add to Render (CTO agent monitor service) if not already set:
- `CTO_API_KEY` — shared secret for /api/coverage-gaps auth

Add to JWP-Ops/cto-agent GitHub repo secrets if not already set:
- `E2E_USER_PASSWORD` — for Playwright login (value: `StorScale-E2E-2026!`)
- `CTO_API_KEY` — same value as on Render, for test-gap-detection workflow
- `GH_PAT`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL` — should already be set from M1
