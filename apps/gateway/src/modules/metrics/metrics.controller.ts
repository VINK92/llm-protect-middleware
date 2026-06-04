import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PrometheusRegistryService } from '@app/metrics';

@ApiTags('metrics')
@Controller({ path: 'v1/metrics', version: '1' })
export class MetricsController {
  constructor(private readonly registry: PrometheusRegistryService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.registry.scrape();
  }
}
