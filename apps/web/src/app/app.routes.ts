import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'MAD Studio — Prompt to production in under 60 seconds',
    loadComponent: () => import('./landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'studio',
    title: 'Studio — MAD Studio',
    // The store and render context live at the route level so navigating from
    // /studio to /studio/:projectId after a build keeps the session intact.
    loadChildren: () => import('./studio/studio.routes').then((m) => m.STUDIO_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
