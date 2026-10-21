import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Id + name + email of active users, for the Point-of-Contact / Developers / recipients pickers.
   *  Any logged-in user may call it — the full /users list is an admin view (needs core.users read), so
   *  without this those dropdowns were empty for everyone but administrators. Declared before ':id'. */
  @Get('lookup')
  lookup() {
    return this.users.lookup();
  }

  @Get()
  @RequirePermission('read', 'core.users')
  list() {
    return this.users.list();
  }

  @Get(':id')
  @RequirePermission('read', 'core.users')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id);
  }

  @Post()
  @RequirePermission('create', 'core.users')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @RequirePermission('update', 'core.users')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  /** Admin remediation for "lost my authenticator device" — clears MFA for the given user(s). */
  @Post('mfa-reset')
  @RequirePermission('update', 'core.users')
  resetMfa(@Body() dto: { userIds: number[] }) {
    return this.users.resetMfa(dto.userIds ?? []);
  }

  @Delete(':id')
  @RequirePermission('delete', 'core.users')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.users.remove(id);
  }
}
