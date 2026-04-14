import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CircuitBreaker } from '../../monitor/src/lib/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls through when circuit is closed', async () => {
    const cb = new CircuitBreaker('test', { threshold: 3, resetMs: 10_000 });
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await cb.call(fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe('ok');
  });

  it('opens after N consecutive failures (threshold)', async () => {
    const cb = new CircuitBreaker('test', { threshold: 3, resetMs: 10_000 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail');
    }

    expect(cb.isOpen()).toBe(true);
  });

  it('throws "Circuit open: <name>" when open without calling fn', async () => {
    const cb = new CircuitBreaker('airtable', { threshold: 2, resetMs: 10_000 });
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trigger threshold failures
    await expect(cb.call(fn)).rejects.toThrow('fail');
    await expect(cb.call(fn)).rejects.toThrow('fail');

    // Circuit is now open — fn should not be called again
    fn.mockResolvedValue('should-not-reach');
    await expect(cb.call(fn)).rejects.toThrow('Circuit open: airtable');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('transitions to half-open after resetMs, allowing one call through', async () => {
    const cb = new CircuitBreaker('render', { threshold: 2, resetMs: 10_000 });
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(cb.call(failFn)).rejects.toThrow('fail');
    await expect(cb.call(failFn)).rejects.toThrow('fail');
    expect(cb.isOpen()).toBe(true);

    // Advance past resetMs
    vi.advanceTimersByTime(10_001);

    const successFn = vi.fn().mockResolvedValue('recovered');
    const result = await cb.call(successFn);

    expect(successFn).toHaveBeenCalledOnce();
    expect(result).toBe('recovered');
  });

  it('closes again if the half-open attempt succeeds', async () => {
    const cb = new CircuitBreaker('supabase', { threshold: 2, resetMs: 5_000 });
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(cb.call(failFn)).rejects.toThrow('fail');
    await expect(cb.call(failFn)).rejects.toThrow('fail');
    expect(cb.isOpen()).toBe(true);

    vi.advanceTimersByTime(5_001);

    // Succeed in half-open — circuit should close
    const successFn = vi.fn().mockResolvedValue('ok');
    await cb.call(successFn);
    expect(cb.isOpen()).toBe(false);

    // Normal calls should pass through again
    const anotherFn = vi.fn().mockResolvedValue('also-ok');
    await expect(cb.call(anotherFn)).resolves.toBe('also-ok');
  });

  it('returns to open if the half-open probe fails', async () => {
    const cb = new CircuitBreaker('test', { threshold: 2, resetMs: 5_000 });
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Open the circuit
    await expect(cb.call(failFn)).rejects.toThrow('fail');
    await expect(cb.call(failFn)).rejects.toThrow('fail');
    expect(cb.isOpen()).toBe(true);

    // Advance past resetMs to allow half-open probe
    vi.advanceTimersByTime(5_001);

    // Probe fails — circuit must re-open
    await expect(cb.call(failFn)).rejects.toThrow('fail');
    expect(cb.isOpen()).toBe(true);

    // Must block again immediately (not allow a second probe)
    await expect(cb.call(vi.fn())).rejects.toThrow('Circuit open: test');
  });

  it('isOpen() returns correct state across lifecycle', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1, resetMs: 1_000 });

    expect(cb.isOpen()).toBe(false);

    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.call(failFn)).rejects.toThrow('fail');

    expect(cb.isOpen()).toBe(true);

    vi.advanceTimersByTime(1_001);

    // Still reports open until a call is attempted (half-open transition happens on call)
    // After a successful half-open call it should close
    const successFn = vi.fn().mockResolvedValue('ok');
    await cb.call(successFn);
    expect(cb.isOpen()).toBe(false);
  });
});
