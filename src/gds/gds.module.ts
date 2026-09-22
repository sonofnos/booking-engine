import { Module } from '@nestjs/common';
import { FakeGdsClient, GdsClient } from './gds-client';

@Module({
  providers: [{ provide: GdsClient, useClass: FakeGdsClient }],
  exports: [GdsClient],
})
export class GdsModule {}
