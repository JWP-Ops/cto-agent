import { log } from './logger.js';

type PollerFn = () => Promise<void>;

export function registerPoller(
  name: string,
  fn: PollerFn,
  intervalMs: number,
): void {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      log('error', `Poller ${name} failed`, { poller: name, err });
    }
  };

  void run();
  setInterval(() => void run(), intervalMs);
}
