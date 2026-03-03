export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
  getDelayMs?: (error: unknown, attempt: number, fallbackDelayMs: number) => number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < options.attempts) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= options.attempts) {
        break;
      }
      if (options.shouldRetry && !options.shouldRetry(error)) {
        break;
      }
      const fallbackDelay = options.baseDelayMs * 2 ** (attempt - 1);
      const delay = options.getDelayMs
        ? options.getDelayMs(error, attempt, fallbackDelay)
        : fallbackDelay;
      await sleep(delay);
    }
  }
  throw lastError;
}
