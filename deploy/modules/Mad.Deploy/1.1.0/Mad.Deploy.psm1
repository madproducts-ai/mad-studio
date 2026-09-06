#requires -Version 5.1

Set-StrictMode -Version 2.0

$script:MadDeployVersion = '1.1.0'

# Every app pool this process stopped for a publish and has not restored yet.
# Keyed by pool name; the value is the state the pool was in BEFORE we stopped it.
$script:MadPendingPoolRestores = @{}

function New-MadUtf8NoBomEncoding {
    New-Object System.Text.UTF8Encoding($false)
}

function Assert-MadDeployModuleVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ExpectedVersion
    )

    if ($ExpectedVersion -ne $script:MadDeployVersion) {
        throw "Mad.Deploy version mismatch. Expected $ExpectedVersion, loaded $script:MadDeployVersion."
    }
}

function Test-MadFileHasBom {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    return ($bytes.Length -ge 3 -and
        $bytes[0] -eq 0xEF -and
        $bytes[1] -eq 0xBB -and
        $bytes[2] -eq 0xBF)
}

function Get-MadWebConfigEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [string]$IncludePattern = '.*'
    )

    $result = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $result
    }

    $xmlText = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    try {
        [xml]$document = $xmlText
    }
    catch {
        throw "Cannot preserve environment variables because '$Path' is not valid XML: $($_.Exception.Message)"
    }

    foreach ($node in @($document.SelectNodes("//*[local-name()='environmentVariable']"))) {
        $name = [string]$node.GetAttribute('name')
        if ([string]::IsNullOrWhiteSpace($name) -or $name -notmatch $IncludePattern) {
            continue
        }

        $result[$name] = [string]$node.GetAttribute('value')
    }

    return $result
}

function Merge-MadEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$Configured,

        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$Preserved,

        [ValidateSet('PreservedWins', 'ConfiguredWins', 'FillMissing')]
        [string]$Mode = 'PreservedWins',

        [string[]]$ConfiguredOnlyKeys = @()
    )

    foreach ($key in $Preserved.Keys) {
        if ($ConfiguredOnlyKeys -contains $key) {
            continue
        }

        $configuredContains = $Configured.Contains($key)
        switch ($Mode) {
            'PreservedWins' {
                $Configured[$key] = $Preserved[$key]
            }
            'ConfiguredWins' {
                if (-not $configuredContains) {
                    $Configured[$key] = $Preserved[$key]
                }
            }
            'FillMissing' {
                if (-not $configuredContains -or [string]::IsNullOrWhiteSpace([string]$Configured[$key])) {
                    $Configured[$key] = $Preserved[$key]
                }
            }
        }
    }

    return $Configured
}

function ConvertTo-MadEnvironmentXml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$Environment,

        [ValidateRange(0, 40)]
        [int]$Indent = 10
    )

    $padding = ' ' * $Indent
    $lines = foreach ($entry in $Environment.GetEnumerator()) {
        $name = [System.Security.SecurityElement]::Escape([string]$entry.Key)
        $value = [System.Security.SecurityElement]::Escape([string]$entry.Value)
        '{0}<environmentVariable name="{1}" value="{2}" />' -f $padding, $name, $value
    }

    return ($lines -join "`r`n")
}

function Assert-MadWebConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Xml,

        [switch]$RequireSeedAdminPassword,

        [string]$AdminPasswordEnvironmentName = 'SEED_ADMIN_PASSWORD',

        [string]$WeakSeedAdminPassword = 'ChangeMe_LocalDev_Only'
    )

    if ($Xml -match 'startupRetryCount') {
        throw 'web.config contains startupRetryCount, which is unsupported by the installed ANCM version.'
    }

    try {
        [xml]$document = $Xml
    }
    catch {
        throw "web.config is not valid XML: $($_.Exception.Message)"
    }

    if ($RequireSeedAdminPassword) {
        $seedNode = $document.SelectSingleNode(
            "//*[local-name()='environmentVariable' and @name='$AdminPasswordEnvironmentName']"
        )
        if ($null -eq $seedNode) {
            throw "web.config does not contain $AdminPasswordEnvironmentName."
        }

        $seedValue = [string]$seedNode.GetAttribute('value')
        if ([string]::IsNullOrWhiteSpace($seedValue) -or $seedValue -eq $WeakSeedAdminPassword) {
            throw 'web.config contains an empty or weak SEED_ADMIN_PASSWORD.'
        }
    }
}

