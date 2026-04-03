type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...data };
  const line = JSON.stringify(entry);

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}
