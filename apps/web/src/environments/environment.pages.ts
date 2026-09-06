/**
 * GitHub Pages build. Pages serves static files only, so no API URL is
 * configured: the studio runs the planner in the browser and saves projects
 * locally ("Browser mode"). Point `apiUrl` at a hosted API to switch it on.
 * The base href is supplied by the deploy workflow from the Pages settings.
 */
export const environment = {
  production: true,
  apiUrl: '',
  siteUrl: 'https://studio.madproducts.ai',
} as const;
