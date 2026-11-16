import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { DashboardPage } from './dashboard/dashboard-page';
import { provideFakeWorker } from './producer/fake-worker';
import { SettingsPage } from './settings/settings-page';

describe('App shell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideFakeWorker([])],
    });
  });

  it('renders navigation links to both pages', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav a'),
    );

    expect(links.map((a) => a.textContent?.trim())).toEqual(['Dashboard', 'Settings']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/settings']);
  });

  it('redirects the root URL to the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', DashboardPage);

    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('opens the settings page', async () => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/settings', SettingsPage);

    expect(page).toBeInstanceOf(SettingsPage);
  });

  it('redirects unknown URLs to the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/no-such-page', DashboardPage);

    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });
});
