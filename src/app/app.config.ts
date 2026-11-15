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
    provideAppInitializer(() => inject(ProducerService).apply(DEFAULT_SETTINGS)),
  ],
};
