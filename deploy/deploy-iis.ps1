#requires -Version 5.1
<#
.SYNOPSIS
  Publish + IIS-bind MAD Studio (studio.madproducts.ai / studioapi.madproducts.ai).
  Mirrors the MAD fleet convention (love\deploy\deploy-iis.ps1, Mad.Deploy 1.1.0) for a product
  whose API is Node.js rather than .NET.

  Sites:    studio      (FE, static Angular 22)      -> https :8132 + https :443 SNI studio.madproducts.ai
            studioapi   (Node 24 / NestJS API)       -> https :9132 + https :443 SNI studioapi.madproducts.ai
  Pools:    studio-fe / studio-api                   (No Managed Code, OnDemand)
  Roots:    C:\inetpub\sites\studio / ...\studioapi
  API host: AspNetCoreModuleV2 out-of-process launching node.exe via server.cjs (ASPNETCORE_PORT -> PORT)
  DB:       PostgreSQL 18 on 127.0.0.1:5432, database mad_studio, role mad (password from deploy\.env.deploy)

  Run elevated (Administrator).
.PARAMETER SkipBuild    Reuse the existing apps\web\dist and apps\api\dist (skip ng build / esbuild).
.PARAMETER SkipInstall  Reuse the runtime node_modules already staged in apps\api\publish.
.PARAMETER SkipMigrate  Do not run database migrations and seed.
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration -ErrorAction SilentlyContinue
$madDeployManifest = Join-Path $PSScriptRoot 'modules\Mad.Deploy\1.1.0\Mad.Deploy.psd1'
Import-Module $madDeployManifest -Force -ErrorAction Stop
Assert-MadDeployModuleVersion -ExpectedVersion '1.1.0'

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  WARN $m" -ForegroundColor Yellow }

# Runs a native command with stderr noise tolerated (npm/ng write warnings to stderr, which
# ErrorActionPreference=Stop would otherwise turn into a terminating error) and gates on exit code.
function Invoke-Native([string]$Label, [string]$CommandLine, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        cmd /c $CommandLine 2>&1 | Write-Host
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $eap
        Pop-Location
    }
    if ($code -ne 0) { throw "$Label failed (exit $code)" }
}

# --- Deploy secrets: kept OUT of git (this script is tracked; the secrets are not) --------------
$AppDir  = Split-Path -Parent $PSScriptRoot          # repo root (deploy\ -> repo)
$envFile = Join-Path $PSScriptRoot '.env.deploy'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $k, $v = $line -split '=', 2
        [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), 'Process')
    }
}
$__required = @('MAD_STUDIO_DB_PASSWORD', 'MAD_STUDIO_ADMIN_PASSWORD')
$__missing  = $__required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($__missing) { throw "Missing deploy secret(s): $($__missing -join ', '). Set them in the untracked  deploy\.env.deploy  (copy deploy\.env.deploy.example)." }

# Refuse to run if the secrets file could be committed.
Push-Location $AppDir
try {
    & git check-ignore -q deploy/.env.deploy 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'deploy/.env.deploy is not ignored by git. Fix .gitignore before deploying.' }
} finally { Pop-Location }

# --- Product config ------------------------------------------------------------------------------
$Slug      = 'studio'
$Name      = 'MAD Studio'
$FePort    = 8132
$ApiPort   = 9132
$FeHost    = 'studio.madproducts.ai'
$ApiHost   = 'studioapi.madproducts.ai'

$WebDir     = Join-Path $AppDir 'apps\web'
$ApiDir     = Join-Path $AppDir 'apps\api'
$FeDist     = Join-Path $WebDir 'dist\web\browser'
$ApiBundle  = Join-Path $ApiDir 'dist\main.js'
$ApiPublish = Join-Path $ApiDir 'publish'          # staged runtime tree: server.cjs + dist\main.js + node_modules
$ShimSource = Join-Path $PSScriptRoot 'api\server.cjs'
$NodeExe    = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $NodeExe)) { throw "node.exe not found at $NodeExe" }

