import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing the module under test
vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

import { registerPoller } from '../../monitor/src/lib/register-poller.js';
import { log } from '../../monitor/src/lib/logger.js';

describe('registerPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the poller function immediately on registration', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);

    registerPoller('test-poller', fn, 60_000);

    // Flush the microtask queue (void run() is async — a tick is enough)
    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls the poller again after the interval elapses', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);

    registerPoller('test-poller', fn, 60_000);
    await Promise.resolve();

    // Advance time by one interval
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not propagate when the poller throws synchronously', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    // Should not throw
    expect(() => registerPoller('failing-poller', fn, 60_000)).not.toThrow();

    // Flush: the rejected promise is caught inside run(), log is called
    await Promise.resolve();
    await Promise.resolve(); // extra tick for the async catch to settle

    expect(fn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('failing-poller'),
      expect.objectContaining({ poller: 'failing-poller' }),
    );
  });

  it('logs an error and continues when the interval poller rejects', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);

    registerPoller('interval-fail', fn, 30_000);
    await Promise.resolve();

    // Make subsequent calls fail
    fn.mockRejectedValue(new Error('interval error'));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('interval-fail'),
      expect.objectContaining({ poller: 'interval-fail' }),
    );
  });
});
