import { Controller, Get } from '@nestjs/common';
import type { ProgressView } from '@tutor/shared';
import { CurrentUser, type AuthUser } from '../auth/auth.guard';
import { ProgressService } from './progress.service';

@Controller('progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<ProgressView> {
    return this.progress.get(user.id);
  }
}