$IisSites  = 'C:\inetpub\sites'
$FeName    = $Slug;          $ApiName  = "${Slug}api"
$FePool    = "${Slug}-fe";   $ApiPool  = "${Slug}-api"
$FeRoot    = Join-Path $IisSites $FeName
$ApiRoot   = Join-Path $IisSites $ApiName

# Certs (shared with the rest of the MAD fleet)
$CertThumb     = 'EF5A3C3C8F28551330E02A08144AD7B678AE3C51'   # CN=209.58.145.5, store My (per-port https)
$HostCertThumb = (Get-ChildItem 'Cert:\LocalMachine\WebHosting' -EA SilentlyContinue |
    Where-Object { $_.Subject -match 'CN=madproducts\.ai' -and $_.NotAfter -gt (Get-Date) } |
    Sort-Object NotAfter -Descending | Select-Object -First 1 -ExpandProperty Thumbprint)
if (-not $HostCertThumb) { throw 'No valid CN=madproducts.ai certificate in Cert:\LocalMachine\WebHosting. Renew it first; without it Cloudflare answers 526.' }
$HostCertStore = 'WebHosting'
if (-not (Get-ChildItem 'Cert:\LocalMachine\My' | Where-Object { $_.Thumbprint -eq $CertThumb })) { throw "Per-port certificate $CertThumb not found in Cert:\LocalMachine\My." }

# Database (PostgreSQL). The password is alphanumeric by convention so it needs no URL escaping.
$DbUser      = 'mad'
$DbName      = 'mad_studio'
$DbPassword  = $env:MAD_STUDIO_DB_PASSWORD
if ($DbPassword -notmatch '^[A-Za-z0-9]{16,}$') { throw 'MAD_STUDIO_DB_PASSWORD must be at least 16 alphanumeric characters (it is embedded in a URL).' }
$DatabaseUrl = "postgres://${DbUser}:${DbPassword}@127.0.0.1:5432/${DbName}"

# Owner account seeded into the database (password re-hashed on every deploy).
$AdminEmail    = if ([string]::IsNullOrWhiteSpace($env:MAD_STUDIO_ADMIN_EMAIL)) { 'demo@madproducts.ai' } else { $env:MAD_STUDIO_ADMIN_EMAIL.Trim() }
$AdminPassword = $env:MAD_STUDIO_ADMIN_PASSWORD
if ($AdminPassword.Length -lt 10) { throw 'MAD_STUDIO_ADMIN_PASSWORD must be at least 10 characters.' }

# Optional model-backed planner. Empty key = deterministic planner only.
$AnthropicKey  = if ($null -eq $env:ANTHROPIC_API_KEY) { '' } else { $env:ANTHROPIC_API_KEY.Trim() }
$PlannerModel  = if ([string]::IsNullOrWhiteSpace($env:PLANNER_MODEL))  { 'claude-opus-5' } else { $env:PLANNER_MODEL.Trim() }
$PlannerEffort = if ([string]::IsNullOrWhiteSpace($env:PLANNER_EFFORT)) { 'medium' } else { $env:PLANNER_EFFORT.Trim() }

# Deployed sites: rendered by the API into the FE site root under /apps, served by IIS as static files.
$AppsRoot      = Join-Path $FeRoot 'apps'
$AppsPublicUrl = "https://$FeHost/apps"

# --- 1. Build FE -------------------------------------------------------------------------------------
if (-not $SkipBuild) {
    Step "Building Angular frontend (production, apiUrl -> https://$ApiHost/v1)"
    Invoke-Native -Label 'ng build' -CommandLine 'npx ng build --configuration production' -WorkingDirectory $WebDir
}
if (-not (Test-Path (Join-Path $FeDist 'index.html'))) { throw "FE dist not found at $FeDist (run without -SkipBuild)" }
if (Test-Path (Join-Path $FeDist '.nojekyll')) { throw 'FE dist is the GitHub Pages build (.nojekyll present). Run without -SkipBuild.' }
if (-not (Get-ChildItem (Join-Path $FeDist '*.js') | Select-String -Pattern "$ApiHost/v1" -Quiet)) {
    throw "FE bundle does not reference https://$ApiHost/v1. Check apps\web\src\environments\environment.production.ts."
}
if ((Get-Content (Join-Path $FeDist 'index.html') -Raw) -notmatch '<base href="/"') { throw 'FE index.html base href is not "/".' }
Ok "FE dist ready: $FeDist"

