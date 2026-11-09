import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { JsonOnlyMiddleware } from './common/json-only.middleware';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { LlmModule } from './llm/llm.module';
import { ProblemsModule } from './problems/problems.module';
import { ProgressModule } from './progress/progress.module';
import { TutorModule } from './tutor/tutor.module';

/** Infrastructure (config, database, rate limits, model access, auth) plus the feature modules. */
@Module({
  imports: [
    AppConfigModule,
    DbModule,
    // Per-IP request limit for every route; tighter limits are set per route with @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // Daily housekeeping jobs (demo account cleanup).
    ScheduleModule.forRoot(),
    LlmModule,
    AuthModule,
    ProblemsModule,
    ProgressModule,
    TutorModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Express 5 / path-to-regexp v8 wildcard syntax: every route.
    consumer.apply(JsonOnlyMiddleware).forRoutes('{*splat}');
  }
}
