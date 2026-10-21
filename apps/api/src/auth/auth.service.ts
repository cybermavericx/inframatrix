import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { generateSecret as generateMfaSecret, generateURI as generateMfaUri, verify as verifyMfaCode } from 'otplib';
import * as qrcode from 'qrcode';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { RbacService } from '../rbac/rbac.service';
import { JwtPayload } from './auth.types';
import { decryptSecret, encryptSecret } from './mfa-crypto.util';
import { auditRow, insertAudit } from '../audit/audit.util';

interface MfaPendingPayload {
  sub: number;
  mfaPending: true;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rbac: RbacService,
  ) {}

  /** Security event on the user's own change-log timeline (message only — never a password/secret). */
  private async logEvent(userId: number, message: string) {
    const u = await this.users.findOne({ where: { id: userId } });
    return insertAudit(this.users.manager, [auditRow('user', userId, { action: 'updated', entityLabel: u?.name ?? null, message })]);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Revokes every refresh token this user currently holds. Called after a credential change so a
   *  stolen refresh token stops working the moment the real owner reacts — without this, changing your
   *  password after a suspected compromise doesn't actually end an attacker's already-issued session. */
  private async revokeAllRefreshTokens(userId: number): Promise<void> {
    await this.refreshTokens.update({ userId, revoked: false }, { revoked: true });
  }

  // Password-guessing brake: failed logins per (client address + email) and per address, in a sliding
  // window, in memory (fine for a single PM2 process; resets on restart). A success clears that pair.
  private readonly loginFails = new Map<string, { n: number; since: number }>();
  private static readonly LOGIN_WINDOW_MS = 15 * 60_000;
  private static readonly LOGIN_MAX_PER_ACCOUNT = 10;
  private static readonly LOGIN_MAX_PER_IP = 50;

  private loginKeys(email: string, ip: string) {
    return [`a|${ip}|${email.toLowerCase()}`, `i|${ip}`];
  }

  private assertLoginAllowed(keys: string[]) {
    const now = Date.now();
    if (this.loginFails.size > 5000) {
      for (const [k, v] of this.loginFails) if (now - v.since > AuthService.LOGIN_WINDOW_MS) this.loginFails.delete(k);
    }
    const limits = [AuthService.LOGIN_MAX_PER_ACCOUNT, AuthService.LOGIN_MAX_PER_IP];
    keys.forEach((k, i) => {
      const v = this.loginFails.get(k);
      if (v && now - v.since > AuthService.LOGIN_WINDOW_MS) this.loginFails.delete(k);
      else if (v && v.n >= limits[i]) {
        throw new HttpException('Too many failed login attempts — please wait 15 minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
      }
    });
  }

  private noteLoginFailure(keys: string[]) {
    const now = Date.now();
    for (const k of keys) {
      const v = this.loginFails.get(k);
      if (!v || now - v.since > AuthService.LOGIN_WINDOW_MS) this.loginFails.set(k, { n: 1, since: now });
      else v.n++;
    }
  }

  // Failed-attempt counter per pending MFA token (cleared on success/expiry) — a cheap brute-force
  // guard for a 6-digit code without a new table/dependency, fine for a single PM2 process.
  private readonly mfaAttempts = new Map<string, number>();
  private static readonly MFA_MAX_ATTEMPTS = 5;

  /** Break-glass kill switch (see DEPLOY.md) — MFA is enforced unless MFA_ENFORCED is explicitly "false". */
  private mfaEnforced(): boolean {
    return this.config.get<string>('MFA_ENFORCED', 'true') !== 'false';
  }

  /** ±1 time-step (30s) tolerance for clock drift between server and phone — otplib's default is 0. */
  private async checkTotp(code: string, secret: string): Promise<boolean> {
    const result = await verifyMfaCode({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.email = :email', { email })
      .getOne();
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'Y') throw new UnauthorizedException('Account is disabled');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async login(email: string, password: string, ip = 'unknown') {
    const keys = this.loginKeys(email, ip);
    this.assertLoginAllowed(keys);
    let user: User;
    try {
      user = await this.validateUser(email, password);
    } catch (e) {
      if (e instanceof UnauthorizedException) this.noteLoginFailure(keys);
      throw e;
    }
    this.loginFails.delete(keys[0]);
    if (user.mfaEnabled && this.mfaEnforced()) {
      const payload: MfaPendingPayload = { sub: user.id, mfaPending: true };
      const mfaToken = await this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_MFA_SECRET', 'change_me_mfa'),
        expiresIn: '5m',
      });
      return { mfaRequired: true as const, mfaToken };
    }
    return this.issueTokens(user);
  }

  /** Second login step when MFA is enabled — exchanges a short-lived pending token + TOTP code for real tokens. */
  async verifyMfa(mfaToken: string, code: string) {
    let payload: MfaPendingPayload;
    try {
      payload = await this.jwt.verifyAsync(mfaToken, {
        secret: this.config.get<string>('JWT_MFA_SECRET', 'change_me_mfa'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired code — please log in again');
    }
    if (!payload?.mfaPending) throw new UnauthorizedException('Invalid token');

    const tokenHash = this.hash(mfaToken);
    // entries are only deleted on success, so drop the lot occasionally (pending tokens live 5 minutes,
    // so a reset just forgives a handful of in-flight attempts) instead of growing without bound
    if (this.mfaAttempts.size > 2000) this.mfaAttempts.clear();
    if ((this.mfaAttempts.get(tokenHash) ?? 0) >= AuthService.MFA_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts — please log in again');
    }

    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.mfaSecretEncrypted')
      .where('u.id = :id', { id: payload.sub })
      .getOne();
    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) throw new UnauthorizedException('Invalid token');

    if (!(await this.checkTotp(code, decryptSecret(user.mfaSecretEncrypted)))) {
      this.mfaAttempts.set(tokenHash, (this.mfaAttempts.get(tokenHash) ?? 0) + 1);
      throw new UnauthorizedException('Invalid code');
    }
    this.mfaAttempts.delete(tokenHash);
    return this.issueTokens(user);
  }

  /** Live source of truth the frontend polls for enforcement — deliberately not embedded in the
   *  JWT, which is cached client-side for its whole TTL and would show a stale day-count/status. */
  async mfaStatus(userId: number): Promise<{ mfaEnabled: boolean; mfaRequired: boolean; mfaRequiredBy: Date | null }> {
    const user = await this.users.findOne({ where: { id: userId } });
    return {
      mfaEnabled: !!user?.mfaEnabled,
      mfaRequired: !!user?.mfaRequired,
      mfaRequiredBy: user?.mfaRequiredBy ?? null,
    };
  }

  /** Generates and stores a new (not-yet-active) secret; caller shows the QR, then must call enableMfa to confirm it. */
  async setupMfa(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const secret = generateMfaSecret();
    await this.users.update(userId, { mfaSecretEncrypted: encryptSecret(secret) });
    const otpauthUrl = generateMfaUri({ issuer: 'InfraMatrix', label: user.email, secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    return { secret, qrCodeDataUrl };
  }

  private async loadMfaSecret(userId: number): Promise<User> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.mfaSecretEncrypted')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new UnauthorizedException();
    return user;
  }

  /** Confirms a pending setupMfa() secret with one valid code, then turns MFA on. */
  async enableMfa(userId: number, code: string) {
    const user = await this.loadMfaSecret(userId);
    if (!user.mfaSecretEncrypted) throw new BadRequestException('Start setup first — no pending secret found.');
    if (!(await this.checkTotp(code, decryptSecret(user.mfaSecretEncrypted)))) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.users.update(userId, { mfaEnabled: true });
    await this.logEvent(userId, 'Two-factor authentication turned on');
    return { mfaEnabled: true };
  }

  /** Self-service disable — requires a currently-valid code, not just an open session. */
  async disableMfa(userId: number, code: string) {
    const user = await this.loadMfaSecret(userId);
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) throw new BadRequestException('MFA is not enabled.');
    if (!(await this.checkTotp(code, decryptSecret(user.mfaSecretEncrypted)))) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.users.update(userId, { mfaEnabled: false, mfaSecretEncrypted: null });
    await this.logEvent(userId, 'Two-factor authentication turned off');
    return { mfaEnabled: false };
  }

  /** Self-service — requires the current password even though the session is already authenticated,
   *  so a stolen/left-open session alone isn't enough to lock the real owner out. */
  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.users.update(userId, { password: await bcrypt.hash(newPassword, 10) });
    await this.revokeAllRefreshTokens(userId);
    await this.logEvent(userId, 'Password changed (all sessions signed out)');
    return { success: true };
  }

  /** Self-service email change — same current-password proof as changePassword. The caller's existing
   *  access token still carries the old email until they next log in or refresh; that's display-only
   *  (auth checks key off the numeric id), so no forced re-login is required for correctness. */
  async changeEmail(userId: number, newEmail: string, currentPassword: string) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    // withDeleted: true — a plain findOne silently excludes soft-deleted users, so reusing a removed
    // user's old email would sail past this check and then hit the DB's raw unique-index violation
    // instead (an unhandled 500), the same trap UsersService.create() already guards against.
    const clash = await this.users.findOne({ where: { email: newEmail }, withDeleted: true });
    if (clash && clash.id !== userId) throw new ConflictException('A user with this email already exists.');
    try {
      await this.users.update(userId, { email: newEmail });
    } catch (e) {
      const code = (e as { code?: string; driverError?: { code?: string } }).code ?? (e as { driverError?: { code?: string } }).driverError?.code;
      if (code === 'ER_DUP_ENTRY') throw new ConflictException('A user with this email already exists.');
      throw e;
    }
    await this.revokeAllRefreshTokens(userId);
    await insertAudit(this.users.manager, [auditRow('user', userId, {
      action: 'updated', entityLabel: user.name, field: 'email', fieldLabel: 'Email', oldValue: user.email, newValue: newEmail,
    })]);
    return { email: newEmail };
  }

  async issueTokens(user: User) {
    const { modules, permissions } = await this.rbac.resolveForUser(user.id);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      modules,
      permissions,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET', 'change_me_access'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '900s') as unknown as number,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'change_me_refresh'),
        expiresIn: this.config.get<string>('JWT_REFRESH_TTL', '30d') as unknown as number,
      },
    );

    const decoded = this.jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = new Date((decoded?.exp ?? 0) * 1000);
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt,
        revoked: false,
      }),
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        modules,
        permissions,
      },
    };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: number };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'change_me_refresh'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: this.hash(refreshToken), revoked: false },
    });
    if (!stored) throw new UnauthorizedException('Refresh token revoked');
    stored.revoked = true;
    await this.refreshTokens.save(stored);

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User not found');
    // Without this, disabling a user's account doesn't actually cut them off: they keep refreshing
    // this same still-valid refresh token into new 15-minute access tokens for up to its full 30-day
    // life. validateUser() (login) already checks this — refresh is the other place a disabled user's
    // access could otherwise renew itself, so it needs the same check.
    if (user.status !== 'Y') throw new UnauthorizedException('Account is disabled');
    return this.issueTokens(user);
  }

  async logout(refreshToken: string) {
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: this.hash(refreshToken) },
    });
    if (stored) {
      stored.revoked = true;
      await this.refreshTokens.save(stored);
    }
    return { success: true };
  }
}