# --- 2. Bundle API + stage its runtime tree ---------------------------------------------------------
if (-not $SkipBuild) {
    Step 'Bundling API (esbuild -> apps\api\dist\main.js)'
    Invoke-Native -Label 'API bundle' -CommandLine 'node build.mjs' -WorkingDirectory $ApiDir
}
if (-not (Test-Path $ApiBundle)) { throw "API bundle not found at $ApiBundle (run without -SkipBuild)" }
if (-not (Select-String -Path $ApiBundle -Pattern 'loadDotEnv|readFileSync' -Quiet)) { Warn 'API bundle predates the .env loader; configuration must come from web.config (it does).' }

Step "Staging API runtime -> $ApiPublish"
New-Item -ItemType Directory -Force -Path (Join-Path $ApiPublish 'dist') | Out-Null
Copy-Item $ApiBundle (Join-Path $ApiPublish 'dist\main.js') -Force
if (Test-Path "$ApiBundle.map") { Copy-Item "$ApiBundle.map" (Join-Path $ApiPublish 'dist\main.js.map') -Force }
Copy-Item $ShimSource (Join-Path $ApiPublish 'server.cjs') -Force

# Runtime package.json: the bundle keeps npm packages external, so ship exactly the runtime
# dependencies (never the workspace packages, which esbuild inlines) pinned to the versions
# installed in the repo, then install them with --omit=dev in the staging tree.
$apiPkg      = Get-Content (Join-Path $ApiDir 'package.json') -Raw | ConvertFrom-Json
$runtimeDeps = [ordered]@{}
foreach ($dep in $apiPkg.dependencies.PSObject.Properties) {
    if ($dep.Name -like '@mad/*') { continue }
    $installed = Join-Path $AppDir "node_modules\$($dep.Name)\package.json"
    $version = if (Test-Path $installed) { (Get-Content $installed -Raw | ConvertFrom-Json).version } else { $dep.Value }
    $runtimeDeps[$dep.Name] = $version
}
$runtimePkg = [ordered]@{
    name         = 'mad-studio-api-runtime'
    version      = [string]$apiPkg.version
    private      = $true
    description  = 'Runtime dependencies for the IIS-hosted MAD Studio API. Generated by deploy\deploy-iis.ps1; do not edit.'
    dependencies = $runtimeDeps
}
[System.IO.File]::WriteAllText((Join-Path $ApiPublish 'package.json'), ($runtimePkg | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
if (-not $SkipInstall) {
    Invoke-Native -Label 'npm install (runtime)' -CommandLine 'npm install --omit=dev --no-audit --no-fund --no-package-lock --loglevel=error' -WorkingDirectory $ApiPublish
}
Invoke-Native -Label 'runtime resolve check' -CommandLine "`"$NodeExe`" -e `"['@nestjs/core','@nestjs/platform-express','drizzle-orm','postgres','helmet','rxjs','zod','reflect-metadata'].forEach(m=>require.resolve(m)); console.log('runtime modules resolve')`"" -WorkingDirectory $ApiPublish
Ok "API runtime staged ($($runtimeDeps.Count) packages)"

# --- 3. Database: migrations + seed (PostgreSQL) -----------------------------------------------------
if (-not $SkipMigrate) {
    Step 'Applying database migrations + seed (PostgreSQL mad_studio)'
    $env:DATABASE_URL = $DatabaseUrl      # real environment wins over apps\api\.env inside the migrator
    $env:SEED_ADMIN_EMAIL = $AdminEmail
    $env:SEED_ADMIN_PASSWORD = $AdminPassword
    Invoke-Native -Label 'db:migrate' -CommandLine 'npm run db:migrate --workspace apps/api' -WorkingDirectory $AppDir
    Invoke-Native -Label 'db:seed'    -CommandLine 'npm run db:seed --workspace apps/api'    -WorkingDirectory $AppDir
    $env:SEED_ADMIN_PASSWORD = $null
    Ok "Database migrated + seeded (owner account $AdminEmail)"
}

# --- 4. web.config (FE SPA rewrite + API AspNetCoreModuleV2 out-of-process launching node) --------
foreach ($d in @($FeRoot, $ApiRoot, (Join-Path $ApiRoot 'logs'))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$apiEnv = [ordered]@{
    'NODE_ENV'        = 'production'
    'HOST'            = '127.0.0.1'                 # the module proxies over loopback; never bind the public NIC
    'DATABASE_URL'    = $DatabaseUrl
    'CORS_ORIGINS'    = "https://$FeHost"
    'LOG_LEVEL'       = 'info'
    'GENERATION_PACE' = '1'
    'SESSION_TTL_DAYS'   = '30'
    'DEPLOY_EXPORT_ROOT' = $AppsRoot
    'DEPLOY_PUBLIC_BASE' = $AppsPublicUrl
    'PLANNER_MODEL'      = $PlannerModel
    'PLANNER_EFFORT'     = $PlannerEffort
}
# Always written, even when empty: an absent key would otherwise be preserved from the
# live web.config, so clearing it in deploy\.env.deploy could never take effect. Empty
# reads as "unset" in the API's environment schema, which disables the model planner.
$apiEnv['ANTHROPIC_API_KEY'] = $AnthropicKey
if (-not $AnthropicKey) { Warn 'ANTHROPIC_API_KEY not set in deploy\.env.deploy: the hosted API will use the deterministic planner.' }
# Operator-added variables in the live web.config survive a redeploy; the keys above are
# script-owned, and the secrets among them are never carried over from what is deployed.
$preserved = Get-MadWebConfigEnvironment -Path (Join-Path $ApiRoot 'web.config')
Merge-MadEnvironment -Configured $apiEnv -Preserved $preserved -Mode ConfiguredWins -ConfiguredOnlyKeys @('ANTHROPIC_API_KEY', 'DATABASE_URL') | Out-Null
$envXml = ConvertTo-MadEnvironmentXml -Environment $apiEnv -Indent 10

# PORT is deliberately absent: ANCM assigns the loopback port per launch (ASPNETCORE_PORT) and
# server.cjs maps it onto PORT. requestTimeout covers the API's server-sent event streams.
$apiWebConfig = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <location path="." inheritInChildApplications="false">
    <system.webServer>
      <handlers>
        <add name="aspNetCore" path="*" verb="*" modules="AspNetCoreModuleV2" resourceType="Unspecified" />
      </handlers>
      <aspNetCore processPath="$NodeExe" arguments=".\server.cjs"
                  hostingModel="outofprocess"
                  startupTimeLimit="120" requestTimeout="00:20:00"
                  stdoutLogEnabled="true" stdoutLogFile=".\logs\stdout">
        <environmentVariables>
$envXml
        </environmentVariables>
      </aspNetCore>
      <httpProtocol>
        <customHeaders>
          <add name="X-Content-Type-Options" value="nosniff" />
        </customHeaders>
      </httpProtocol>
    </system.webServer>
  </location>
</configuration>
"@

# Hashed bundles cache for a year; index.html and the un-hashed brand/manifest files do not.
$feWebConfig = @'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA-Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="SAMEORIGIN" />
        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
      </customHeaders>
    </httpProtocol>
    <staticContent>
      <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" />
    </staticContent>
  </system.webServer>
  <!-- index.html must never be cached: it references content-hashed bundles. -->
  <location path="index.html">
    <system.webServer>
      <staticContent>
        <clientCache cacheControlMode="DisableCache" />
      </staticContent>
    </system.webServer>
  </location>
  <!-- Sites published by the Deploy button live under /apps and are replaced in place: never cache. -->
  <location path="apps">
    <system.webServer>
      <staticContent><clientCache cacheControlMode="DisableCache" /></staticContent>
      <defaultDocument enabled="true"><files><clear /><add value="index.html" /></files></defaultDocument>
    </system.webServer>
  </location>
  <!-- Un-hashed assets: short cache so brand updates propagate within a day. -->
  <location path="brand">
    <system.webServer><staticContent><clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="1.00:00:00" /></staticContent></system.webServer>
  </location>
  <location path="icons">
    <system.webServer><staticContent><clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="1.00:00:00" /></staticContent></system.webServer>
  </location>
  <location path="site.webmanifest">
    <system.webServer><staticContent><clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="1.00:00:00" /></staticContent></system.webServer>
  </location>
  <location path="og-image.png">
    <system.webServer><staticContent><clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="1.00:00:00" /></staticContent></system.webServer>
  </location>
  <location path="favicon.ico">
    <system.webServer><staticContent><clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="1.00:00:00" /></staticContent></system.webServer>
  </location>
</configuration>
'@

# --- 5. Publish API: stop pool -> sync runtime tree -> web.config -> restart (always) ---------------
Step "Publishing API -> $ApiRoot"
$poolStopped = $false
try {
    if (Test-Path "IIS:\AppPools\$ApiPool") {
        Stop-MadAppPoolForPublish -Name $ApiPool
        $poolStopped = $true
        # The module stops w3wp; the node child it launched exits with it, but give it a moment and
        # make sure nothing still holds file locks under the site root. ANCM starts node with a
        # relative argument (.\server.cjs), so the child is identified by its executable path plus
        # the pool identity it runs as, not by its command line.
        $deadline = (Get-Date).AddSeconds(10)
        do {
            $lingering = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue | Where-Object {
                $owner = $_ | Invoke-CimMethod -MethodName GetOwner -EA SilentlyContinue
                $owner -and $owner.User -eq $ApiPool
            })
            if ($lingering.Count -eq 0) { break }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        foreach ($p in $lingering) { Stop-Process -Id $p.ProcessId -Force -EA SilentlyContinue }
    }
    Invoke-MadRobocopy -Source $ApiPublish -Destination $ApiRoot `
        -Arguments @('/MIR', '/XD', 'logs', '/XF', 'web.config', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/R:2', '/W:2') | Out-Null
    Write-MadWebConfig -Path (Join-Path $ApiRoot 'web.config') -Xml $apiWebConfig
    Ok 'API runtime synced + web.config written'
} finally {
    if ($poolStopped) { Restore-MadAppPool -Name $ApiPool | Out-Null }
}

# --- 6. Sync FE dist -> site root + web.config ------------------------------------------------------
Step "Syncing FE dist -> $FeRoot"
New-Item -ItemType Directory -Force -Path $AppsRoot | Out-Null
Invoke-MadRobocopy -Source $FeDist -Destination $FeRoot `
    -Arguments @('/MIR', '/XD', 'apps', '/XF', 'web.config', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/R:2', '/W:2') | Out-Null
Write-MadWebConfig -Path (Join-Path $FeRoot 'web.config') -Xml $feWebConfig
Ok 'FE synced + web.config written'

# --- 6b. Re-render already-published apps with this build's renderer ----------------------------------
# A deployment keeps the document it was built from, so a change to the exporter
# reaches pages that are already live instead of waiting for someone to press
# Deploy again. Without this, a fix to generated apps only applies to apps
# generated after the fix.
Step "Re-rendering published apps in $AppsRoot"
$republish = Join-Path $AppDir 'scripts\republish-apps.mjs'
if (Test-Path $republish) {
    Push-Location $AppDir
    try {
        & npx tsx $republish $AppsRoot '--studio-url' "https://$FeHost/studio"
        if ($LASTEXITCODE -ne 0) { throw "republish-apps.mjs exited with $LASTEXITCODE" }
        Ok 'Published apps re-rendered'
    } finally {
        Pop-Location
    }
} else {
    Warn "republish-apps.mjs not found; published apps keep their existing rendering"
}

# --- 7. App pools (No Managed Code, OnDemand) --------------------------------------------------------
foreach ($pool in @($FePool, $ApiPool)) {
    if (-not (Test-Path "IIS:\AppPools\$pool")) {
        New-WebAppPool -Name $pool | Out-Null
        Set-ItemProperty "IIS:\AppPools\$pool" -Name 'managedRuntimeVersion' -Value ''
        Set-ItemProperty "IIS:\AppPools\$pool" -Name 'startMode' -Value 'OnDemand'
        # Node boots in about a second, but an idle recycle mid-stream would drop a client, so the
        # API pool idles out later than the fleet's 5-minute .NET default.
        $idle = if ($pool -eq $ApiPool) { [TimeSpan]::FromMinutes(20) } else { [TimeSpan]::FromMinutes(5) }
        Set-ItemProperty "IIS:\AppPools\$pool" -Name 'processModel.idleTimeout' -Value $idle
        Ok "Pool $pool created"
    } else { Ok "Pool $pool exists" }
}

# --- 8. Sites -------------------------------------------------------------------------------------------
foreach ($site in @(
    [ordered]@{ name=$FeName;  pool=$FePool;  root=$FeRoot;  port=$FePort  },
    [ordered]@{ name=$ApiName; pool=$ApiPool; root=$ApiRoot; port=$ApiPort }
)) {
    if (-not (Get-Website -Name $site.name -EA SilentlyContinue)) {
        New-Website -Name $site.name -PhysicalPath $site.root -ApplicationPool $site.pool -Port $site.port -Ssl | Out-Null
        Ok "Site $($site.name) created on :$($site.port)"
    } else {
        Set-ItemProperty "IIS:\Sites\$($site.name)" -Name physicalPath -Value $site.root
        Set-ItemProperty "IIS:\Sites\$($site.name)" -Name applicationPool -Value $site.pool
        Ok "Site $($site.name) updated"
    }
}

# --- 9. ACLs --------------------------------------------------------------------------------------------
try {
    $acl = Get-Acl $FeRoot
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("IIS AppPool\$FePool", 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl $FeRoot $acl
    Ok "FE ACL set ($FePool ReadAndExecute)"
} catch { Warn "FE ACL: $_" }
try {
    foreach ($d in @($ApiRoot, $AppsRoot, "D:\madproducts-data\$Slug", "D:\madproducts-backups\$Slug")) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        $acl = Get-Acl $d
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("IIS AppPool\$ApiPool", 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
        Set-Acl $d $acl
    }
    Ok "API ACLs set ($ApiPool Modify, incl. $AppsRoot)"
} catch { Warn "API ACL: $_" }

# --- 10. HTTPS bindings (per-port cert + 443 SNI host cert) ------------------------------------------
foreach ($pb in @(
    [ordered]@{ Site=$FeName;  Port=$FePort  },
    [ordered]@{ Site=$ApiName; Port=$ApiPort }
)) {
    $b = Get-WebBinding -Name $pb.Site -Port $pb.Port -Protocol 'https' -EA SilentlyContinue
    if (-not $b) {
        New-WebBinding -Name $pb.Site -Protocol https -Port $pb.Port -IPAddress '*' | Out-Null
        $b = Get-WebBinding -Name $pb.Site -Port $pb.Port -Protocol 'https'
    }
    $b.AddSslCertificate($CertThumb, 'My') | Out-Null
    Ok "HTTPS :$($pb.Port) cert bound"
}
foreach ($hb in @(
    [ordered]@{ Site=$FeName;  Host=$FeHost  },
    [ordered]@{ Site=$ApiName; Host=$ApiHost }
)) {
    $b = Get-WebBinding -Name $hb.Site -Protocol 'https' -Port 443 -HostHeader $hb.Host -EA SilentlyContinue
    if (-not $b) {
        New-WebBinding -Name $hb.Site -Protocol https -Port 443 -IPAddress '*' -HostHeader $hb.Host -SslFlags 1 | Out-Null
        $b = Get-WebBinding -Name $hb.Site -Protocol 'https' -Port 443 -HostHeader $hb.Host
    }
    $b.AddSslCertificate($HostCertThumb, $HostCertStore) | Out-Null
    # Fatal on purpose: without the wildcard cert on this SNI name Cloudflare (Full strict) answers 526.
    if ((& netsh http show sslcert hostnameport="$($hb.Host):443" 2>$null | Out-String) -notmatch $HostCertThumb) {
        throw "sslcert for $($hb.Host):443 did not bind to $HostCertThumb (still self-signed -> Cloudflare 526)"
    }
    Ok "HTTPS SNI $($hb.Host):443 cert bound"
}

# --- 11. Start pools + verify ----------------------------------------------------------------------------
foreach ($pool in @($FePool, $ApiPool)) {
    try { if ((Get-WebAppPoolState -Name $pool).Value -ne 'Started') { Start-WebAppPool -Name $pool } } catch {}
}
foreach ($site in @($FeName, $ApiName)) {
    try { if ((Get-WebsiteState -Name $site).Value -ne 'Started') { Start-Website -Name $site } } catch {}
}
Ok 'Pools + sites started'

Write-Host ''
Step 'Verifying endpoints with bounded startup retries'
try {
    $feStatus = Wait-MadEndpoint -Uri "https://127.0.0.1:$FePort/" -TimeoutSeconds 180
    Ok "FE   https://127.0.0.1:$FePort/ -> HTTP $feStatus"
    $apiStatus = Wait-MadEndpoint -Uri "https://127.0.0.1:$ApiPort/v1/health" -TimeoutSeconds 180
    Ok "API  https://127.0.0.1:$ApiPort/v1/health -> HTTP $apiStatus"
    # A 2xx is not enough: the API answers 200 even when it fell back to the in-memory repository.
    $healthJson = & curl.exe -sk --max-time 30 "https://127.0.0.1:$ApiPort/v1/health"
    $health = $healthJson | ConvertFrom-Json
    if ($health.storage -ne 'postgres' -or -not $health.storageReachable -or $health.env -ne 'production') {
        throw "API health is not production/postgres: $healthJson"
    }
    Ok "API  storage=$($health.storage) reachable=$($health.storageReachable) env=$($health.env) version=$($health.version)"
    if ($health.deploy.mode -ne 'fleet' -or $health.deploy.publicBase -ne $AppsPublicUrl) { throw "API deploy target is not the fleet apps root: $healthJson" }
    Ok "API  planner=$($health.planner.mode)$(if ($health.planner.model) { " ($($health.planner.model))" }) deploys=$($health.deploy.publicBase)"
    # Auth must be enforced: an anonymous project list is a 401, not the seeded workspace.
    $anon = & curl.exe -sk -o NUL -w '%{http_code}' --max-time 30 "https://127.0.0.1:$ApiPort/v1/projects"
    if ($anon -ne '401') { throw "Expected 401 for anonymous /v1/projects, got $anon" }
    Ok 'API  anonymous access rejected (401)'
} catch {
    $log = Get-ChildItem (Join-Path $ApiRoot 'logs\stdout*') -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($log) { Write-Host "---- $($log.FullName) (tail) ----" -ForegroundColor Yellow; Get-Content $log.FullName -Tail 40 | Write-Host }
    throw
}

Write-Host ''
Write-Host 'Done. Public URLs (via Cloudflare/443 SNI):' -ForegroundColor Cyan
Write-Host "  FE : https://$FeHost   (origin https://209.58.145.5:$FePort, loopback check only)"
Write-Host "  API: https://$ApiHost  (origin https://209.58.145.5:$ApiPort, loopback check only)"
Write-Host "  Apps: $AppsPublicUrl/<slug>-<id>/  (written by the API to $AppsRoot)"
Write-Host "  Sign in as $AdminEmail with MAD_STUDIO_ADMIN_PASSWORD from deploy\.env.deploy"
