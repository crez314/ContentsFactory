import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CreateOrderDto, PreviewCandidatesDto, UpdateOrderDto } from '@cf/contracts';
import { CurrentUser, MinRole, type AuthUser } from '@cf/common';
import { OrderService } from './order.service';
import { OrderValidatorService } from './order-validator.service';
import { zodBody } from '../common/zod.pipe';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly validator: OrderValidatorService,
  ) {}

  @Post()
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '오더 생성 (DRAFT)' })
  create(
    @Body(zodBody(CreateOrderDto)) dto: z.infer<typeof CreateOrderDto>,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.create(dto as never, user, idempotencyKey);
  }

  /**
   * §7.2 오더 생성 5단계의 실시간 후보 수 표시.
   * 오더를 만들기 전에도 호출할 수 있어야 하므로 별도 엔드포인트로 둔다.
   */
  @Post('preview-candidates')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '조건에 맞는 자산 수 실시간 조회' })
  preview(@Body(zodBody(PreviewCandidatesDto)) dto: z.infer<typeof PreviewCandidatesDto>) {
    return this.validator.previewCandidates(dto);
  }

  @Get()
  @ApiOperation({ summary: '오더 목록' })
  list(@Query() q: Record<string, string>) {
    return this.orders.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: '오더 상세 (선별 결과·진행률 포함)' })
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Patch(':id')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '오더 수정 (DRAFT/REJECTED 만)' })
  update(@Param('id') id: string, @Body(zodBody(UpdateOrderDto)) dto: z.infer<typeof UpdateOrderDto>) {
    return this.orders.update(id, dto as never);
  }

  @Post(':id/validate')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '사전 검증 (제출 없이 확인)' })
  validate(@Param('id') id: string) {
    return this.orders.validate(id);
  }

  @Post(':id/submit')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '제출 → 검증 → 큐 투입' })
  submit(@Param('id') id: string) {
    return this.orders.submit(id);
  }

  @Post(':id/cancel')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '오더 취소' })
  cancel(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.orders.cancel(id, body?.reason);
  }
}
