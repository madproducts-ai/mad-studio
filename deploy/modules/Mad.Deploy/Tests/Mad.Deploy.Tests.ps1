$moduleManifest = Join-Path $PSScriptRoot '..\1.1.0\Mad.Deploy.psd1'
Import-Module $moduleManifest -Force -ErrorAction Stop

Describe 'Mad.Deploy 1.1.0' {
    It 'passes its portable self-test' {
        (Test-MadDeployModule).Passed | Should Be $true
    }

    It 'round-trips XML-sensitive environment values without a BOM' {
        $path = Join-Path $TestDrive 'web.config'
        $environment = [ordered]@{
            'SEED_ADMIN_PASSWORD' = '<P@szw0rd>|<MP>'
            'SPECIAL'             = 'a&b"c'
        }
        $environmentXml = ConvertTo-MadEnvironmentXml -Environment $environment
        $xml = @"
<configuration>
  <system.webServer>
    <aspNetCore>
      <environmentVariables>
$environmentXml
      </environmentVariables>
    </aspNetCore>
  </system.webServer>
</configuration>
"@

        Write-MadWebConfig -Path $path -Xml $xml -RequireSeedAdminPassword

        (Test-MadFileHasBom -Path $path) | Should Be $false
        (Get-MadWebConfigEnvironment -Path $path)['SPECIAL'] | Should Be 'a&b"c'
    }

    It 'accepts robocopy codes zero through seven and rejects eight or greater' {
        foreach ($code in 0..7) {
            (Test-MadRobocopyExitCode -Code $code) | Should Be $true
        }
        (Test-MadRobocopyExitCode -Code 8) | Should Be $false
        (Test-MadRobocopyExitCode -Code 16) | Should Be $false
    }

    It 'rejects unsupported ANCM startupRetryCount' {
        {
            Assert-MadWebConfig -Xml '<configuration><aspNetCore startupRetryCount="3" /></configuration>'
        } | Should Throw
    }

    It 'records a durable restore breadcrumb naming the pool and the owning process' {
        $pool = 'mad-deploy-pester-' + [guid]::NewGuid().ToString('N')
        $crumb = New-MadAppPoolRestorePoint -Name $pool -PreviousState 'Started'
        try {
            (Test-Path -LiteralPath $crumb) | Should Be $true
            $record = Get-Content -LiteralPath $crumb -Raw | ConvertFrom-Json
            $record.poolName | Should Be $pool
            ([int]$record.processId) | Should Be $PID
        }
        finally {
            Remove-MadAppPoolRestorePoint -Name $pool
        }
        (Test-Path -LiteralPath $crumb) | Should Be $false
    }

    It 'never sweeps a breadcrumb whose owning deploy is still running' {
        $pool = 'mad-deploy-pester-' + [guid]::NewGuid().ToString('N')
        $crumb = New-MadAppPoolRestorePoint -Name $pool -PreviousState 'Started'
        try {
            Resume-MadAppPoolRestorePoints | Out-Null
            (Test-Path -LiteralPath $crumb) | Should Be $true
        }
        finally {
            Remove-MadAppPoolRestorePoint -Name $pool
        }
    }

    It 'starts the pool again when the web.config write throws mid-publish' {
        # The stranded-pool bug: 1.0.0 stopped the pool and left the restart to the
        # caller's happy path, so any throw after the stop ended with a Stopped pool.
        $siteRoot = Join-Path $TestDrive 'api-site'
        New-Item -ItemType Directory -Path $siteRoot -Force | Out-Null

        # Pester 3 runs a -ModuleName mock inside the module's session state, so the
        # mocks record through a file rather than a closed-over variable.
        $marker = Join-Path $TestDrive 'restarted.txt'
        $env:MAD_DEPLOY_TEST_MARKER = $marker
        try {
            Mock -CommandName Stop-MadAppPoolForPublish -MockWith { } -ModuleName Mad.Deploy
            Mock -CommandName Invoke-MadDotNetPublish -MockWith { } -ModuleName Mad.Deploy
            Mock -CommandName Start-MadAppPool -MockWith {
                Add-Content -LiteralPath $env:MAD_DEPLOY_TEST_MARKER -Value $Name
                return $true
            } -ModuleName Mad.Deploy

            {
                Invoke-MadApiPublish -Project 'unused.csproj' -SiteRoot $siteRoot -AppPool 'pester-pool' `
                    -Environment ([ordered]@{ A = '1' }) `
                    -WebConfigBuilder { param($x) '<configuration><aspNetCore startupRetryCount="3" /></configuration>' }
            } | Should Throw

            (Test-Path -LiteralPath $marker) | Should Be $true
            ((Get-Content -LiteralPath $marker) -join ',') | Should Match 'pester-pool'
        }
        finally {
            Remove-Item Env:\MAD_DEPLOY_TEST_MARKER -ErrorAction SilentlyContinue
        }
    }

    It 'preserves an operator-added env var across a publish and keeps configured keys' {
        $siteRoot = Join-Path $TestDrive 'api-site-2'
        New-Item -ItemType Directory -Path $siteRoot -Force | Out-Null
        $seed = @"
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
        Write-MadWebConfig -Path (Join-Path $siteRoot 'web.config') -Xml $seed -RequireSeedAdminPassword

        Invoke-MadApiPublish -Project 'unused.csproj' -SiteRoot $siteRoot -AppPool 'pester-pool' `
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
            } -SkipPublish -RequireSeedAdminPassword | Out-Null

        $final = Get-MadWebConfigEnvironment -Path (Join-Path $siteRoot 'web.config')
        $final['OPERATOR_ADDED'] | Should Be 'keep-me'
        $final['ASPNETCORE_ENVIRONMENT'] | Should Be 'Production'
        $final['SEED_ADMIN_PASSWORD'] | Should Be '<P@szw0rd>|<MP>'
    }
}