function Write-MadWebConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$Xml,

        [switch]$RequireSeedAdminPassword,

        [string]$AdminPasswordEnvironmentName = 'SEED_ADMIN_PASSWORD'
    )

    Assert-MadWebConfig -Xml $Xml -RequireSeedAdminPassword:$RequireSeedAdminPassword `
        -AdminPasswordEnvironmentName $AdminPasswordEnvironmentName
    [System.IO.File]::WriteAllText($Path, $Xml, (New-MadUtf8NoBomEncoding))

    if (Test-MadFileHasBom -Path $Path) {
        throw "Mad.Deploy wrote an unexpected UTF-8 BOM to '$Path'."
    }
}

# ---------------------------------------------------------------------------
# Self-healing app-pool restore (1.1.0)
#
# 1.0.0 stopped the pool for the publish and left restarting it to the caller's
# happy path. Every fleet deploy script starts its pools ~250 lines later, after
# the web.config write, the FE robocopy, a best-effort Android build that can run
# for 600s, the DB grants, the ACLs and the HTTPS bindings. Anything that throws
# (or a Ctrl-C, or a killed session) in that window ends the script with the API
# pool STOPPED -- the live API 503s until a human notices. That is a real recorded
# fleet incident ("the killed-deploy -> Stopped-pool 503 gotcha").
#
# Three layers close it, weakest failure mode last:
#   1. Invoke-MadApiPublish starts the pool in a finally{} -- covers every throw in
#      a caller that has migrated to the folded publish.
#   2. A DETACHED watchdog process, started when the pool is stopped, waits for the
#      deploy process to exit and then restores the pool if the deploy never did.
#      This covers a throw, a Ctrl-C and a hard kill alike, including in the 21 apps
#      that still call Stop-MadAppPoolForPublish directly and have no finally{}.
#      A `PowerShell.Exiting` engine event was tried here first and REJECTED: the
#      live canary showed it does not run when `powershell -File` dies on an
#      unhandled terminating error, which is the single most likely way a deploy
#      fails. An out-of-process waiter has no such dependency on orderly teardown.
#   3. A durable breadcrumb per stopped pool, swept by the next Mad.Deploy run on
#      the box -- the backstop for a watchdog that was itself killed, or a reboot.
#      The sweep only touches breadcrumbs whose owning process is gone, so it can
#      never restart a pool a concurrent deploy is mid-publish on.
# ---------------------------------------------------------------------------

function Get-MadAppPoolRestoreRoot {
    [CmdletBinding()]
    param()

    $base = $env:ProgramData
    if ([string]::IsNullOrWhiteSpace($base)) {
        $base = [System.IO.Path]::GetTempPath()
    }

    return (Join-Path $base 'MADProducts\Mad.Deploy\pool-restore')
}

function Invoke-MadAppCmd {
    <#
      appcmd exits non-zero for an unknown pool, and PowerShell propagates the last
      native exit code as the process exit code when a script ends without an
      explicit `exit`. A probe inside this module must never decide a deploy
      script's exit status, so the caller's $LASTEXITCODE is restored afterwards.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $appcmd = Join-Path $env:SystemRoot 'System32\inetsrv\appcmd.exe'
    if (-not (Test-Path -LiteralPath $appcmd)) { return $null }

    # Set-StrictMode makes a bare read of an unset $global:LASTEXITCODE throw, and it
    # genuinely is unset until the session runs its first native command.
    $previous = (Get-Variable -Name 'LASTEXITCODE' -Scope Global -ErrorAction SilentlyContinue)
    try {
        $output = & $appcmd @Arguments 2>$null
        return $output
    }
    finally {
        if ($null -eq $previous) {
            Remove-Variable -Name 'LASTEXITCODE' -Scope Global -ErrorAction SilentlyContinue
        }
        else {
            Set-Variable -Name 'LASTEXITCODE' -Scope Global -Value $previous.Value
        }
    }
}

function Get-MadAppPoolState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $state = $null
    try {
        $state = [string](Get-WebAppPoolState -Name $Name -ErrorAction Stop).Value
    }
    catch {
        # WebAdministration is unavailable or read empty (a documented quirk on this
        # box); appcmd is the more reliable reader for app-pool attributes.
        $state = $null
    }

    if ([string]::IsNullOrWhiteSpace($state)) {
        $raw = Invoke-MadAppCmd -Arguments @('list', 'apppool', $Name, '/text:state')
        $state = [string]($raw | Select-Object -First 1)
    }

    if ([string]::IsNullOrWhiteSpace($state)) { return $null }
    return $state.Trim()
}

function Start-MadAppPool {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [ValidateRange(1, 120)]
        [int]$TimeoutSeconds = 30
    )

    $current = Get-MadAppPoolState -Name $Name
    if ($current -eq 'Started') { return $true }
    # A null state means IIS has no such pool. Waiting out the timeout on one cannot
    # succeed and would stall a deploy's finally{} for no reason.
    if ($null -eq $current) { return $false }

    try { Start-WebAppPool -Name $Name -ErrorAction Stop }
    catch {
        Invoke-MadAppCmd -Arguments @('start', 'apppool', "/apppool.name:$Name") | Out-Null
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if ((Get-MadAppPoolState -Name $Name) -eq 'Started') { return $true }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    return ((Get-MadAppPoolState -Name $Name) -eq 'Started')
}

function New-MadAppPoolRestorePoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [string]$PreviousState = 'Started'
    )

    $script:MadPendingPoolRestores[$Name] = $PreviousState

    $root = Get-MadAppPoolRestoreRoot
    if (-not (Test-Path -LiteralPath $root)) {
        New-Item -ItemType Directory -Path $root -Force | Out-Null
    }

    # The pool name is the file name, so a breadcrumb can only ever name a pool
    # Mad.Deploy itself stopped. Sanitize anyway: a pool name is caller-supplied.
    $safe = ($Name -replace '[^A-Za-z0-9._-]', '_')
    $path = Join-Path $root "$safe.json"
    $payload = [ordered]@{
        poolName      = $Name
        previousState = $PreviousState
        processId     = $PID
        createdUtc    = [DateTime]::UtcNow.ToString('o')
    }
    [System.IO.File]::WriteAllText($path, ($payload | ConvertTo-Json), (New-MadUtf8NoBomEncoding))
    Start-MadAppPoolRestoreWatchdog -Name $Name -CrumbPath $path
    return $path
}

function Start-MadAppPoolRestoreWatchdog {
    <#
      Launches a detached process that outlives this one, waits for it to exit, and
      restores the pool if the deploy never got around to it. Failing to start the
      watchdog is not fatal -- the breadcrumb sweep is the backstop.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$CrumbPath,

        [ValidateRange(1, 1440)]
        [int]$MaxMinutes = 180
    )

    $watchdog = Join-Path (Get-MadAppPoolRestoreRoot) 'restore-watchdog.ps1'
    $body = @'
param(
    [Parameter(Mandatory)][int]$OwnerPid,
    [Parameter(Mandatory)][string]$Pool,
    [Parameter(Mandatory)][string]$CrumbPath,
    [int]$MaxMinutes = 180
)

# Wait out the deploy that stopped the pool. A bounded wait so a wedged deploy
# cannot keep a watchdog resident on this shared box indefinitely.
$deadline = [DateTime]::UtcNow.AddMinutes($MaxMinutes)
while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -eq (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 2
}

# The deploy removed its own breadcrumb => it restored the pool itself. Nothing to do.
if (-not (Test-Path -LiteralPath $CrumbPath)) { exit 0 }

$record = $null
try { $record = Get-Content -LiteralPath $CrumbPath -Raw | ConvertFrom-Json } catch { }
if ($null -ne $record -and [string]$record.previousState -eq 'Stopped') {
    Remove-Item -LiteralPath $CrumbPath -Force -ErrorAction SilentlyContinue
    exit 0
}

$appcmd = Join-Path $env:SystemRoot 'System32\inetsrv\appcmd.exe'
if (Test-Path -LiteralPath $appcmd) {
    & $appcmd start apppool "/apppool.name:$Pool" 2>$null | Out-Null
    for ($i = 0; $i -lt 40; $i++) {
        $state = [string](& $appcmd list apppool $Pool /text:state 2>$null | Select-Object -First 1)
        if ($state.Trim() -eq 'Started') { break }
        Start-Sleep -Milliseconds 500
    }
}
Remove-Item -LiteralPath $CrumbPath -Force -ErrorAction SilentlyContinue
exit 0
'@

    try {
        [System.IO.File]::WriteAllText($watchdog, $body, (New-MadUtf8NoBomEncoding))
    }
    catch {
        Write-Warning "Mad.Deploy could not write the app-pool restore watchdog: $($_.Exception.Message)"
        return
    }

    $commandLine = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -OwnerPid {1} -Pool "{2}" -CrumbPath "{3}" -MaxMinutes {4}' -f `
        $watchdog, $PID, $Name, $CrumbPath, $MaxMinutes

    # Win32_Process.Create parents the new process to the WMI provider host, NOT to
    # this script. That matters: a killed deploy is usually killed with `taskkill /T`,
    # which walks the process TREE -- a Start-Process child would be killed alongside
    # the deploy it exists to clean up after. The live canary caught exactly that.
    $created = $false
    try {
        $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
            -Arguments @{ CommandLine = $commandLine } -ErrorAction Stop
        $created = ($null -ne $result -and [int]$result.ReturnValue -eq 0)
    }
    catch {
        $created = $false
    }

    if (-not $created) {
        # Degraded but better than nothing: an in-tree watchdog still covers a throw
        # and a Ctrl-C, and the breadcrumb sweep still covers the rest.
        try {
            Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', $watchdog,
                '-OwnerPid', $PID,
                '-Pool', $Name,
                '-CrumbPath', $CrumbPath,
                '-MaxMinutes', $MaxMinutes
            ) | Out-Null
        }
        catch {
            Write-Warning "Mad.Deploy could not start the app-pool restore watchdog for '$Name': $($_.Exception.Message)"
        }
    }
}

