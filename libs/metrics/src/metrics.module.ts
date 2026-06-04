import { Global, Module } from '@nestjs/common';

import { CascadeMetricsService } from './cascade-metrics.service';
import { PrometheusRegistryService } from './prometheus-registry.service';

@Global()
@Module({
  providers: [PrometheusRegistryService, CascadeMetricsService],
  exports: [PrometheusRegistryService, CascadeMetricsService],
})
export class MetricsModule {}
