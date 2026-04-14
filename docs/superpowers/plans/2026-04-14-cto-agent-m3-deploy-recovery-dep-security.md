# CTO Agent M3 — Render Deploy Recovery & Dependency Security

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two proactive remediation capabilities: automatic recovery from Render deploy failures, and daily dependency vulnerability scanning with auto-patch dispatch.

**Architecture:** A new `render-deploys` poller watches every Render service's latest deploy via the Render v1 API; on `failed`/`build_failed` it dispatches `fix-deploy-failure` to `auto-fix.yml`. A daily `npm-audit.yml` GitHub Actions workflow runs `npm audit --json` across monitored repos and POSTs critical/high CVEs to a new `POST /api/vulnerabilities` endpoint, which dispatches `dep-patch` jobs. Both new task types get dedicated Claude Code prompts. The `dep-patch` category is already defined in the Dispatcher — M3 wires it end-to-end.

**Tech Stack:** TypeScript strict mode, Hono, Vitest, GitHub Actions, Render v1 REST API (`api.render.com/v1`), `npm audit --json`.

---

## Prerequisites

- [ ] Pull latest: `cd ~/cto-agent && git pull origin main`
- [ ] Create worktree: `git worktree add ~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m3 -b feat/autopilot-m3`
- [ ] All work from here in `~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m3/`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/auto-fix.yml` | Modify | Add `fix-deploy-failure` + `dep-patch` inputs, routing cases, env steps |
| `.github/workflows/npm-audit.yml` | Create | Daily npm audit, parse CVEs, POST to monitor |
| `monitor/src/pollers/render-deploys.ts` | Create | Poll Render deploy status; dispatch on `failed`/`build_failed` |
| `monitor/src/routes/vulnerabilities.ts` | Create | `POST /api/vulnerabilities` — receives CVEs, dispatches `dep-patch` |
| `monitor/src/index.ts` | Modify | Register render-deploys poller + vulnerabilities route |
| `prompts/fix-deploy-failure.md` | Create | Claude Code prompt for Render deploy failures |
| `prompts/fix-vulnerability.md` | Create | Claude Code prompt for CVE patching |
| `tests/pollers/render-deploys.test.ts` | Create | 6 unit tests for render-deploys poller |
| `tests/routes/vulnerabilities.test.ts` | Create | 7 unit tests for vulnerabilities route |

---

## Task 1: Enhance auto-fix.yml — fix-deploy-failure + dep-patch inputs, routing, env steps

**Files:**
- Modify: `.github/workflows/auto-fix.yml`

Two new `task_type` values need inputs, routing cases, and env setup steps — mirroring the existing `fix-sentry-issue` and `generate-tests` patterns exactly.

- [ ] **Step 1: Add new inputs to `workflow_call` block**

In `.github/workflows/auto-fix.yml`, find the `workflow_call.inputs` block (after `coverage_pct`, before the `secrets:` block). Insert these seven new inputs:

```yaml
      deploy_service:
        description: 'Render service name (for fix-deploy-failure)'
        required: false
        default: ''
        type: string
      deploy_id:
        description: 'Render deploy ID (for fix-deploy-failure)'
        required: false
        default: ''
        type: string
      deploy_logs:
        description: 'Render deploy failure summary (for fix-deploy-failure)'
        required: false
        default: ''
        type: string
      vulnerable_package:
        description: 'npm package name with vulnerability (for dep-patch)'
        required: false
        default: ''
        type: string
      fixed_version:
        description: 'Package version that patches the vulnerability'
        required: false
        default: ''
        type: string
      severity:
        description: 'Vulnerability severity: critical | high (for dep-patch)'
        required: false
        default: ''
        type: string
      cve_id:
        description: 'CVE ID or GHSA advisory ID (for dep-patch)'
        required: false
        default: ''
        type: string
```

- [ ] **Step 2: Add the same seven inputs to `workflow_dispatch` block**

Find the `workflow_dispatch.inputs` block (after `coverage_pct` in that block). Insert the identical seven inputs from Step 1.

- [ ] **Step 3: Add routing cases to the `Select prompt file` step**

Find the `case "${{ inputs.task_type }}"` block. Before the `*)` catch-all, add:

```yaml
            fix-deploy-failure) echo "file=cto-agent/prompts/fix-deploy-failure.md" >> "$GITHUB_OUTPUT" ;;
            dep-patch)          echo "file=cto-agent/prompts/fix-vulnerability.md"  >> "$GITHUB_OUTPUT" ;;
