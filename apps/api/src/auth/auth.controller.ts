import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    // behind the CloudPanel/nginx proxy req.ip is the proxy; nginx appends the real client as the LAST
    // X-Forwarded-For hop (earlier hops are client-supplied and spoofable)
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return this.auth.login(dto.email, dto.password, xff[xff.length - 1] || req.ip || 'unknown');
  }

  /** Second login step when the first returned { mfaRequired: true, mfaToken }. */
  @Public()
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }

  /** Self-service — any logged-in user manages their own MFA, no special permission required. */
  @Get('mfa/status')
  mfaStatus(@CurrentUser() user: AuthUser) {
    return this.auth.mfaStatus(user.sub);
  }

  @Post('mfa/setup')
  setupMfa(@CurrentUser() user: AuthUser) {
    return this.auth.setupMfa(user.sub);
  }

  @Post('mfa/enable')
  enableMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.auth.enableMfa(user.sub, dto.code);
  }

  @Post('mfa/disable')
  disableMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.auth.disableMfa(user.sub, dto.code);
  }

  /** Self-service — any logged-in user manages their own credentials, no special permission required. */
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Post('change-email')
  changeEmail(@CurrentUser() user: AuthUser, @Body() dto: ChangeEmailDto) {
    return this.auth.changeEmail(user.sub, dto.newEmail, dto.currentPassword);
  }

  @Public()
  @Post('refresh')
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.auth.refresh(refreshToken);
  }

  @Post('logout')
  logout(@Body('refreshToken') refreshToken: string) {
    return this.auth.logout(refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
