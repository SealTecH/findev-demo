import { TestBed } from '@angular/core/testing';

import { emptyAggregate } from '../market/aggregator';
import { FakeWorker, provideFakeWorker } from '../producer/fake-worker';
import { ProducerService } from '../producer/producer-service';
import { DEFAULT_SETTINGS } from '../producer/settings';
import { DashboardPage } from './dashboard-page';

async function setup() {
  const workers: FakeWorker[] = [];
  TestBed.configureTestingModule({ providers: provideFakeWorker(workers) });
  const producer = TestBed.inject(ProducerService);
  producer.apply(DEFAULT_SETTINGS);
  const worker = workers[0];

  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;

  const text = (selector: string) => page.querySelector(selector)?.textContent?.trim();
  const cells = () =>
    Array.from(page.querySelectorAll('tr.mat-mdc-row')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );
  const toggle = () =>
    Array.from(page.querySelectorAll('button')).find((b) =>
      /Pause|Resume/.test(b.textContent ?? ''),
    )!;

  // Replies from the worker, then lets the page render.
  async function reply(...messages: Parameters<FakeWorker['reply']>[0][]) {
    messages.forEach((m) => worker.reply(m));
    await fixture.whenStable();
  }

  return { page, worker, text, cells, toggle, reply };
}

describe('DashboardPage', () => {
  it('waits for the producer, then shows one row per instrument with unavailable values', async () => {
    const { text, cells, reply } = await setup();
    expect(text('[data-testid="status"]')).toBe('Initializing');
    expect(text('.empty')).toBe('Waiting for the producer…');

    await reply(
      { type: 'ready' },
      { type: 'started', runId: 1, symbols: ['TKR001', 'TKR002'], state: 'running' },
    );
    expect(text('[data-testid="status"]')).toBe('Running');
    expect(cells()).toEqual([
      ['TKR001', '—', '—', '0', '—', '—'],
      ['TKR002', '—', '—', '0', '—', '—'],
    ]);
  });

  it('shows formatted metrics and generated totals from a snapshot', async () => {
    const { text, cells, reply } = await setup();
    await reply(
      { type: 'ready' },
      { type: 'started', runId: 1, symbols: ['TKR001'], state: 'running' },
      {
        type: 'snapshot',
        runId: 1,
        instruments: [
          {
            lastPriceCents: 10_002,
            bidCents: 10_000,
            askCents: 10_002,
            bidQuantity: 300,
            askQuantity: 100,
            volume: 30,
            notionalCents: 300_040n,
          },
        ],
        stats: { batches: 2, updates: 200, activeMs: 1_000 },
      },
    );
    expect(cells()).toEqual([['TKR001', '$100.02', '$0.02', '30', '$100.01', '+0.50']]);
    expect(text('[data-testid="generated"]')).toBe('200 updates in 2 batches');
  });

  it('Pause and Resume go to the worker and are blocked until it confirms', async () => {
    const { worker, toggle, reply } = await setup();
    await reply(
      { type: 'ready' },
      { type: 'started', runId: 1, symbols: ['TKR001'], state: 'running' },
    );

    toggle().click();
    await reply();
    expect(worker.lastSent()).toEqual({ type: 'pause', runId: 1 });
    expect(toggle().disabled).toBe(true);

    await reply({ type: 'status', runId: 1, state: 'paused' });
    expect(toggle().textContent?.trim()).toBe('Resume');
    toggle().click();
    expect(worker.lastSent()).toEqual({ type: 'resume', runId: 1 });
  });

  it('Restart run starts a new run with the same settings', async () => {
    const { worker, reply, page } = await setup();
    await reply(
      { type: 'ready' },
      { type: 'started', runId: 1, symbols: ['TKR001'], state: 'paused' },
    );
    const restart = Array.from(page.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Restart run'),
    )!;
    restart.click();
    expect(worker.lastSent()).toEqual({
      type: 'start',
      runId: 2,
      settings: DEFAULT_SETTINGS,
      paused: false,
    });
  });

  it('shows an error with Retry instead of the table', async () => {
    const { page, text, reply } = await setup();
    await reply({ type: 'error', runId: null, phase: 'init', message: 'Could not load Wasm' });

    expect(text('[data-testid="status"]')).toBe('Error');
    expect(text('.error-message')).toBe('Could not load Wasm');
    expect(page.querySelector('table')).toBeNull();
    expect(
      Array.from(page.querySelectorAll('button')).some((b) => b.textContent?.includes('Retry')),
    ).toBe(true);
  });

  it('keeps the values of instruments without updates', async () => {
    const { cells, reply } = await setup();
    await reply(
      { type: 'ready' },
      { type: 'started', runId: 1, symbols: ['TKR001'], state: 'running' },
      {
        type: 'snapshot',
        runId: 1,
        instruments: [emptyAggregate()],
        stats: { batches: 1, updates: 0, activeMs: 500 },
      },
    );
    expect(cells()).toEqual([['TKR001', '—', '—', '0', '—', '—']]);
  });
});
