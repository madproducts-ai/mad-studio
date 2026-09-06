# Mad.Deploy

`Mad.Deploy` is the versioned, audited PowerShell deployment module used by every MADProducts
fleet app. Each app vendors the same immutable release under `deploy/modules/Mad.Deploy/<version>`
so its app-local deployment path remains self-contained.

The canonical release source is the `template` repository. A module change requires:

1. a new semantic version directory and manifest version;
2. portable self-tests plus Pester coverage;
3. identical module payloads in every declared fleet app;
4. a sequential live canary for every migrated app; and
5. a passing fleet adoption/guardrail run.

Run an app's tests with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\test-mad-deploy.ps1
```

Version 1.0.0 centralizes environment preservation helpers, XML-safe/BOM-free `web.config`
writes, IIS worker lock release, `dotnet publish` exit handling, robocopy's 0-7 success contract,
and bounded fatal endpoint verification.

Version 1.1.0 makes the app-pool stop **self-healing**, and folds the whole publish sequence into
one call:

- `Stop-MadAppPoolForPublish` now records a durable restore breadcrumb under
  `%ProgramData%\MADProducts\Mad.Deploy\pool-restore` and starts a **detached** watchdog (parented
  through `Win32_Process.Create`, so `taskkill /T` on the deploy does not take it with it) that waits
  for the deploy process to exit and restarts the pool if the deploy never did. The next Mad.Deploy
  run on the box sweeps any breadcrumb whose owning process is gone, as the backstop for a lost
  watchdog or a reboot. Before this, a deploy that threw or was killed after the stop left the live
  API pool **Stopped and 503-ing** until a human noticed.
- `Invoke-MadApiPublish` performs snapshot -> stop -> publish -> merge -> validated BOM-free
  `web.config` write -> start, with the pool restored in a `finally`. Standards 2.2/2.3/2.4/2.5/2.6
  and 6.1 are all *ordering* rules, so owning the order here removes 22 chances to get it wrong --
  and the pool is down for the publish alone instead of the rest of the deploy.

A `PowerShell.Exiting` engine event was tried for the restore and **rejected**: a live canary
(`_docs\mad-deploy-110-canary.ps1`) proved it does not run when `powershell -File` dies on an
unhandled terminating error, which is the most likely way a deploy fails. Re-run that canary (it uses
a throwaway pool with no site bound) after any change to the restore path.
