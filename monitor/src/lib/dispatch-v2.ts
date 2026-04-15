import { optionalEnv } from './env.js';
import { log } from './logger.js';
import { DedupStore } from './dedup.js';
import { recordDispatchCost } from '../cost-tracker.js';

export type DispatchCategory = 'ci-fix' | 'sentry-fix' | 'e2e-fix' | 'test-gen' | 'dep-patch' | 'docs';

export interface DispatchRequest {
  category: DispatchCategory;
  repo: string;           // e.g. "StorScale-AI/storscale-agents"
  workflow: string;       // e.g. "auto-fix.yml"
  inputs: Record<string, string>;
  dedupeId?: string;
}

export interface DispatchResult {
  dispatched: boolean;
  reason?: string;
}

interface DispatcherOptions {
  dailyCap?: number;
  hourlyCap?: number;
}

export class Dispatcher {
  private dailyCap: number;
  private hourlyCap: number;

  private dailyCount = 0;
  private dailyResetAt: number;

  // per-category hourly counts: category → list of dispatch timestamps
  private hourlyLog = new Map<DispatchCategory, number[]>();

  private dedup = new DedupStore();

  constructor(options: DispatcherOptions = {}) {
    this.dailyCap = options.dailyCap ?? 15;
    this.hourlyCap = options.hourlyCap ?? 3;
    this.dailyResetAt = this.nextMidnightUtc();
  }

  private nextMidnightUtc(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    ));
    return midnight.getTime();
  }

  private resetDailyIfNeeded(): void {
    if (Date.now() >= this.dailyResetAt) {
      this.dailyCount = 0;
      this.dailyResetAt = this.nextMidnightUtc();
    }
  }

  private categoryCount(category: DispatchCategory): number {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const timestamps = (this.hourlyLog.get(category) ?? []).filter(t => t > oneHourAgo);
    this.hourlyLog.set(category, timestamps);
    return timestamps.length;
  }

  private recordCategory(category: DispatchCategory): void {
    const timestamps = this.hourlyLog.get(category) ?? [];
    timestamps.push(Date.now());
    this.hourlyLog.set(category, timestamps);
  }

  async dispatch(req: DispatchRequest): Promise<DispatchResult> {
    this.resetDailyIfNeeded();

    // Check deduplication
    if (req.dedupeId) {
      if (this.dedup.has(req.dedupeId)) {
        log('warn', `Dispatcher: duplicate dispatch blocked for dedupeId=${req.dedupeId}`);
        return { dispatched: false, reason: `duplicate: ${req.dedupeId} already dispatched` };
      }
    }

    // Check daily cap
    if (this.dailyCount >= this.dailyCap) {
      log('warn', `Dispatcher: daily cap of ${this.dailyCap} reached`);
      return { dispatched: false, reason: `daily cap of ${this.dailyCap} reached` };
    }

    // Check per-category hourly cap
    const catCount = this.categoryCount(req.category);
    if (catCount >= this.hourlyCap) {
      log('warn', `Dispatcher: hourly cap of ${this.hourlyCap} reached for category=${req.category}`);
      return { dispatched: false, reason: `hourly cap of ${this.hourlyCap} reached for category=${req.category}` };
    }

    // Perform dispatch via GitHub API (same mechanism as dispatch.ts)
    const token = optionalEnv('GITHUB_PAT');
    if (!token) {
      log('warn', 'Dispatcher: GITHUB_PAT not set — cannot dispatch');
      return { dispatched: false, reason: 'GITHUB_PAT not set' };
    }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${req.repo}/actions/workflows/${req.workflow}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: req.inputs,
          }),
        },
      );

      if (res.status === 204) {
        // Record successful dispatch
        this.dailyCount++;
        this.recordCategory(req.category);
        recordDispatchCost(req.category);
        if (req.dedupeId) {
          this.dedup.add(req.dedupeId);
        }
        log('info', `Dispatcher: dispatched ${req.category} workflow for ${req.repo}`);
        return { dispatched: true };
      }

      const body = await res.text();
      log('error', `Dispatcher: workflow dispatch failed: ${res.status} ${body}`);
      return { dispatched: false, reason: `GitHub API returned ${res.status}` };
    } catch (e) {
      log('error', `Dispatcher: dispatch error for ${req.repo}: ${e}`);
      return { dispatched: false, reason: `dispatch error: ${e}` };
    }
  }
}
