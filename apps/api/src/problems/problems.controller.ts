import { Controller, Get } from '@nestjs/common';
import type { ProblemView } from '@tutor/shared';
import { CurrentUser, type AuthUser } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { ProblemsService } from './problems.service';

@Controller('problems')
export class ProblemsController {
  constructor(
    private readonly problems: ProblemsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<ProblemView[]> {
    const u = await this.auth.getUser(user.id);
    return this.problems.list(user.id, this.auth.toView(u).locale);
  }
}
