import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class PrometheusRegistryService implements OnModuleInit {
  readonly registry = new Registry();

  onModuleInit(): void {
    this.registry.setDefaultLabels({ app: 'llm-protect-gateway' });
    collectDefaultMetrics({ register: this.registry });
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }
}
