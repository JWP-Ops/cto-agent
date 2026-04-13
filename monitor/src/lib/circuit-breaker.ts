interface CircuitBreakerOptions {
  threshold: number; // consecutive failures before opening
  resetMs: number;   // ms before attempting half-open
}

type State = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly name: string,
    private readonly opts: CircuitBreakerOptions,
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - (this.openedAt ?? 0) > this.opts.resetMs) {
        this.state = 'half-open';
      } else {
        throw new Error(`Circuit open: ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (err) {
      this.failures++;
      if (this.state === 'half-open' || this.failures >= this.opts.threshold) {
        this.state = 'open';
        this.openedAt = Date.now();
      }
      throw err;
    }
  }

  /**
   * Returns true when the circuit is open (calls will be blocked).
   * Note: the half-open state transition is lazy — this returns true
   * even after resetMs has elapsed until the next call() attempt.
   */
  isOpen(): boolean {
    return this.state === 'open';
  }
}
