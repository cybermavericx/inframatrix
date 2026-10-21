import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User } from './entities/user.entity';
import { ModuleEntity } from '../rbac/entities/module.entity';
import { GroupEntity } from '../rbac/entities/group.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { auditRow, formatValue, humanizeField, insertAudit } from '../audit/audit.util';
import type { AuditLog } from '../audit/entities/audit-log.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ModuleEntity) private readonly modules: Repository<ModuleEntity>,
    @InjectRepository(GroupEntity) private readonly groups: Repository<GroupEntity>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  list() {
    return this.users.find({ relations: { modules: true, groups: true } });
  }

  lookup() {
    return this.users.find({ where: { status: 'Y' }, select: { id: true, name: true, email: true }, order: { name: 'ASC' } });
  }

  async findOne(id: number) {
    const user = await this.users.findOne({
      where: { id },
      relations: { modules: true, groups: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Look up an active user by email (used by the password-setup link flow). */
  findByEmail(email: string) {
    return this.users.findOne({ where: { email } });
  }

  private resolveModules(keys?: string[]) {
    if (!keys?.length) return Promise.resolve([] as ModuleEntity[]);
    return this.modules.find({ where: { key: In(keys) } });
  }

  private resolveGroups(keys?: string[]) {
    if (!keys?.length) return Promise.resolve([] as GroupEntity[]);
    return this.groups.find({ where: { key: In(keys) } });
  }

  /** Record account/security events on the user's own timeline. Never receives a password or secret —
   *  those are only ever described ("Password reset"), never logged by value. */
  logEvent(userId: number, label: string, messages: string[]) {
    return insertAudit(this.users.manager, messages.map((m) => auditRow('user', userId, { action: 'updated', entityLabel: label, message: m.slice(0, 255) })));
  }

  private static readonly MFA_GRACE_DAYS = 15;
  private static mfaDeadline(): Date {
    return new Date(Date.now() + UsersService.MFA_GRACE_DAYS * 24 * 60 * 60 * 1000);
  }

  async create(dto: CreateUserDto) {
    // Email is unique. Reject an active duplicate cleanly; re-activate a soft-deleted one
    // (so a removed user's email can be reused instead of throwing a raw 500).
    const existing = await this.users.findOne({ where: { email: dto.email }, withDeleted: true });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('A user with this email already exists.');
    }
    const rawPassword = dto.password ?? randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const modules = await this.resolveModules(dto.moduleKeys);
    const groups = await this.resolveGroups(dto.groupKeys);
    const mfaRequired = !!dto.mfaRequired;
    const mfaRequiredBy = mfaRequired ? UsersService.mfaDeadline() : null;

    let saved: User;
    if (existing) {
      existing.deletedAt = null; // clear the soft-delete so save() re-activates the row
      existing.name = dto.name;
      existing.password = passwordHash;
      existing.status = 'Y';
      existing.modules = modules;
      existing.groups = groups;
      existing.mfaRequired = mfaRequired;
      existing.mfaRequiredBy = mfaRequiredBy;
      saved = await this.users.save(existing);
    } else {
      saved = await this.users.save(
        this.users.create({
          name: dto.name, email: dto.email, password: passwordHash, modules, groups,
          mfaRequired, mfaRequiredBy,
        }),
      );
    }
    await insertAudit(this.users.manager, [auditRow('user', saved.id, { action: 'created', entityLabel: saved.name, message: `Created user ${saved.name} <${saved.email}>` })]);
    const result = await this.findOne(saved.id);
    return { ...result, generatedPassword: dto.password ? undefined : rawPassword };
  }

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.findOne(id);
    const before = {
      name: user.name, email: user.email, status: user.status, mfaRequired: user.mfaRequired,
      modules: user.modules.map((m) => m.key).sort().join(', '),
      groups: user.groups.map((g) => g.key).sort().join(', '),
    };
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.status !== undefined) user.status = dto.status;
    if (dto.password) user.password = await bcrypt.hash(dto.password, 10);
    if (dto.moduleKeys !== undefined) user.modules = await this.resolveModules(dto.moduleKeys);
    if (dto.groupKeys !== undefined) user.groups = await this.resolveGroups(dto.groupKeys);
    if (dto.mfaRequired !== undefined) {
      if (dto.mfaRequired && !user.mfaRequired) {
        // Only start the 15-day clock the first time this flips on — an unrelated later edit
        // must never reset an already-running deadline.
        user.mfaRequiredBy = UsersService.mfaDeadline();
      } else if (!dto.mfaRequired) {
        user.mfaRequiredBy = null;
      }
      user.mfaRequired = dto.mfaRequired;
    }
    try {
      await this.users.save(user);
    } catch (e) {
      const code = (e as { code?: string; driverError?: { code?: string } }).code
        ?? (e as { driverError?: { code?: string } }).driverError?.code;
      if (code === 'ER_DUP_ENTRY') throw new ConflictException('A user with this email already exists.');
      throw e;
    }
    const rows: Partial<AuditLog>[] = [];
    const field = (k: string, label: string, from: unknown, to: unknown) => {
      if (formatValue(from) !== formatValue(to)) {
        rows.push(auditRow('user', id, { action: 'updated', entityLabel: user.name, field: k, fieldLabel: label, oldValue: formatValue(from), newValue: formatValue(to) }));
      }
    };
    field('name', humanizeField('name'), before.name, user.name);
    field('email', humanizeField('email'), before.email, user.email);
    field('status', 'Active (Y/N)', before.status, user.status);
    field('mfaRequired', 'Two-factor required', before.mfaRequired, user.mfaRequired);
    field('modules', 'Modules', before.modules, user.modules.map((m) => m.key).sort().join(', '));
    field('groups', 'Groups', before.groups, user.groups.map((g) => g.key).sort().join(', '));
    if (dto.password) rows.push(auditRow('user', id, { action: 'updated', entityLabel: user.name, message: 'Password changed by an administrator' }));
    await insertAudit(this.users.manager, rows);
    return this.findOne(id);
  }

  async remove(id: number) {
    const gone = await this.users.findOne({ where: { id } });
    await this.users.softDelete(id);
    if (gone) await insertAudit(this.users.manager, [auditRow('user', id, { action: 'deleted', entityLabel: gone.name, message: `Deleted user ${gone.name} <${gone.email}>` })]);
    return { success: true };
  }

  /**
   * Admin remediation for "lost my authenticator device" — clears the actual MFA factor for each
   * given user. If they're under the required-by-policy, also gives them a fresh 15-day window
   * instead of leaving mfaRequiredBy in the past (which would otherwise immediately re-block them
   * the moment they log back in, right after an admin just helped them get unstuck).
   *
   * Also revokes the user's existing sessions (refresh tokens): "lost my phone" often really means
   * "someone else may have my phone", and a stolen device could carry an already-issued, still-valid
   * session that MFA-reset alone wouldn't touch — clearing the factor without ending that session would
   * leave the actual access an attacker had untouched.
   */
  async resetMfa(userIds: number[]) {
    const results: { userId: number; email: string | null; error?: string }[] = [];
    for (const id of [...new Set(userIds)]) {
      const user = await this.users.findOne({ where: { id } });
      if (!user) { results.push({ userId: id, email: null, error: 'User not found' }); continue; }
      await this.users.update(id, {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        ...(user.mfaRequired ? { mfaRequiredBy: UsersService.mfaDeadline() } : {}),
      });
      await this.refreshTokens.update({ userId: id, revoked: false }, { revoked: true });
      await this.logEvent(id, user.name, ['Two-factor authentication reset by an administrator (sessions signed out)']);
      results.push({ userId: id, email: user.email });
    }
    return { results };
  }
}
