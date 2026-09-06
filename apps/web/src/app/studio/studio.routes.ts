import type { Routes } from '@angular/router';
import { RenderContext } from '../core/render/render-context';
import { StudioStore } from './state/studio.store';
import { StudioPage } from './studio.page';

export const STUDIO_ROUTES: Routes = [
  {
    path: '',
    providers: [RenderContext, StudioStore],
    children: [
      { path: '', component: StudioPage, title: 'Studio — MAD Studio' },
      { path: ':projectId', component: StudioPage, title: 'Studio — MAD Studio' },
    ],
  },
];
