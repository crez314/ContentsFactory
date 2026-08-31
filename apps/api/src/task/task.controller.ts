import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MinRole } from '@cf/common';
import { TaskService } from './task.service';

@ApiTags('tasks')
@Controller('tasks')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  @MinRole('OPERATOR')
  @ApiOperation({ summary: 'Task 목록 (상태·종류 필터)' })
  list(@Query() q: Record<string, string>) {
    return this.tasks.list(q);
  }

  @Get(':id')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: 'Task 상세 + 이벤트 이력' })
  findOne(@Param('id') id: string) {
    return this.tasks.findOne(id);
  }

  @Post(':id/retry')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '수동 재시도' })
  retry(@Param('id') id: string) {
    return this.tasks.retry(id);
  }

  @Post(':id/cancel')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: 'Task 취소' })
  cancel(@Param('id') id: string) {
    return this.tasks.cancel(id);
  }
}
