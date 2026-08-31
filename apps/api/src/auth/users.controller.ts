import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { z } from 'zod';
import * as bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { CreateUserDto, UpdateUserDto } from '@cf/contracts';
import { User } from '@cf/domain';
import { AppError, CurrentUser, MinRole, config, type AuthUser } from '@cf/common';
import { zodBody } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly ds: DataSource, private readonly audit: AuditService) {}

  @Get()
  @MinRole('ADMIN')
  async list() {
    const users = await this.ds.getRepository(User).find({ order: { createdAt: 'ASC' } });
    return users.map(({ passwordHash, ...u }) => u);
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Body(zodBody(CreateUserDto)) dto: z.infer<typeof CreateUserDto>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const repo = this.ds.getRepository(User);
    if (await repo.findOne({ where: { email: dto.email.toLowerCase() } })) {
      throw new AppError('CONFLICT', { message: '이미 존재하는 이메일입니다.' });
    }
    const user = repo.create({
      email: dto.email.toLowerCase(),
      name: dto.name,
      role: dto.role,
      passwordHash: await bcrypt.hash(dto.password, config.auth.bcryptCost),
      status: 'ACTIVE',
    });
    await repo.save(user);
    // §9.2 권한 변경은 감사 대상
    await this.audit.record({ actor, action: 'USER_CREATE', targetType: 'user', targetId: user.id, after: { role: dto.role }, ip: req.ip });
    const { passwordHash, ...safe } = user;
    return safe;
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(
    @Param('id') id: string,
    @Body(zodBody(UpdateUserDto)) dto: z.infer<typeof UpdateUserDto>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const repo = this.ds.getRepository(User);
    const user = await repo.findOne({ where: { id } });
    if (!user) throw new AppError('NOT_FOUND', { message: '사용자를 찾을 수 없습니다.' });

    const before = { role: user.role, status: user.status, name: user.name };
    if (dto.name) user.name = dto.name;
    if (dto.role) user.role = dto.role;
    if (dto.status) user.status = dto.status;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, config.auth.bcryptCost);
    await repo.save(user);

    await this.audit.record({
      actor, action: 'USER_UPDATE', targetType: 'user', targetId: id,
      before, after: { role: user.role, status: user.status, name: user.name }, ip: req.ip,
    });
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
