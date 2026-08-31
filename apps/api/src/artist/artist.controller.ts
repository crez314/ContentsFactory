import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import { CreateArtistDto, UpdateArtistDto } from '@cf/contracts';
import { Artist, Asset } from '@cf/domain';
import { AppError, MinRole } from '@cf/common';
import { zodBody } from '../common/zod.pipe';

@ApiTags('artists')
@Controller('artists')
export class ArtistController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  list() {
    return this.ds.getRepository(Artist).find({ order: { createdAt: 'ASC' } });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const artist = await this.ds.getRepository(Artist).findOne({ where: { id } });
    if (!artist) throw new AppError('NOT_FOUND', { message: '아티스트를 찾을 수 없습니다.' });
    const assetCount = await this.ds.getRepository(Asset).count({ where: { artistId: id, status: 'ACTIVE' } });
    return { ...artist, assetCount };
  }

  @Post()
  @MinRole('ADMIN')
  create(@Body(zodBody(CreateArtistDto)) dto: z.infer<typeof CreateArtistDto>) {
    return this.ds.getRepository(Artist).save(this.ds.getRepository(Artist).create({ ...dto, status: 'ACTIVE' }));
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(@Param('id') id: string, @Body(zodBody(UpdateArtistDto)) dto: z.infer<typeof UpdateArtistDto>) {
    const repo = this.ds.getRepository(Artist);
    const artist = await repo.findOne({ where: { id } });
    if (!artist) throw new AppError('NOT_FOUND', { message: '아티스트를 찾을 수 없습니다.' });
    Object.assign(artist, dto);
    return repo.save(artist);
  }

  /**
   * §4.1 Identity 기준값 — 대표 자산 N장을 기준 세트로 지정한다.
   * 임베딩 추출 자체는 워커가 수행하고 여기서는 키 목록만 확정한다.
   */
  @Post(':id/identity-refs')
  @MinRole('ADMIN')
  async setIdentityRefs(@Param('id') id: string, @Body() dto: { assetIds: string[] }) {
    const repo = this.ds.getRepository(Artist);
    const artist = await repo.findOne({ where: { id } });
    if (!artist) throw new AppError('NOT_FOUND', { message: '아티스트를 찾을 수 없습니다.' });

    const assets = await this.ds.getRepository(Asset).findByIds(dto.assetIds ?? []);
    if (!assets.length) throw new AppError('INVALID_INPUT', { message: '기준 자산을 1장 이상 지정해야 합니다.' });

    artist.identityRef = {
      refKeys: assets.map((a) => a.storageKey),
      vectorDim: 128,
      updatedAt: new Date().toISOString(),
    };
    return repo.save(artist);
  }
}
