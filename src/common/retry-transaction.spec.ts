import { withDeadlockRetry } from './retry-transaction';

function pgError(code: string): any {
  return Object.assign(new Error('pg error'), { code });
}

describe('withDeadlockRetry', () => {
  it('returns the result on the first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withDeadlockRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a deadlock (40P01) and succeeds on a later attempt', async () => {
    const fn = jest.fn().mockRejectedValueOnce(pgError('40P01')).mockResolvedValueOnce('ok');
    await expect(withDeadlockRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on a serialization failure (40001)', async () => {
    const fn = jest.fn().mockRejectedValueOnce(pgError('40001')).mockResolvedValueOnce('ok');
    await expect(withDeadlockRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error', async () => {
    const fn = jest.fn().mockRejectedValueOnce(pgError('23505')); // unique_violation
    await expect(withDeadlockRetry(fn)).rejects.toThrow('pg error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and surfaces the last error', async () => {
    const fn = jest.fn().mockRejectedValue(pgError('40P01'));
    await expect(withDeadlockRetry(fn, 3)).rejects.toThrow('pg error');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
