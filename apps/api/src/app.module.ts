import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { JsonOnlyMiddleware } from './common/json-only.middleware';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { LlmModule } from './llm/llm.module';
import { DbModule } from './db/db.module';
import { ProblemsController } from './problems/problems.controller';
import { ProblemsService } from './problems/problems.service';
import { ProgressController } from './progress/progress.controller';
import { ProgressService } from './progress/progress.service';
import { SkillsService } from './progress/skills.service';
import { FollowUpService } from './tutor/follow-up.service';
import { TutorController } from './tutor/tutor.controller';
import { TutorService } from './tutor/tutor.service';

@Module({
  imports: [
    AppConfigModule,
    DbModule,
    // Per-IP request limit for every route; tighter limits are set per route with @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    LlmModule,
    AuthModule,
  ],
  controllers: [HealthController, ProblemsController, TutorController, ProgressController],
  providers: [
    ProblemsService,
    SkillsService,
    ProgressService,
    FollowUpService,
    TutorService,
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
