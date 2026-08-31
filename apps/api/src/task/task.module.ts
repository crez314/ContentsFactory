import { Global, Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskFactory } from '@cf/orchestration';

@Global()
@Module({
  controllers: [TaskController],
  providers: [TaskService, TaskFactory],
  exports: [TaskFactory, TaskService],
})
export class TaskModule {}
