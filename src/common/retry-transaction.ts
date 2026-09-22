/**
 * Postgres error 40P01 (deadlock_detected) and 40001 (serialization_failure)
 * are not application bugs -- the database is explicitly telling the caller
 * "abort and retry this transaction" (see the Postgres docs on deadlocks).
 * Under enough concurrent SELECT ... FOR UPDATE against the same row, the
 * lock manager can report a deadlock even with a single contended resource,
 * because a tuple lock upgrade briefly needs more than one lock type. This
 * wraps a transaction so that retry is automatic and bounded, rather than
 * leaving every caller to remember to handle it.
 */
const RETRYABLE_CODES = new Set(['40P01', '40001']);

export async function withDeadlockRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const code = err?.code ?? err?.driverError?.code;
      if (!RETRYABLE_CODES.has(code) || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * attempt));
    }
  }
  throw lastError;
}
