import { Module } from '@nestjs/common';
import { StorageService } from '@cf/storage';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ApprovalService } from '@cf/orchestration';
import { AuditService } from '../common/audit.service';

@Module({
  controllers: [ContentController],
  providers: [ContentService, ApprovalService, StorageService, AuditService],
  exports: [ContentService, ApprovalService],
})
export class ContentModule {}
