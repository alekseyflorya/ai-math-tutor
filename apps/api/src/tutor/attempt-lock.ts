import { ConflictException, Injectable } from '@nestjs/common';

/**
 * Rejects overlapping turns on one attempt (double clicks, two tabs) with 409 BUSY.
 * In memory, so one API instance by design; with replicas this becomes a lease column
 * (`busy_until`) taken with a conditional UPDATE — see README, "Limitations".
 */
@Injectable()
export class AttemptLock {
  private readonly busy = new Set<string>();

  async run<T>(attemptId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(attemptId)) {
      throw new ConflictException({
        code: 'BUSY',
        message: 'The tutor is still answering your previous message',
      });
    }
    this.busy.add(attemptId);
    try {
      return await fn();
    } finally {
      this.busy.delete(attemptId);
    }
  }
}
