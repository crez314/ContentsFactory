import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { LoginDto, RefreshDto } from '@cf/contracts';
import { CurrentUser, Public, type AuthUser } from '@cf/common';
import { AuthService } from './auth.service';
import { zodBody } from '../common/zod.pipe';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '로그인 (이메일 + 비밀번호)' })
  login(@Body(zodBody(LoginDto)) dto: z.infer<typeof LoginDto>) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '토큰 회전 발급' })
  refresh(@Body(zodBody(RefreshDto)) dto: z.infer<typeof RefreshDto>) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: '로그아웃 (Refresh 폐기)' })
  async logout(@Body() dto: { refreshToken?: string }) {
    await this.auth.logout(dto?.refreshToken);
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: '현재 사용자' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
