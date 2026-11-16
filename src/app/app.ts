import { Component, computed, inject } from '@angular/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ProducerService } from './producer/producer-service';
import { STATUS_LABELS } from './producer/run-state';

interface NavLink {
  readonly path: string;
  readonly label: string;
}

@Component({
  selector: 'app-root',
  imports: [
    MatToolbar,
    MatTabNav,
    MatTabLink,
    MatTabNavPanel,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly producer = inject(ProducerService);

  protected readonly status = computed(() => this.producer.state().status);
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);

  protected readonly links: readonly NavLink[] = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/settings', label: 'Settings' },
  ];
}
