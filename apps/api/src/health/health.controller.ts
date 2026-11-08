import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';
import { LlmService } from '../llm/llm.service';
import { DB, type Db } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ code: 'DB_DOWN', message: 'Database unavailable' });
    }
    return { status: 'ok', llmProvider: this.llm.providerName };
  }
}
