import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';

/** The curriculum: problems synced from code, listed with the student's status. */
@Module({
  imports: [AuthModule], // the controller reads the student's locale
  controllers: [ProblemsController],
  providers: [ProblemsService],
  exports: [ProblemsService],
})
export class ProblemsModule {}
