import { log } from './lib/logger.js';
import { optionalEnv } from './lib/env.js';
import { sendAlert } from './slack.js';

// Estimated cost per Claude Code run (Opus-class model, ~25 turns avg)
const ESTIMATED_COST_PER_RUN = 0.50; // $0.50 average

let dailySpend = 0;
let dailyRunCount = 0;
let lastResetDate = new Date().toISOString().split('T')[0];

function resetIfNewDay(): void {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastResetDate) {
    log('info', `Daily cost reset: yesterday=$${dailySpend.toFixed(2)} runs=${dailyRunCount}`);
    dailySpend = 0;
    dailyRunCount = 0;
    lastResetDate = today;
  }
}

/**
 * Record a Claude Code run cost estimate.
 * Returns false if budget exceeded (dispatch should be blocked).
 */
export function recordCost(): boolean {
  resetIfNewDay();

  const budgetStr = optionalEnv('CTO_AGENT_DAILY_BUDGET');
  const budget = budgetStr ? parseFloat(budgetStr) : 25; // $25/day default

  dailySpend += ESTIMATED_COST_PER_RUN;
  dailyRunCount++;

  log('info', `Cost tracker: run #${dailyRunCount}, daily total=$${dailySpend.toFixed(2)}/${budget}`);

  if (dailySpend > budget) {
    sendAlert({
      severity: 'danger',
      title: 'CTO Agent: Daily Budget Exceeded',
      message: `Estimated spend: $${dailySpend.toFixed(2)} (budget: $${budget})\nRuns today: ${dailyRunCount}\n\nAll further dispatches blocked until tomorrow.`,
    });
    return false;
  }

  if (dailySpend > budget * 0.8) {
    log('warn', `Approaching daily budget: $${dailySpend.toFixed(2)}/$${budget}`);
  }

  return true;
}

export function isBudgetExceeded(): boolean {
  resetIfNewDay();
  const budgetStr = optionalEnv('CTO_AGENT_DAILY_BUDGET');
  const budget = budgetStr ? parseFloat(budgetStr) : 25;
  return dailySpend > budget;
}

export function getDailyCostSummary(): { spend: number; runs: number; budget: number } {
  resetIfNewDay();
  const budgetStr = optionalEnv('CTO_AGENT_DAILY_BUDGET');
  const budget = budgetStr ? parseFloat(budgetStr) : 25;
  return { spend: dailySpend, runs: dailyRunCount, budget };
}

// ── Weekly cost tracking (rolling 7-day window) ─────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface CostRecord {
  category: string;
  timestamp: number;
  estimatedCost: number;
}

// Exported for testing
export const _weeklyHistory: CostRecord[] = [];

function evictOldRecords(): void {
  const cutoff = Date.now() - WEEK_MS;
  while (_weeklyHistory.length > 0 && _weeklyHistory[0].timestamp < cutoff) {
    _weeklyHistory.shift();
  }
}

/**
 * Record a dispatch cost for a given category (called from Dispatcher on success).
 */
export function recordDispatchCost(category: string): void {
  evictOldRecords();
  _weeklyHistory.push({
    category,
    timestamp: Date.now(),
    estimatedCost: ESTIMATED_COST_PER_RUN,
  });
}

/**
 * Returns total cost per dispatch category for the rolling 7-day window.
 */
export function getWeeklyCostByCategory(): Map<string, number> {
  evictOldRecords();
  const result = new Map<string, number>();
  for (const record of _weeklyHistory) {
    result.set(record.category, (result.get(record.category) ?? 0) + record.estimatedCost);
  }
  return result;
}

/**
 * Returns total estimated spend across all categories for the past 7 days.
 */
export function getWeeklyTotalCost(): number {
  evictOldRecords();
  return _weeklyHistory.reduce((sum, r) => sum + r.estimatedCost, 0);
}
