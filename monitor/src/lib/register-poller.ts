import { log } from './logger.js';

type PollerFn = () => Promise<void>;

export function registerPoller(
  name: string,
  fn: PollerFn,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      log('error', `Poller ${name} failed`, {
        poller: name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  };

  void run();
  return setInterval(() => void run(), intervalMs);
}
