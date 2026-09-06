/**
 * GitHub Pages build. Pages serves static files only, so no API URL is
 * configured: the studio runs the planner in the browser and saves projects
 * locally ("Browser mode"). Point `apiUrl` at a hosted API to switch it on.
 */
export const environment = {
  production: true,
  apiUrl: '',
  siteUrl: 'https://madproducts-ai.github.io/mad-studio',
} as const;
