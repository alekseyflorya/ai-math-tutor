import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { SkillsService } from './skills.service';

/** Skill mastery and the progress page. The tutor records outcomes through SkillsService. */
@Module({
  controllers: [ProgressController],
  providers: [ProgressService, SkillsService],
  exports: [SkillsService],
})
export class ProgressModule {}