function Remove-MadAppPoolRestorePoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($script:MadPendingPoolRestores.Contains($Name)) {
        $script:MadPendingPoolRestores.Remove($Name)
    }

    $safe = ($Name -replace '[^A-Za-z0-9._-]', '_')
    $path = Join-Path (Get-MadAppPoolRestoreRoot) "$safe.json"
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

function Restore-MadAppPool {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $previous = 'Started'
    if ($script:MadPendingPoolRestores.Contains($Name)) {
        $previous = [string]$script:MadPendingPoolRestores[$Name]
    }

    $started = $true
    if ($previous -ne 'Stopped') {
        $started = Start-MadAppPool -Name $Name
    }

    # Only drop the breadcrumb once the pool is genuinely back up; a failed start
    # must stay recorded so the next run (or the operator) still sees it.
    if ($started) { Remove-MadAppPoolRestorePoint -Name $Name }
    return $started
}

function Resume-MadAppPoolRestorePoints {
    [CmdletBinding()]
    param(
        # Sweep breadcrumbs left by live processes too. Off by default: a live owner
        # is a concurrent deploy that is legitimately mid-publish on that pool.
        [switch]$IncludeLiveOwners
    )

    $root = Get-MadAppPoolRestoreRoot
    $restored = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $root)) { return $restored.ToArray() }

    foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
        $record = $null
        try { $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json }
        catch { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue; continue }

        $poolName = [string]$record.poolName
        if ([string]::IsNullOrWhiteSpace($poolName)) {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
            continue
        }

        # Sweep only what a DEAD deploy stranded. A live owner is a deploy that is
        # legitimately mid-publish on that pool -- including this process, whose own
        # pools are the caller's to restore via Restore-MadAppPool, not the sweep's.
        $ownerId = 0
        [void][int]::TryParse([string]$record.processId, [ref]$ownerId)
        if (-not $IncludeLiveOwners) {
            $owner = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
            if ($null -ne $owner) { continue }
        }

        if ([string]$record.previousState -eq 'Stopped') {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
            continue
        }

        if (Start-MadAppPool -Name $poolName) {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
            if ($script:MadPendingPoolRestores.Contains($poolName)) {
                $script:MadPendingPoolRestores.Remove($poolName)
            }
            $restored.Add($poolName) | Out-Null
        }
    }

    return $restored.ToArray()
}

