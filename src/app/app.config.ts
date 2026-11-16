import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { ProducerService } from './producer/producer-service';
import { DEFAULT_SETTINGS } from './producer/settings';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // The app opens with a paused run with the defaults; Resume starts generating.
    provideAppInitializer(() => inject(ProducerService).apply(DEFAULT_SETTINGS, { paused: true })),
  ],
};
