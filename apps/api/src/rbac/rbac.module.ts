import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { ModuleEntity } from './entities/module.entity';
import { AppEntity } from './entities/app.entity';
import { GroupEntity } from './entities/group.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RbacService } from './rbac.service';
import { RbacController } from './rbac.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ModuleEntity, AppEntity, GroupEntity, PermissionEntity]),
  ],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService, TypeOrmModule],
})
export class RbacModule {}
