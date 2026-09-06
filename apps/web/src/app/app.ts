import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme/theme.service';
import { ToastHost } from './core/ui/toast-host.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <mad-toast-host />
  `,
})
export class App {
  // Instantiated eagerly so the theme attribute is kept in sync from first render.
  private readonly theme = inject(ThemeService);
}
