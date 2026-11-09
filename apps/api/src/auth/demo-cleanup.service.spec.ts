import { Logger } from '@nestjs/common';
import type { Db } from '../db/db.module';
import { DemoCleanupService } from './demo-cleanup.service';

describe('DemoCleanupService.daily', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not throw when the cleanup fails, and logs the error with its stack', async () => {
    const service = new DemoCleanupService({} as Db);
    const failure = new Error('connection terminated');
    jest.spyOn(service, 'deleteExpired').mockRejectedValue(failure);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.daily()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Demo cleanup failed: connection terminated', failure.stack);
  });

  it('logs how many accounts it deleted', async () => {
    const service = new DemoCleanupService({} as Db);
    jest.spyOn(service, 'deleteExpired').mockResolvedValue(3);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await service.daily();
    expect(log).toHaveBeenCalledWith('Deleted 3 demo accounts older than 7 days');
  });
});