```

The complete updated case block should read:

```yaml
          case "${{ inputs.task_type }}" in
            fix-sentry-issue)   echo "file=cto-agent/prompts/fix-sentry-issue.md"    >> "$GITHUB_OUTPUT" ;;
            fix-e2e-failure)    echo "file=cto-agent/prompts/fix-e2e-failure.md"     >> "$GITHUB_OUTPUT" ;;
            generate-tests)     echo "file=cto-agent/prompts/generate-tests.md"      >> "$GITHUB_OUTPUT" ;;
            fix-deploy-failure) echo "file=cto-agent/prompts/fix-deploy-failure.md"  >> "$GITHUB_OUTPUT" ;;
            dep-patch)          echo "file=cto-agent/prompts/fix-vulnerability.md"   >> "$GITHUB_OUTPUT" ;;
            *)                  echo "file=cto-agent/prompts/fix-ci-failure.md"      >> "$GITHUB_OUTPUT" ;;
          esac
```

- [ ] **Step 4: Add env setup steps for the two new task types**

After the `Set generate-tests env vars` step, insert:

```yaml
      - name: Set deploy-failure env vars
        if: steps.loop-guard.outputs.skip != 'true' && steps.escalation-check.outputs.escalate_only != 'true' && inputs.task_type == 'fix-deploy-failure'
        env:
          DEPLOY_SERVICE: ${{ inputs.deploy_service }}
          DEPLOY_ID: ${{ inputs.deploy_id }}
          DEPLOY_LOGS: ${{ inputs.deploy_logs }}
        run: |
          {
            printf 'DEPLOY_SERVICE<<GH_EOF\n%s\nGH_EOF\n' "${DEPLOY_SERVICE}"
            printf 'DEPLOY_ID<<GH_EOF\n%s\nGH_EOF\n'      "${DEPLOY_ID}"
            printf 'DEPLOY_LOGS<<GH_EOF\n%s\nGH_EOF\n'    "${DEPLOY_LOGS}"
          } >> "$GITHUB_ENV"

      - name: Set dep-patch env vars
        if: steps.loop-guard.outputs.skip != 'true' && steps.escalation-check.outputs.escalate_only != 'true' && inputs.task_type == 'dep-patch'
        env:
          VULNERABLE_PACKAGE: ${{ inputs.vulnerable_package }}
          FIXED_VERSION: ${{ inputs.fixed_version }}
          SEVERITY: ${{ inputs.severity }}
          CVE_ID: ${{ inputs.cve_id }}
        run: |
          {
            printf 'VULNERABLE_PACKAGE<<GH_EOF\n%s\nGH_EOF\n' "${VULNERABLE_PACKAGE}"
            printf 'FIXED_VERSION<<GH_EOF\n%s\nGH_EOF\n'      "${FIXED_VERSION}"
            printf 'SEVERITY<<GH_EOF\n%s\nGH_EOF\n'           "${SEVERITY}"
            printf 'CVE_ID<<GH_EOF\n%s\nGH_EOF\n'             "${CVE_ID}"
          } >> "$GITHUB_ENV"
```

- [ ] **Step 5: Validate YAML and commit**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/auto-fix.yml'))" && echo "YAML valid"
git add .github/workflows/auto-fix.yml
git commit -m "feat(m3): add fix-deploy-failure + dep-patch inputs, routing, env steps to auto-fix.yml"
```

Expected: `YAML valid`

---

## Task 2: Write failing tests for render-deploys poller

**Files:**
- Create: `tests/pollers/render-deploys.test.ts`

Follow the sentry/synthetic-checks pattern: mocks at the top, factory pattern. Use a URL-based fetch mock for determinism since deploys are fetched in parallel via `Promise.allSettled`.

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

import { createRenderDeploysPoller } from '../../monitor/src/pollers/render-deploys.js';
import { sendAlert } from '../../monitor/src/slack.js';
import type { DispatchResult } from '../../monitor/src/lib/dispatch-v2.js';

function makeDispatcher(result: DispatchResult = { dispatched: true }) {
  return { dispatch: vi.fn(() => Promise.resolve(result)) };
}

