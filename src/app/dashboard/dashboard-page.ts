import { Component, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';

import { formatMetric, METRICS, type MetricId } from '../market/metrics';
import { ProducerService } from '../producer/producer-service';
import { STATUS_LABELS } from '../producer/run-state';

interface TableRow {
  readonly symbol: string;
  readonly cells: Readonly<Record<MetricId, string>>;
}

@Component({
  selector: 'app-dashboard-page',
  imports: [MatButton, MatCard, MatCardContent, MatTableModule],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly producer = inject(ProducerService);

  protected readonly state = this.producer.state;
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.state().status]);

  protected readonly metrics = METRICS;
  protected readonly columns = ['symbol', ...METRICS.map((m) => m.id)];

  protected readonly rows = computed<TableRow[]>(() =>
    this.producer.rows().map((row) => ({
      symbol: row.symbol,
      cells: Object.fromEntries(
        METRICS.map((m) => [m.id, formatMetric(row.metrics[m.id], m.format)]),
      ) as TableRow['cells'],
    })),
  );

  protected readonly actualRate = computed(() => {
    const rate = this.producer.actualRate();
    return rate === null ? null : Math.round(rate);
  });
  protected readonly nominalRate = computed(() => Math.round(this.producer.nominalRate()));

  // Not while a command waits for the worker.
  protected readonly canToggle = computed(() => {
    const { status, pending } = this.state();
    return !pending && (status === 'running' || status === 'paused');
  });

  protected readonly canRestart = computed(() => {
    const { status } = this.state();
    return status === 'running' || status === 'paused';
  });

  protected readonly trackBySymbol = (_: number, row: TableRow) => row.symbol;

  protected togglePause(): void {
    if (this.state().status === 'paused') this.producer.resume();
    else this.producer.pause();
  }
}
