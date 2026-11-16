import { TestBed } from '@angular/core/testing';

import { FakeWorker, provideFakeWorker } from '../producer/fake-worker';
import { ProducerService } from '../producer/producer-service';
import { DEFAULT_SETTINGS } from '../producer/settings';
import { SettingsPage } from './settings-page';

async function setup() {
  const workers: FakeWorker[] = [];
  TestBed.configureTestingModule({ providers: provideFakeWorker(workers) });
  const producer = TestBed.inject(ProducerService);
  producer.apply(DEFAULT_SETTINGS);
  const apply = vi.spyOn(producer, 'apply');

  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;

  const inputs = () => Array.from(page.querySelectorAll<HTMLInputElement>('input'));
  const applyButton = () =>
    Array.from(page.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Apply')!;

  // Types into the n-th field and leaves it, as a user would.
  async function type(index: number, value: string) {
    const input = inputs()[index];
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  }

  return { producer, apply, fixture, page, inputs, applyButton, type };
}

describe('SettingsPage', () => {
  it('shows the applied settings and the nominal rate', async () => {
    const { inputs, page } = await setup();
    expect(inputs().map((i) => i.value)).toEqual(['5', '100', '500']);
    expect(page.querySelector('[data-testid="nominal-rate"]')?.textContent).toContain(
      '200 updates/s',
    );
  });

  it.each([
    [0, '0', 'Instrument count must be at least 1.'],
    [0, '51', 'Instrument count must be at most 50.'],
    [1, '2.5', 'Updates per batch must be a whole number.'],
    [2, '', 'Batch interval is required.'],
  ])('field %i = "%s" shows "%s" and disables Apply', async (index, value, message) => {
    const { page, applyButton, type } = await setup();
    await type(index, value);
    expect(page.querySelector('mat-error')?.textContent?.trim()).toBe(message);
    expect(applyButton().disabled).toBe(true);
    expect(page.querySelector('[data-testid="nominal-rate"]')?.textContent).toContain('—');
  });

  it('editing does not affect the producer', async () => {
    const { apply, type } = await setup();
    await type(0, '10');
    expect(apply).not.toHaveBeenCalled();
  });

  it('Apply starts a run with the entered numbers', async () => {
    const { apply, applyButton, type, producer } = await setup();
    await type(0, '3');
    await type(2, '50');
    applyButton().click();

    expect(apply).toHaveBeenCalledWith({
      instrumentCount: 3,
      updatesPerBatch: 100,
      intervalMs: 50,
    });
    expect(producer.state()).toMatchObject({ runId: 2, settings: { instrumentCount: 3 } });
  });

  it('Reset fills in the defaults without applying them', async () => {
    const { apply, inputs, type, page } = await setup();
    await type(1, '7');
    const reset = Array.from(page.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset'),
    )!;
    reset.click();

    expect(inputs().map((i) => i.value)).toEqual(['5', '100', '500']);
    expect(apply).not.toHaveBeenCalled();
  });
});
