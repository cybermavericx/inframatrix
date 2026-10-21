import { Module } from '@nestjs/common';
import { DataController } from './data.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [DataController],
})
export class DataModule {}
