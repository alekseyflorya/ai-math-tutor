import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/config.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DemoSeeder } from './demo.seeder';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: `${config.get('JWT_TTL_DAYS')}d` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, DemoSeeder, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
