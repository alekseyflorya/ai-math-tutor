import { Module } from '@nestjs/common';
import { ProblemsModule } from '../problems/problems.module';
import { ProgressModule } from '../progress/progress.module';
import { AttemptLock } from './attempt-lock';
import { AttemptRepository } from './attempt.repository';
import { FollowUpService } from './follow-up.service';
import { TutorContextBuilder } from './tutor-context.builder';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';

/** Attempts and the tutoring state machine. */
@Module({
  imports: [ProblemsModule, ProgressModule],
  controllers: [TutorController],
  providers: [TutorService, AttemptRepository, AttemptLock, TutorContextBuilder, FollowUpService],
})
export class TutorModule {}
