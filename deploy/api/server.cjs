'use strict';
/**
 * MAD Studio API launcher for IIS.
 *
 * The site is hosted by AspNetCoreModuleV2 in out-of-process mode, which starts
 * this file with node.exe and proxies requests to http://127.0.0.1:<ASPNETCORE_PORT>.
 * The API itself reads PORT and HOST, so this shim bridges the two and then loads
 * the esbuild bundle. Every other setting (DATABASE_URL, CORS_ORIGINS, NODE_ENV,
 * LOG_LEVEL, GENERATION_PACE) arrives through <environmentVariables> in web.config,
 * exactly as the .NET sites in the fleet receive theirs.
 */
const port = process.env.ASPNETCORE_PORT || process.env.PORT;
if (!port) {
  console.error('server.cjs: neither ASPNETCORE_PORT nor PORT is set; refusing to start.');
  process.exit(1);
}
process.env.PORT = port;
// Only the module talks to this listener; never expose it on the public NIC.
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

process.on('unhandledRejection', (error) => {
  console.error('server.cjs: unhandled rejection', error);
  process.exit(1);
});

require('./dist/main.js');