function Stop-MadAppPoolForPublish {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [ValidateRange(1, 60)]
        [int]$GraceSeconds = 3
    )

    $poolPath = "IIS:\AppPools\$Name"
    if (-not (Test-Path $poolPath)) {
        return
    }

    # Heal anything a previously killed deploy stranded (any app on this box) before
    # taking this pool down, so an abandoned pool cannot outlive one deploy cycle.
    Resume-MadAppPoolRestorePoints | Out-Null

    $previousState = Get-MadAppPoolState -Name $Name
    if ([string]::IsNullOrWhiteSpace($previousState)) { $previousState = 'Started' }
    New-MadAppPoolRestorePoint -Name $Name -PreviousState $previousState | Out-Null

    try {
        Stop-WebAppPool -Name $Name -ErrorAction SilentlyContinue
    }
    catch {
        # The worker-process check below is the authoritative lock-release gate.
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($GraceSeconds)
    do {
        $workers = @(Get-CimInstance Win32_Process -Filter "Name='w3wp.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*$Name*" })
        if ($workers.Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    foreach ($worker in $workers) {
        # $workers is a snapshot from the last poll of the grace loop. A worker that exited between
        # that snapshot and this kill is the GOAL STATE, not a failure -- but Stop-Process
        # -ErrorAction Stop throws "Cannot find a process with the process identifier N" for it, and
        # this used to rethrow, failing the whole deploy for the one reason that means success.
        # Observed live on 2026-08-20 (developer): pool stopped cleanly, w3wp exited on its own,
        # deploy aborted mid-publish. The authoritative check is the $remaining re-scan below.
        if (-not (Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue)) { continue }
        try {
            Stop-Process -Id $worker.ProcessId -Force -ErrorAction Stop
        }
        catch {
            # Lost the race between the check above and the kill: still the goal state.
            if (Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue) {
                throw "Unable to stop IIS worker process $($worker.ProcessId) for app pool '$Name': $($_.Exception.Message)"
            }
        }
    }

    Start-Sleep -Milliseconds 500
    $remaining = @(Get-CimInstance Win32_Process -Filter "Name='w3wp.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$Name*" })
    if ($remaining.Count -gt 0) {
        throw "IIS worker processes for app pool '$Name' still hold deployment locks."
    }
}

