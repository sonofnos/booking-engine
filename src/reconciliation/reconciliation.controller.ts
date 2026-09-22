import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ReconciliationService, SettlementLine } from './reconciliation.service';

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('batches')
  load(@Body() body: { lines: SettlementLine[] }) {
    return this.reconciliationService.loadSettlementBatch(body.lines);
  }

  @Get('batches/:id/report')
  report(@Param('id') id: string) {
    return this.reconciliationService.reconcile(id);
  }
}
