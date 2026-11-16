import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { map, startWith } from 'rxjs';

import { ProducerService } from '../producer/producer-service';
import {
  DEFAULT_SETTINGS,
  type ProducerSettings,
  type SettingDefinition,
  settingError,
  type SettingKey,
  SETTINGS_SCHEMA,
} from '../producer/settings';

type SettingsForm = FormGroup<Record<SettingKey, FormControl<number | null>>>;

// Returns the schema's message as `{ setting: message }`.
function settingValidator(definition: SettingDefinition) {
  return (control: AbstractControl): ValidationErrors | null => {
    const error = settingError(definition, control.value);
    return error === null ? null : { setting: error };
  };
}

@Component({
  selector: 'app-settings-page',
  imports: [
    ReactiveFormsModule,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSuffix,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly producer = inject(ProducerService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly schema = SETTINGS_SCHEMA;

  // Starts with the applied settings; editing does not affect the producer until Apply.
  protected readonly form: SettingsForm = new FormGroup(
    Object.fromEntries(
      SETTINGS_SCHEMA.map((s) => [
        s.key,
        new FormControl<number | null>(this.producer.state().settings[s.key], settingValidator(s)),
      ]),
    ) as SettingsForm['controls'],
  );

  // The form value when it is valid, otherwise null.
  protected readonly validSettings = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => (this.form.valid ? (this.form.getRawValue() as ProducerSettings) : null)),
    ),
    { requireSync: true },
  );

  protected apply(): void {
    const settings = this.validSettings();
    if (settings === null) return;
    this.producer.apply(settings);
    this.snackBar.open(`Run #${this.producer.state().runId} started`, undefined, {
      duration: 3_000,
    });
  }

  protected reset(): void {
    this.form.setValue(DEFAULT_SETTINGS);
  }
}