function Invoke-MadDotNetPublish {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Project,

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [string]$Configuration = 'Release'
    )

    & dotnet publish $Project -c $Configuration -o $OutputPath --nologo | Write-Host
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "dotnet publish failed (exit $exitCode)."
    }
}

function Invoke-MadApiPublish {
    <#
    .SYNOPSIS
      The whole locked-DLL publish sequence as one call: snapshot the live env vars,
      stop the pool, publish, re-merge the snapshot, write a validated BOM-free
      web.config, and start the pool again.

    .DESCRIPTION
      Standards 2.2 (env preservation), 2.3 (stop before publish), 2.4 (no BOM),
      2.5 (no startupRetryCount), 2.6 (XML escaping) and 6.1 (seed admin password)
      are all ordering rules, and every app re-implemented that ordering by hand.
      Folding it here makes the order a property of the module instead of 22
      separate chances to get it wrong, and -- because the pool restart moves from
      the end of the caller's script into this function's finally{} -- the pool is
      down for the publish alone rather than for the rest of the deploy.

      WebConfigBuilder receives the already-escaped <environmentVariable> XML block
      and returns the complete web.config document, so the app-specific parts (the
      API DLL name, hosting model, logging) stay in the app's own script.

    .PARAMETER MergeMode
      ConfiguredWins (default) matches the fleet's established behaviour: the deploy
      script owns the keys it sets, and every other live env var survives a redeploy.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Project,

        [Parameter(Mandatory)]
        [string]$SiteRoot,

        [Parameter(Mandatory)]
        [string]$AppPool,

        [Parameter(Mandatory)]
        [System.Collections.IDictionary]$Environment,

        [Parameter(Mandatory)]
        [scriptblock]$WebConfigBuilder,

        [switch]$SkipPublish,

        [string]$Configuration = 'Release',

        [ValidateRange(0, 40)]
        [int]$EnvironmentIndent = 10,

        [ValidateSet('PreservedWins', 'ConfiguredWins', 'FillMissing')]
        [string]$MergeMode = 'ConfiguredWins',

        [switch]$RequireSeedAdminPassword
    )

    $webConfigPath = Join-Path $SiteRoot 'web.config'

    # 2.2: capture BEFORE the publish. `dotnet publish` regenerates web.config from
    # the SDK template and drops every previously-deployed secret, so a read after
    # the publish reads an already-emptied file.
    $preserved = Get-MadWebConfigEnvironment -Path $webConfigPath

    $poolStopped = $false
    try {
        if (-not $SkipPublish) {
            # 2.3: in-process ANCM holds an exclusive lock on the API DLL.
            Stop-MadAppPoolForPublish -Name $AppPool
            $poolStopped = $true
            Invoke-MadDotNetPublish -Project $Project -OutputPath $SiteRoot -Configuration $Configuration
        }

        Merge-MadEnvironment -Configured $Environment -Preserved $preserved -Mode $MergeMode | Out-Null

        # 2.6: ConvertTo-MadEnvironmentXml escapes < and > as well as & and ", which
        # the canonical seed password (<P@szw0rd>|<MP>) needs to survive at all.
        $envXml = ConvertTo-MadEnvironmentXml -Environment $Environment -Indent $EnvironmentIndent
        $xml = & $WebConfigBuilder $envXml
        if ([string]::IsNullOrWhiteSpace([string]$xml)) {
            throw 'WebConfigBuilder returned an empty web.config document.'
        }

        # 2.4/2.5/6.1 are asserted inside Write-MadWebConfig.
        Write-MadWebConfig -Path $webConfigPath -Xml ([string]$xml) `
            -RequireSeedAdminPassword:$RequireSeedAdminPassword
    }
    finally {
        # The publish is the only reason the pool was down. Bring it back even when
        # the publish or the web.config write threw, so a failed deploy leaves the
        # previous build serving instead of a Stopped pool nobody restarts.
        if ($poolStopped) { Restore-MadAppPool -Name $AppPool | Out-Null }
    }

    return [pscustomobject]@{
        AppPool          = $AppPool
        WebConfigPath    = $webConfigPath
        Published        = (-not $SkipPublish)
        PreservedEnvKeys = @($preserved.Keys)
    }
}

function Test-MadRobocopyExitCode {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [int]$Code
    )

    return ($Code -ge 0 -and $Code -lt 8)
}

function Invoke-MadRobocopy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Source,

        [Parameter(Mandatory)]
        [string]$Destination,

        [string[]]$Arguments = @()
    )

    & robocopy $Source $Destination @Arguments | Out-Null
    $exitCode = $LASTEXITCODE
    if (-not (Test-MadRobocopyExitCode -Code $exitCode)) {
        throw "robocopy failed for '$Source' -> '$Destination' (exit $exitCode)."
    }

    return $exitCode
}

function Wait-MadEndpoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [ValidateRange(1, 900)]
        [int]$TimeoutSeconds = 300,

        [ValidateRange(1, 120)]
        [int]$RequestTimeoutSeconds = 30,

        [ValidateRange(1, 30)]
        [int]$RetrySeconds = 5
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastDetail = 'No request attempted.'
    do {
        $output = & curl.exe -sk --max-time $RequestTimeoutSeconds -o NUL -w '%{http_code}' $Uri 2>&1
        $exitCode = $LASTEXITCODE
        $statusText = [string]($output | Select-Object -Last 1)
        $statusCode = 0
        if ([int]::TryParse($statusText.Trim(), [ref]$statusCode) -and
            $exitCode -eq 0 -and
            $statusCode -ge 200 -and
            $statusCode -lt 400) {
            return $statusCode
        }

        $lastDetail = "curl exit $exitCode, HTTP $statusText"
        if ([DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Seconds $RetrySeconds
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Endpoint '$Uri' did not become healthy within $TimeoutSeconds seconds ($lastDetail)."
}

function Test-MadDeployModule {
    [CmdletBinding()]
    param()

    $failures = New-Object System.Collections.Generic.List[string]
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('mad-deploy-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    try {
        $escaped = ConvertTo-MadEnvironmentXml -Environment ([ordered]@{
            'SEED_ADMIN_PASSWORD' = '<P@szw0rd>|<MP>'
            'QUOTES'              = '"single''&double"'
        })
        if ($escaped -notmatch '&lt;P@szw0rd&gt;\|&lt;MP&gt;') {
            $failures.Add('XML escaping did not preserve and encode the canonical seed password.')
        }
        if ($escaped -notmatch '&amp;') {
            $failures.Add('XML escaping did not encode ampersands.')
        }

        $apiXml = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <aspNetCore>
      <environmentVariables>
$escaped
      </environmentVariables>
    </aspNetCore>
  </system.webServer>
</configuration>
"@
        $webConfigPath = Join-Path $tempRoot 'web.config'
        Write-MadWebConfig -Path $webConfigPath -Xml $apiXml -RequireSeedAdminPassword
        if (Test-MadFileHasBom -Path $webConfigPath) {
            $failures.Add('Write-MadWebConfig emitted a UTF-8 BOM.')
        }

        $roundTrip = Get-MadWebConfigEnvironment -Path $webConfigPath
        if ($roundTrip['SEED_ADMIN_PASSWORD'] -ne '<P@szw0rd>|<MP>') {
            $failures.Add('Environment capture did not round-trip XML-sensitive data.')
        }

        $configured = [ordered]@{ A = 'new'; B = '' }
        $preserved = @{ A = 'old'; B = 'live'; C = 'extra' }
        Merge-MadEnvironment -Configured $configured -Preserved $preserved -Mode FillMissing | Out-Null
        if ($configured.A -ne 'new' -or $configured.B -ne 'live' -or $configured.C -ne 'extra') {
            $failures.Add('FillMissing environment merge precedence is incorrect.')
        }

        if (-not (Test-MadRobocopyExitCode 0) -or
            -not (Test-MadRobocopyExitCode 7) -or
            (Test-MadRobocopyExitCode 8) -or
            (Test-MadRobocopyExitCode 16)) {
            $failures.Add('Robocopy success-code handling is incorrect.')
        }

        try {
            Assert-MadWebConfig -Xml '<configuration><aspNetCore startupRetryCount="3" /></configuration>'
            $failures.Add('startupRetryCount was not rejected.')
        }
        catch {
            # Expected.
        }

        # --- 1.1.0: self-healing pool restore ----------------------------------
        # Exercised against a pool name that cannot exist, so the breadcrumb
        # lifecycle is verified without touching a real IIS pool on a shared box.
        $fakePool = 'mad-deploy-selftest-' + [guid]::NewGuid().ToString('N')
        $restoreRoot = Get-MadAppPoolRestoreRoot
        $crumb = New-MadAppPoolRestorePoint -Name $fakePool -PreviousState 'Started'
        try {
            if (-not (Test-Path -LiteralPath $crumb)) {
                $failures.Add('New-MadAppPoolRestorePoint did not write a durable breadcrumb.')
            }
            else {
                $record = Get-Content -LiteralPath $crumb -Raw | ConvertFrom-Json
                if ($record.poolName -ne $fakePool -or [int]$record.processId -ne $PID) {
                    $failures.Add('Pool restore breadcrumb did not record the pool name and owning process.')
                }
            }

            # A breadcrumb owned by a LIVE process must never be swept: that owner is a
            # concurrent deploy legitimately mid-publish on that pool.
            Resume-MadAppPoolRestorePoints | Out-Null
            if (-not (Test-Path -LiteralPath $crumb)) {
                $failures.Add('Resume swept a breadcrumb whose owning process is still alive.')
            }

            # A dead owner is the killed-deploy case and must be swept.
            $orphan = Join-Path $restoreRoot ('mad-deploy-orphan-' + [guid]::NewGuid().ToString('N') + '.json')
            $deadPid = 0
            for ($candidate = 90000; $candidate -lt 90200; $candidate += 4) {
                if ($null -eq (Get-Process -Id $candidate -ErrorAction SilentlyContinue)) { $deadPid = $candidate; break }
            }
            [System.IO.File]::WriteAllText($orphan, (([ordered]@{
                poolName      = 'mad-deploy-selftest-orphan'
                previousState = 'Stopped'   # Stopped => sweep must drop it without starting anything
                processId     = $deadPid
                createdUtc    = [DateTime]::UtcNow.ToString('o')
            }) | ConvertTo-Json), (New-MadUtf8NoBomEncoding))
            Resume-MadAppPoolRestorePoints | Out-Null
            if (Test-Path -LiteralPath $orphan) {
                $failures.Add('Resume did not sweep a breadcrumb left by a dead process.')
            }
        }
        finally {
            Remove-MadAppPoolRestorePoint -Name $fakePool
        }
        if (Test-Path -LiteralPath $crumb) {
            $failures.Add('Remove-MadAppPoolRestorePoint left the breadcrumb on disk.')
        }

        # Invoke-MadApiPublish must restore the pool even when the web.config write
        # throws -- that is the exact path that used to strand a Stopped pool.
        $publishRoot = Join-Path $tempRoot 'site'
        New-Item -ItemType Directory -Path $publishRoot -Force | Out-Null
        $restoreCalls = New-Object System.Collections.Generic.List[string]
        $threw = $false
        try {
            Invoke-MadApiPublish -Project 'unused.csproj' -SiteRoot $publishRoot `
                -AppPool 'mad-deploy-selftest-nonexistent' -Environment ([ordered]@{ A = '1' }) `
                -WebConfigBuilder { param($x) '<configuration><aspNetCore startupRetryCount="3" /></configuration>' } `
                -SkipPublish
        }
        catch { $threw = $true }
        if (-not $threw) {
            $failures.Add('Invoke-MadApiPublish accepted a web.config carrying startupRetryCount.')
        }
        if (Test-Path -LiteralPath (Join-Path $publishRoot 'web.config')) {
            $failures.Add('Invoke-MadApiPublish wrote an invalid web.config to disk.')
        }

        # Happy path: the merged env must contain both the configured and the
        # preserved keys, and the file must land BOM-free.
        $seedXml = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <location path="." inheritInChildApplications="false">
    <system.webServer>
      <aspNetCore>
        <environmentVariables>
          <environmentVariable name="OPERATOR_ADDED" value="keep-me" />
          <environmentVariable name="SEED_ADMIN_PASSWORD" value="&lt;P@szw0rd&gt;|&lt;MP&gt;" />
        </environmentVariables>
      </aspNetCore>
    </system.webServer>
  </location>