/** URL-based fetch mock — deterministic even under Promise.allSettled parallelism */
function mockFetch(handler: (url: string) => { ok: boolean; json: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const { ok, json } = handler(String(url));
      return Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        json: () => Promise.resolve(json),
      });
    }),
  );
}

const SERVICES = [
  { service: { id: 'srv-aaa', name: 'storscale-agents', slug: 'storscale-agents', type: 'web_service' } },
];

const TWO_SERVICES = [
  { service: { id: 'srv-aaa', name: 'storscale-agents', slug: 'storscale-agents', type: 'web_service' } },
  { service: { id: 'srv-bbb', name: 'cto-agent-monitor', slug: 'cto-agent-monitor', type: 'web_service' } },
];

const LIVE_DEPLOY = [{ deploy: { id: 'dep-111', status: 'live', commit: { message: 'feat: live' } } }];
const FAILED_DEPLOY = [{ deploy: { id: 'dep-222', status: 'failed', commit: { message: 'feat: broke it' } } }];
const BUILD_FAILED_DEPLOY = [{ deploy: { id: 'dep-333', status: 'build_failed', commit: { message: 'feat: build error' } } }];

describe('render-deploys poller', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, RENDER_API_KEY: 'test-render-key' };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = OLD_ENV;
  });

  it('sends no alerts when all deploys are live', async () => {
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: LIVE_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(sendAlert).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('sends danger alert and dispatches auto-fix on failed deploy', async () => {
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(sendAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(sendAlert).mock.calls[0][0]).toMatchObject({
      severity: 'danger',
      title: expect.stringContaining('storscale-agents'),
    });
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'e2e-fix',
        repo: 'JWP-Ops/cto-agent',
        inputs: expect.objectContaining({
          task_type: 'fix-deploy-failure',
          deploy_service: 'storscale-agents',
          deploy_id: 'dep-222',
        }),
      }),
    );
  });

  it('detects build_failed status', async () => {
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: BUILD_FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({ deploy_id: 'dep-333' }),
      }),
    );
  });

  it('does NOT re-alert the same deploy ID on the next poll', async () => {
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);

    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    await poller();
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Same dep-222 still the latest deploy
    mockFetch((url) => {
      if (url.includes('/services?')) return { ok: true, json: SERVICES };
      if (url.includes('/deploys?')) return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    await poller();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('skips gracefully when RENDER_API_KEY is not set', async () => {
    delete process.env.RENDER_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(fetch).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('continues to other services when one deploy fetch fails (HTTP 500)', async () => {
    mockFetch((url) => {
      if (url.includes('/services?'))       return { ok: true, json: TWO_SERVICES };
      if (url.includes('srv-aaa/deploys'))  return { ok: false, json: [] };
      if (url.includes('srv-bbb/deploys'))  return { ok: true, json: FAILED_DEPLOY };
      return { ok: false, json: [] };
    });
    const dispatcher = makeDispatcher();
    const poller = createRenderDeploysPoller(dispatcher as never);
    await poller();

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd ~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m3
npx vitest run tests/pollers/render-deploys.test.ts
```

Expected: `FAIL — Cannot find module '../../monitor/src/pollers/render-deploys.js'`

---

## Task 3: Implement render-deploys poller

**Files:**
- Create: `monitor/src/pollers/render-deploys.ts`

- [ ] **Step 1: Create the file**

```typescript
import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import { optionalEnv } from '../lib/env.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

const RENDER_API_BASE = 'https://api.render.com/v1';
const FAILED_STATUSES = new Set(['failed', 'build_failed']);

interface RenderService {
  id: string;
  name: string;
  slug: string;
  type: string;
}

interface RenderDeploy {
  id: string;
  status: string;
  commit?: { id?: string; message?: string };
  finishedAt?: string;
}

/** Map a Render service slug/name to the GitHub repo that owns it */
function repoForService(service: RenderService): string {
  const mapping: Record<string, string> = {
    'cto-agent-monitor': 'JWP-Ops/cto-agent',
    'storscale-agents':  'StorScale-AI/storscale-agents',
    'finops-api':        'JWP-Ops/cfo-agent',
  };
  return mapping[service.slug] ?? mapping[service.name] ?? `StorScale-AI/${service.slug}`;
}

/**
 * Factory — returns a render-deploys poller with an injected dispatcher.
 *
 * Each poll fetches all Render services then checks the latest deploy for each.
 * A failed deploy (status: failed | build_failed) triggers a Slack danger alert
 * and dispatches task_type:fix-deploy-failure to JWP-Ops/cto-agent/auto-fix.yml.
 *
 * Dedup is handled by a closure-scoped Set of alerted deploy IDs — each unique
 * deploy ID is dispatched exactly once. The Dispatcher adds a secondary dedup
 * via dedupeId, but the Set is the first gate (avoids unnecessary API calls).
 */
export function createRenderDeploysPoller(dispatcher: Dispatcher) {
  const alertedDeployIds = new Set<string>();

  async function fetchServices(apiKey: string): Promise<RenderService[]> {
    const res = await fetch(`${RENDER_API_BASE}/services?limit=20`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log('warn', `Render services fetch failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as Array<{ service: RenderService }>;
    return data.map((d) => d.service);
  }

  async function fetchLatestDeploy(
    apiKey: string,
    serviceId: string,
  ): Promise<RenderDeploy | null> {
    const res = await fetch(
      `${RENDER_API_BASE}/services/${serviceId}/deploys?limit=1`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      log('warn', `Render deploys fetch failed for ${serviceId}: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as Array<{ deploy: RenderDeploy }>;
    return data[0]?.deploy ?? null;
  }

  return async function renderDeploysPoller(): Promise<void> {
    const apiKey = optionalEnv('RENDER_API_KEY');
    if (!apiKey) {
      log('debug', 'RENDER_API_KEY not set — render-deploys poller skipped');
      return;
    }

    let services: RenderService[];
    try {
      services = await fetchServices(apiKey);
    } catch (err) {
      log('warn', 'render-deploys: failed to fetch services list', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await Promise.allSettled(
      services.map(async (service) => {
        let deploy: RenderDeploy | null;
        try {
          deploy = await fetchLatestDeploy(apiKey, service.id);
        } catch (err) {
          log('warn', `render-deploys: deploy fetch failed for ${service.name}`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        if (!deploy) return;
        if (!FAILED_STATUSES.has(deploy.status)) return;
        if (alertedDeployIds.has(deploy.id)) return;

        alertedDeployIds.add(deploy.id);

        const commitMsg = deploy.commit?.message ?? 'unknown commit';
        const repo = repoForService(service);

        log('warn', `Render deploy failed: ${service.name} (${deploy.id})`, {
          service: service.name,
          deployId: deploy.id,
          status: deploy.status,
          commit: commitMsg,
        });

        await sendAlert({
          severity: 'danger',
          title: `CTO Agent: Render Deploy Failed — ${service.name}`,
          message: `*Service:* ${service.name}\n*Status:* ${deploy.status}\n*Deploy:* \`${deploy.id}\`\n*Commit:* ${commitMsg}\nDispatching auto-fix.`,
        });

        await dispatcher.dispatch({
          category: 'e2e-fix',
          repo: 'JWP-Ops/cto-agent',
          workflow: 'auto-fix.yml',
          inputs: {
            repo,
            run_id: '0',
            workflow_name: 'render-deploys',
            task_type: 'fix-deploy-failure',
            deploy_service: service.name,
            deploy_id: deploy.id,
            deploy_logs: `Render deploy ${deploy.id} for service "${service.name}" failed with status: ${deploy.status}. Last commit: ${commitMsg}`,
          },
          dedupeId: `render-deploy-${deploy.id}`,
        });
      }),
    );
  };
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx vitest run tests/pollers/render-deploys.test.ts
```

Expected: `6 tests passed`

- [ ] **Step 3: Commit**

```bash
git add monitor/src/pollers/render-deploys.ts tests/pollers/render-deploys.test.ts
git commit -m "feat(m3): add render-deploys poller with deploy failure detection and auto-fix dispatch"
```

---

## Task 4: Register render-deploys poller in index.ts

**Files:**
- Modify: `monitor/src/index.ts`

- [ ] **Step 1: Add import after the createSyntheticChecksPoller import**

```typescript
import { createRenderDeploysPoller } from './pollers/render-deploys.js';
```

- [ ] **Step 2: Add to POLL_INTERVALS after syntheticChecks**

```typescript
renderDeploys: 5 * 60 * 1000,    // 5 min — Render deploy failure detection
```

- [ ] **Step 3: Register in startPollers() after synthetic-checks poller**

```typescript
// Render deploy failure detection — dispatches fix-deploy-failure on failed/build_failed
const renderDeploysPoller = createRenderDeploysPoller(dispatcher);
intervalIds.push(registerPoller('render-deploys', () => {
  setCorrelationId();
  return renderDeploysPoller();
}, POLL_INTERVALS.renderDeploys));
```

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Fix any regressions before continuing.

- [ ] **Step 5: Commit**

```bash
git add monitor/src/index.ts
git commit -m "feat(m3): register render-deploys poller at 5-minute interval"
```

---

## Task 5: Create fix-deploy-failure.md prompt

**Files:**
- Create: `prompts/fix-deploy-failure.md`

- [ ] **Step 1: Create the file**

```markdown
# Fix Render Deploy Failure

You are fixing a failed Render service deployment.

**Read the failure context first:**

```bash
echo "Service:  $DEPLOY_SERVICE"
echo "Deploy:   $DEPLOY_ID"
echo "Summary:  $DEPLOY_LOGS"
```

Then follow these steps:

1. **Understand the failure type** from `$DEPLOY_LOGS`:
   - TypeScript/compile error → find and fix the type or import in the target file
   - Test failure during CI → fix the failing test or the code under test
   - Dependency not found → run `npm install` and commit the updated lock file
   - Missing environment variable → write `ESCALATE.txt` (cannot be auto-fixed)

2. **Check recent commits** to find what changed:
   ```bash
   git log --oneline -10
   git diff HEAD~1 --name-only
   ```

3. **Read the relevant files** changed in the last commit.

4. **Apply the minimal targeted fix.**

5. **Run the test suite and TypeScript check:**
   ```bash
   npx vitest run
   npx tsc --noEmit
   ```

6. **Commit with [cto-fix] tag:**
   ```bash
   git add <files>
   git commit -m "[cto-fix] fix Render deploy failure in $DEPLOY_SERVICE"
   ```

**Rules:**
- Max 5 files changed, 100 lines total diff
- Every fix MUST include a regression test (except pure dependency lock file updates)
- NEVER add or change environment variables — if the failure is a missing env var, write `ESCALATE.txt`
- If the root cause is not determinable from the deploy summary and recent history, write `ESCALATE.txt`

**If you cannot safely fix this:**

Create `ESCALATE.txt` in the repo root:
```
Render deploy failure in $DEPLOY_SERVICE (deploy $DEPLOY_ID) requires manual intervention: <one sentence reason>.
```
Do not create or modify any other files.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/fix-deploy-failure.md
git commit -m "feat(m3): add fix-deploy-failure Claude Code prompt"
```

---

## Task 6: Write failing tests for vulnerabilities route

**Files:**
- Create: `tests/routes/vulnerabilities.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/routes/vulnerabilities.test.ts
```

Expected: `FAIL — Cannot find module '../../monitor/src/routes/vulnerabilities.js'`

---

## Task 7: Implement vulnerabilities route

**Files:**
- Create: `monitor/src/routes/vulnerabilities.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { Hono } from 'hono';
import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { sendAlert } from '../slack.js';
import type { Dispatcher } from '../lib/dispatch-v2.js';

export interface VulnerabilityEntry {
  cveId: string;
  packageName: string;
  currentVersion: string;
  fixedVersion: string;
  severity: string;
  title: string;
}

interface VulnerabilityPayload {
  repo: string;
  vulnerabilities: VulnerabilityEntry[];
}

const ACTIONABLE_SEVERITIES = new Set(['critical', 'high']);
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1 };
const MAX_DISPATCHES = 3;

/**
 * Registers POST /api/vulnerabilities on the given Hono app.
 * Called by the npm-audit.yml GitHub Actions workflow after running
 * `npm audit --json` on monitored repos.
 * Dispatches dep-patch jobs for the top MAX_DISPATCHES critical/high CVEs
 * sorted by severity (critical before high). Dedup by (repo + package + cveId + day)
 * is delegated to the Dispatcher's dedupeId mechanism.
 */
export function vulnerabilityRoutes(app: Hono, dispatcher: Dispatcher): void {
  app.post('/api/vulnerabilities', async (c) => {
    const apiKey = optionalEnv('CTO_API_KEY');
    if (apiKey) {
      const auth = c.req.header('Authorization') ?? '';
      if (!auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    let body: VulnerabilityPayload;
    try {
      body = await c.req.json<VulnerabilityPayload>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.repo || !Array.isArray(body.vulnerabilities)) {
      return c.json({ error: 'Missing required fields: repo, vulnerabilities' }, 400);
    }

    const actionable = body.vulnerabilities
      .filter((v) => ACTIONABLE_SEVERITIES.has(v.severity))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99))
      .slice(0, MAX_DISPATCHES);

    if (actionable.length === 0) {
      log('info', `Vulnerability report: no critical/high CVEs in ${body.repo}`);
      return c.json({ dispatched: 0, message: 'No critical or high severity vulnerabilities' });
    }

    const today = new Date().toISOString().slice(0, 10);
    let dispatched = 0;
    const dispatchedCves: string[] = [];

    for (const vuln of actionable) {
      const result = await dispatcher.dispatch({
        category: 'dep-patch',
        repo: 'JWP-Ops/cto-agent',
        workflow: 'auto-fix.yml',
        inputs: {
          repo: body.repo,
          run_id: '0',
          workflow_name: 'npm-audit',
          task_type: 'dep-patch',
          vulnerable_package: vuln.packageName,
          fixed_version: vuln.fixedVersion,
          severity: vuln.severity,
          cve_id: vuln.cveId,
        },
        dedupeId: `dep-patch-${body.repo}-${vuln.packageName}-${vuln.cveId}-${today}`,
      });

      if (result.dispatched) {
        dispatched++;
        dispatchedCves.push(`${vuln.packageName}@${vuln.fixedVersion} (${vuln.cveId})`);
        log('info', 'Dispatched dep-patch', {
          repo: body.repo,
          package: vuln.packageName,
          severity: vuln.severity,
          cveId: vuln.cveId,
        });
      }
    }

    if (dispatched > 0) {
      await sendAlert({
        severity: 'warning',
        title: 'CTO Agent: Dependency Vulnerabilities Detected',
        message: `*Repo:* ${body.repo}\nDispatched ${dispatched} patch job(s).\n*Packages:* ${dispatchedCves.join(', ')}`,
      });
    }

    return c.json({ dispatched, cves: dispatchedCves });
  });
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx vitest run tests/routes/vulnerabilities.test.ts
```

Expected: `7 tests passed`

- [ ] **Step 3: Commit**

```bash
git add monitor/src/routes/vulnerabilities.ts tests/routes/vulnerabilities.test.ts
git commit -m "feat(m3): add POST /api/vulnerabilities route with dep-patch dispatcher integration"
```

---

## Task 8: Wire vulnerabilities route into index.ts

**Files:**
- Modify: `monitor/src/index.ts`

- [ ] **Step 1: Add import after coverageRoutes import**

```typescript
import { vulnerabilityRoutes } from './routes/vulnerabilities.js';
```

- [ ] **Step 2: Register in startPollers() directly after coverageRoutes()**

```typescript
vulnerabilityRoutes(app, dispatcher);
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Fix any regressions before continuing.

- [ ] **Step 4: Commit**

```bash
git add monitor/src/index.ts
git commit -m "feat(m3): wire vulnerabilities route into Hono app"
```

---

## Task 9: Create fix-vulnerability.md prompt

**Files:**
- Create: `prompts/fix-vulnerability.md`

- [ ] **Step 1: Create the file**

```markdown
# Patch Dependency Vulnerability

You are patching a vulnerable npm dependency in the target repository.

**Read the vulnerability context first:**

```bash
echo "Package:       $VULNERABLE_PACKAGE"
echo "Fix version:   $FIXED_VERSION"
echo "Severity:      $SEVERITY"
echo "CVE/Advisory:  $CVE_ID"
```

Then follow these steps:

1. **Find all package.json files** that declare `$VULNERABLE_PACKAGE`:
   ```bash
   grep -r "\"$VULNERABLE_PACKAGE\"" --include="package.json" .
   ```

2. **Update the version constraint** to `^$FIXED_VERSION`:
   ```diff
   -  "lodash": "^4.17.20",
   +  "lodash": "^4.17.21",
   ```

3. **Regenerate the lock file:**
   ```bash
   npm install
   ```

4. **Run the test suite** to confirm no regressions:
   ```bash
   npx vitest run
   npx tsc --noEmit
   ```

5. **Commit with [cto-fix] tag:**
   ```bash
   git add package.json package-lock.json
   git commit -m "[cto-fix] patch $VULNERABLE_PACKAGE to $FIXED_VERSION ($CVE_ID)"
   ```

**Rules:**
- ONLY change version constraints in `package.json` and `package-lock.json` — do NOT touch application code
- If the bump would require a major version change (e.g. `lodash@4` → `lodash@5`), write `ESCALATE.txt`
- If the bump causes test failures, write `ESCALATE.txt` describing which tests broke
- Max 3 files changed: root `package.json`, nested `package.json` (monorepo), `package-lock.json`

**If you cannot safely patch:**

Create `ESCALATE.txt` in the repo root:
```
Cannot auto-patch $VULNERABLE_PACKAGE ($CVE_ID): <one sentence reason>.
```
Do not create or modify any other files.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/fix-vulnerability.md
git commit -m "feat(m3): add fix-vulnerability Claude Code prompt"
```

---

## Task 10: Create npm-audit.yml — Daily Dependency Scanning

**Files:**
- Create: `.github/workflows/npm-audit.yml`

Runs at 7 AM UTC daily (one hour after `test-gap-detection.yml`). Checks out each monitored repo, runs `npm audit --json`, parses critical/high CVEs via inline Node.js ESM script, and POSTs to `/api/vulnerabilities`.

Note on `npm audit`: the command exits non-zero when vulnerabilities are found — that is expected and the JSON is still on stdout. The script reads `err.stdout` to handle this.

- [ ] **Step 1: Create the workflow**

```yaml
name: npm Audit — Dependency Security

on:
  schedule:
    - cron: '0 7 * * *'   # 7 AM UTC daily (after test-gap-detection at 6 AM)
  workflow_dispatch: {}

jobs:
  audit-storscale-agents:
    name: Audit — storscale-agents
    runs-on: ubuntu-latest
    timeout-minutes: 10
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

      - name: Run npm audit and post CVEs to monitor
        env:
          CTO_API_URL: https://cto-agent-monitor.onrender.com
          CTO_API_KEY: ${{ secrets.CTO_API_KEY }}
        run: |
          node --input-type=module << 'SCRIPT'
          import { spawnSync } from 'child_process';

          // npm audit exits non-zero when vulns found — stdout still has JSON
          const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
          const raw = result.stdout ?? '';
          if (!raw) { console.log('No audit output'); process.exit(0); }

          const audit = JSON.parse(raw);
          const vulns = audit.vulnerabilities ?? {};

          const entries = Object.entries(vulns)
            .filter(([, data]) => ['critical', 'high'].includes(data.severity))
            .map(([packageName, data]) => {
              const via = Array.isArray(data.via) ? data.via.find(v => typeof v === 'object') : null;
              const fix = data.fixAvailable;
              return {
                cveId:          via?.url ?? via?.name ?? 'audit-' + packageName,
                packageName,
                currentVersion: packageName,
                fixedVersion:   (typeof fix === 'object' && fix !== null) ? fix.version : 'latest',
                severity:       data.severity,
                title:          via?.title ?? 'Vulnerability in ' + packageName,
              };
            });

          if (entries.length === 0) {
            console.log('No critical or high vulnerabilities');
            process.exit(0);
          }

          const res = await fetch(process.env.CTO_API_URL + '/api/vulnerabilities', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + process.env.CTO_API_KEY,
            },
            body: JSON.stringify({ repo: 'StorScale-AI/storscale-agents', vulnerabilities: entries }),
          });
          console.log('Response:', JSON.stringify(await res.json()));
          SCRIPT

  audit-storscale-dashboard:
    name: Audit — storscale-website (dashboard)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout storscale-website
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

      - name: Run npm audit and post CVEs to monitor
        env:
          CTO_API_URL: https://cto-agent-monitor.onrender.com
          CTO_API_KEY: ${{ secrets.CTO_API_KEY }}
        run: |
          node --input-type=module << 'SCRIPT'
          import { spawnSync } from 'child_process';

          const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
          const raw = result.stdout ?? '';
          if (!raw) { console.log('No audit output'); process.exit(0); }

          const audit = JSON.parse(raw);
          const vulns = audit.vulnerabilities ?? {};

          const entries = Object.entries(vulns)
            .filter(([, data]) => ['critical', 'high'].includes(data.severity))
            .map(([packageName, data]) => {
              const via = Array.isArray(data.via) ? data.via.find(v => typeof v === 'object') : null;
              const fix = data.fixAvailable;
              return {
                cveId:          via?.url ?? via?.name ?? 'audit-' + packageName,
                packageName,
                currentVersion: packageName,
                fixedVersion:   (typeof fix === 'object' && fix !== null) ? fix.version : 'latest',
                severity:       data.severity,
                title:          via?.title ?? 'Vulnerability in ' + packageName,
              };
            });

          if (entries.length === 0) {
            console.log('No critical or high vulnerabilities');
            process.exit(0);
          }

          const res = await fetch(process.env.CTO_API_URL + '/api/vulnerabilities', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + process.env.CTO_API_KEY,
            },
            body: JSON.stringify({ repo: 'StorScale-AI/storscale-website', vulnerabilities: entries }),
          });
          console.log('Response:', JSON.stringify(await res.json()));
          SCRIPT
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/npm-audit.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/npm-audit.yml
git commit -m "feat(m3): add daily npm-audit workflow posting CVEs to /api/vulnerabilities"
```

---

## Task 11: Final test run and PR

- [ ] **Step 1: Run full test suite**

```bash
cd ~/.config/superpowers/worktrees/cto-agent/feat-autopilot-m3
npx vitest run
```

Expected: all tests pass (M1 + M2 + 13 new M3 tests minimum: 6 render-deploys + 7 vulnerabilities).

- [ ] **Step 2: TypeScript clean compile**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Push and open PR**

```bash
git push origin feat/autopilot-m3
gh pr create \
  --repo JWP-Ops/cto-agent \
  --title "feat: CTO Agent M3 — Render Deploy Recovery & Dependency Security" \
  --body "$(cat <<'EOF'
## Summary
- **Render deploy failure recovery** — new \`render-deploys\` poller polls all Render services every 5 min via v1 API; dispatches \`fix-deploy-failure\` to auto-fix.yml on \`failed\`/\`build_failed\`; deduplicates by deploy ID (closure Set)
- **Dependency vulnerability scanning** — daily \`npm-audit.yml\` workflow POSTs critical/high CVEs to new \`POST /api/vulnerabilities\` endpoint; dispatches \`dep-patch\` for top 3 by severity
- **Two new Claude Code prompts** — \`fix-deploy-failure.md\` and \`fix-vulnerability.md\`
- **Two new task_type routes** in auto-fix.yml — \`fix-deploy-failure\` and \`dep-patch\`
- **13 new unit tests** — 6 for render-deploys poller, 7 for vulnerabilities route

## New Env Vars Required
- \`RENDER_API_KEY\` — add to Render (cto-agent-monitor service env vars). Get from Render dashboard → Account Settings → API Keys

## Test Plan
- [ ] \`npx vitest run\` — all tests pass
- [ ] \`npx tsc --noEmit\` — clean compile
- [ ] Manually trigger \`npm-audit.yml\` → confirm /api/vulnerabilities POST logged in monitor, Slack alert if CVEs found
- [ ] Add \`RENDER_API_KEY\` to Render env, verify render-deploys poller starts (check logs for "render-deploys" entries)
- [ ] Manual dispatch of auto-fix.yml with \`task_type: dep-patch\` → confirm fix-vulnerability.md prompt runs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification (post-merge, ~2 min after Render redeploys)

1. **Render-deploys poller** — check monitor logs for `Starting poller: render-deploys`. If `RENDER_API_KEY` is set, you should see a poll log within 5 min with service names listed
2. **npm-audit** — manually trigger `npm-audit.yml` from GitHub Actions → check monitor logs for `/api/vulnerabilities POST` → Slack alert fires if any critical/high CVEs are found
3. **workflow_dispatch dep-patch smoke test** — from GitHub UI dispatch auto-fix.yml manually with `task_type: dep-patch`, `vulnerable_package: lodash`, `fixed_version: 4.17.21`, `repo: StorScale-AI/storscale-agents` → confirm prompt file is `fix-vulnerability.md`

## New Env Vars Summary

| Var | Where to set | How to get |
|-----|-------------|------------|
| `RENDER_API_KEY` | Render → cto-agent-monitor → Environment | Render Dashboard → Account → API Keys → Create key |

`CTO_API_KEY`, `GH_PAT`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL` — already set from M1/M2.
