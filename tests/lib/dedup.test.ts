import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DedupStore } from '../../monitor/src/lib/dedup.js';

describe('DedupStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has() returns false for unseen IDs', () => {
    const store = new DedupStore();
    expect(store.has('unknown-id')).toBe(false);
  });

  it('has() returns true after add()', () => {
    const store = new DedupStore();
    store.add('my-id');
    expect(store.has('my-id')).toBe(true);
  });

  it('has() returns false after TTL expires', () => {
    const store = new DedupStore();
    const ttlMs = 1000;
    store.add('expiring-id', ttlMs);
    expect(store.has('expiring-id')).toBe(true);

    // Advance time past TTL
    vi.advanceTimersByTime(ttlMs + 1);
    expect(store.has('expiring-id')).toBe(false);
  });

  it('size() returns count of unexpired entries', () => {
    const store = new DedupStore();
    expect(store.size()).toBe(0);

    store.add('id-1', 1000);
    store.add('id-2', 1000);
    store.add('id-3', 5000);
    expect(store.size()).toBe(3);

    // Expire id-1 and id-2
    vi.advanceTimersByTime(2000);
    // Access them to trigger expiry cleanup
    store.has('id-1');
    store.has('id-2');
    expect(store.size()).toBe(1);
  });
});