</configuration>
"@
        Write-MadWebConfig -Path (Join-Path $publishRoot 'web.config') -Xml $seedXml -RequireSeedAdminPassword
        $result = Invoke-MadApiPublish -Project 'unused.csproj' -SiteRoot $publishRoot `
            -AppPool 'mad-deploy-selftest-nonexistent' `
            -Environment ([ordered]@{ 'SEED_ADMIN_PASSWORD' = '<P@szw0rd>|<MP>'; 'ASPNETCORE_ENVIRONMENT' = 'Production' }) `
            -WebConfigBuilder {
                param($envBlock)
                @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <aspNetCore>
      <environmentVariables>
$envBlock
      </environmentVariables>
    </aspNetCore>
  </system.webServer>
</configuration>
"@
            } -SkipPublish -RequireSeedAdminPassword
        $finalEnv = Get-MadWebConfigEnvironment -Path (Join-Path $publishRoot 'web.config')
        if ($finalEnv['OPERATOR_ADDED'] -ne 'keep-me') {
            $failures.Add('Invoke-MadApiPublish did not preserve an operator-added env var across a publish.')
        }
        if ($finalEnv['ASPNETCORE_ENVIRONMENT'] -ne 'Production' -or $finalEnv['SEED_ADMIN_PASSWORD'] -ne '<P@szw0rd>|<MP>') {
            $failures.Add('Invoke-MadApiPublish lost a configured env var.')
        }
        if (Test-MadFileHasBom -Path (Join-Path $publishRoot 'web.config')) {
            $failures.Add('Invoke-MadApiPublish emitted a UTF-8 BOM.')
        }
        if ($result.Published) {
            $failures.Add('Invoke-MadApiPublish reported a publish despite -SkipPublish.')
        }
    }
    finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    if ($failures.Count -gt 0) {
        throw ("Mad.Deploy self-test failed:`r`n - " + ($failures -join "`r`n - "))
    }

    [pscustomobject]@{
        ModuleVersion = $script:MadDeployVersion
        Passed        = $true
        TestCount     = 17
    }
}

Export-ModuleMember -Function @(
    'Assert-MadDeployModuleVersion'
    'Assert-MadWebConfig'
    'ConvertTo-MadEnvironmentXml'
    'Get-MadAppPoolRestoreRoot'
    'Get-MadAppPoolState'
    'Get-MadWebConfigEnvironment'
    'Invoke-MadApiPublish'
    'Invoke-MadDotNetPublish'
    'Invoke-MadRobocopy'
    'Merge-MadEnvironment'
    'New-MadAppPoolRestorePoint'
    'Remove-MadAppPoolRestorePoint'
    'Restore-MadAppPool'
    'Resume-MadAppPoolRestorePoints'
    'Start-MadAppPool'
    'Stop-MadAppPoolForPublish'
    'Test-MadDeployModule'
    'Test-MadFileHasBom'
    'Test-MadRobocopyExitCode'
    'Wait-MadEndpoint'
    'Write-MadWebConfig'
)
