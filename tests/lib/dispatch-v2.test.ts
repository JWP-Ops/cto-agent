import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn(() => 'fake-pat'),
}));

vi.mock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));

let Dispatcher: typeof import('../../monitor/src/lib/dispatch-v2.js').Dispatcher;

describe('Dispatcher', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.doMock('../../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn(() => 'fake-pat'),
    }));
    vi.doMock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));

    const mod = await import('../../monitor/src/lib/dispatch-v2.js');
    Dispatcher = mod.Dispatcher;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches when under cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const dispatcher = new Dispatcher({ dailyCap: 15, hourlyCap: 3 });
    const result = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'StorScale-AI/storscale-agents',
      workflow: 'auto-fix.yml',
      inputs: { run_id: '1001' },
    });

    expect(result.dispatched).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns dispatched:false with daily cap reason when daily cap reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const dispatcher = new Dispatcher({ dailyCap: 2, hourlyCap: 10 });

    const r1 = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'org/repo-a',
      workflow: 'auto-fix.yml',
      inputs: {},
    });
    const r2 = await dispatcher.dispatch({
      category: 'sentry-fix',
      repo: 'org/repo-b',
      workflow: 'auto-fix.yml',
      inputs: {},
    });

    expect(r1.dispatched).toBe(true);
    expect(r2.dispatched).toBe(true);

    // 3rd should hit daily cap
    const r3 = await dispatcher.dispatch({
      category: 'e2e-fix',
      repo: 'org/repo-c',
      workflow: 'auto-fix.yml',
      inputs: {},
    });

    expect(r3.dispatched).toBe(false);
    expect(r3.reason).toMatch(/daily cap/i);
  });

  it('returns dispatched:false with duplicate reason for duplicate dedupeId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const dispatcher = new Dispatcher({ dailyCap: 15, hourlyCap: 3 });

    const r1 = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'org/repo',
      workflow: 'auto-fix.yml',
      inputs: {},
      dedupeId: 'unique-run-123',
    });

    expect(r1.dispatched).toBe(true);

    const r2 = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'org/repo',
      workflow: 'auto-fix.yml',
      inputs: {},
      dedupeId: 'unique-run-123',
    });

    expect(r2.dispatched).toBe(false);
    expect(r2.reason).toMatch(/duplicate/i);
  });

  it('returns dispatched:false with hourly cap reason when category hourly cap reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const dispatcher = new Dispatcher({ dailyCap: 100, hourlyCap: 2 });

    const r1 = await dispatcher.dispatch({
      category: 'test-gen',
      repo: 'org/repo-a',
      workflow: 'auto-fix.yml',
      inputs: {},
    });
    const r2 = await dispatcher.dispatch({
      category: 'test-gen',
      repo: 'org/repo-b',
      workflow: 'auto-fix.yml',
      inputs: {},
    });

    expect(r1.dispatched).toBe(true);
    expect(r2.dispatched).toBe(true);

    // 3rd in same category this hour should be blocked
    const r3 = await dispatcher.dispatch({
      category: 'test-gen',
      repo: 'org/repo-c',
      workflow: 'auto-fix.yml',
      inputs: {},
    });

    expect(r3.dispatched).toBe(false);
    expect(r3.reason).toMatch(/hourly cap/i);
  });

  it('returns dispatched: false when GITHUB_PAT is not set', async () => {
    vi.resetModules();
    vi.doMock('../../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn(() => undefined),
    }));
    vi.doMock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));

    const mod = await import('../../monitor/src/lib/dispatch-v2.js');
    const LocalDispatcher = mod.Dispatcher;

    const dispatcher = new LocalDispatcher({ dailyCap: 15, hourlyCap: 3 });
    const result = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'StorScale-AI/storscale-agents',
      workflow: 'auto-fix.yml',
      inputs: { task_type: 'fix-ci-failure' },
    });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toMatch(/GITHUB_PAT/i);
  });

  it('different categories do not share hourly caps', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const dispatcher = new Dispatcher({ dailyCap: 100, hourlyCap: 1 });

    // Fill hourly cap for 'ci-fix'
    const r1 = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'org/repo',
      workflow: 'auto-fix.yml',
      inputs: {},
    });
    expect(r1.dispatched).toBe(true);

    // ci-fix is now capped
    const r2 = await dispatcher.dispatch({
      category: 'ci-fix',
      repo: 'org/repo',
      workflow: 'auto-fix.yml',
      inputs: {},
    });
    expect(r2.dispatched).toBe(false);
    expect(r2.reason).toMatch(/hourly cap/i);

    // sentry-fix should still be allowed (separate cap)
    const r3 = await dispatcher.dispatch({
      category: 'sentry-fix',
      repo: 'org/repo',
      workflow: 'auto-fix.yml',
      inputs: {},
    });
    expect(r3.dispatched).toBe(true);
  });
});
