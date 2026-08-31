import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { BannedTermDto, MasterAttributeDto } from '@cf/contracts';
import { ATTRIBUTE_LABELS_KO, MasterAttributeValue, MasterBannedTerm } from '@cf/domain';
import { MinRole } from '@cf/common';
import { zodBody } from '../common/zod.pipe';

/** §7.1 설정 → 마스터 (속성 표준값 · 금지어) */
@ApiTags('master')
@Controller('master')
export class MasterController {
  constructor(private readonly ds: DataSource) {}

  @Get('attributes')
  async attributes() {
    const rows = await this.ds.getRepository(MasterAttributeValue).find({
      where: { active: true },
      order: { attribute: 'ASC', sortOrder: 'ASC' },
    });
    const grouped: Record<string, Array<{ id: string; value: string; labelKo: string | null }>> = {};
    for (const r of rows) {
      (grouped[r.attribute] ??= []).push({ id: r.id, value: r.value, labelKo: r.labelKo });
    }
    return { labels: ATTRIBUTE_LABELS_KO, attributes: grouped };
  }

  @Post('attributes')
  @MinRole('ADMIN')
  create(@Body(zodBody(MasterAttributeDto)) dto: z.infer<typeof MasterAttributeDto>) {
    const repo = this.ds.getRepository(MasterAttributeValue);
    return repo.save(repo.create({ ...dto, active: true }));
  }

  @Delete('attributes/:id')
  @MinRole('ADMIN')
  async deactivate(@Param('id') id: string) {
    // 기존 자산이 이 값을 쓰고 있을 수 있으므로 삭제 대신 비활성화한다.
    await this.ds.getRepository(MasterAttributeValue).update(id, { active: false });
    return { ok: true };
  }

  @Get('banned-terms')
  bannedTerms() {
    return this.ds.getRepository(MasterBannedTerm).find({ order: { category: 'ASC', term: 'ASC' } });
  }

  @Post('banned-terms')
  @MinRole('ADMIN')
  addTerm(@Body(zodBody(BannedTermDto)) dto: z.infer<typeof BannedTermDto>) {
    const repo = this.ds.getRepository(MasterBannedTerm);
    return repo.save(repo.create(dto));
  }

  @Delete('banned-terms/:id')
  @MinRole('ADMIN')
  async removeTerm(@Param('id') id: string) {
    await this.ds.getRepository(MasterBannedTerm).delete(id);
    return { ok: true };
  }
}
