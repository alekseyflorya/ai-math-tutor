import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  StartAttemptSchema,
  SubmitSchema,
  type AttemptView,
  type StartAttemptInput,
  type SubmitInput,
} from '@tutor/shared';
import { CurrentUser, type AuthUser } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TutorService } from './tutor.service';

@Controller('attempts')
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('kind') kind?: string) {
    return this.tutor.listRecent(user.id, kind === 'custom' ? 'custom' : undefined);
  }

  @Post()
  start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StartAttemptSchema)) body: StartAttemptInput,
  ): Promise<AttemptView> {
    return this.tutor.start(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AttemptView> {
    return this.tutor.getView(user.id, id);
  }

  /** A solution step ("3x + 12 = 2x + 19") or a question to the tutor; the server tells them apart. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/messages')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubmitSchema)) body: SubmitInput,
  ): Promise<AttemptView> {
    return this.tutor.submit(user.id, id, body.text);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/hint')
  hint(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AttemptView> {
    return this.tutor.hint(user.id, id);
  }
}
