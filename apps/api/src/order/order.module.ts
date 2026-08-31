import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderValidatorService } from './order-validator.service';

@Module({
  controllers: [OrderController],
  providers: [OrderService, OrderValidatorService],
  exports: [OrderService, OrderValidatorService],
})
export class OrderModule {}
