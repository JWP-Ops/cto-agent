import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
vi.mock('../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn(() => ''),
}));
vi.mock('../monitor/src/slack.js', () => ({ sendAlert: vi.fn() }));

import { recordDispatchCost, getWeeklyCostByCategory, getWeeklyTotalCost, _weeklyHistory } from '../monitor/src/cost-tracker.js';

const ESTIMATED_COST_PER_RUN = 0.50; // matches constant in cost-tracker.ts

describe('weekly cost tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _weeklyHistory.splice(0); // drain singleton between tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recordDispatchCost appends a record and getWeeklyCostByCategory returns correct sum per category', () => {
    recordDispatchCost('ci-fix');
    recordDispatchCost('ci-fix');
    recordDispatchCost('sentry-fix');

    const breakdown = getWeeklyCostByCategory();
    expect(breakdown.get('ci-fix')).toBeCloseTo(ESTIMATED_COST_PER_RUN * 2);
    expect(breakdown.get('sentry-fix')).toBeCloseTo(ESTIMATED_COST_PER_RUN);
    expect(breakdown.size).toBe(2);
  });

  it('evictOldRecords drops records older than 7 days and retains records within the window', () => {
    recordDispatchCost('ci-fix'); // recorded at time 0

    // Advance 8 days — record should be evicted on next call
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

    recordDispatchCost('sentry-fix'); // recorded at time +8 days

    const breakdown = getWeeklyCostByCategory();
    expect(breakdown.has('ci-fix')).toBe(false);
    expect(breakdown.get('sentry-fix')).toBeCloseTo(ESTIMATED_COST_PER_RUN);
  });

  it('getWeeklyTotalCost returns zero on empty history', () => {
    expect(getWeeklyTotalCost()).toBe(0);
  });

  it('getWeeklyTotalCost returns correct sum across all categories', () => {
    recordDispatchCost('ci-fix');
    recordDispatchCost('e2e-fix');
    recordDispatchCost('dep-patch');

    expect(getWeeklyTotalCost()).toBeCloseTo(ESTIMATED_COST_PER_RUN * 3);
  });
});
