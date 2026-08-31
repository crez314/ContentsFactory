import { Module } from '@nestjs/common';
import { StorageService } from '@cf/storage';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { AuditService } from '../common/audit.service';

@Module({
  controllers: [AssetController],
  providers: [AssetService, StorageService, AuditService],
  exports: [AssetService],
})
export class AssetModule {}
