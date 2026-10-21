import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { ModuleEntity } from '../rbac/entities/module.entity';
import { GroupEntity } from '../rbac/entities/group.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, ModuleEntity, GroupEntity, RefreshToken])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
