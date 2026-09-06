#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$RequirePester
)

$ErrorActionPreference = 'Stop'
$manifest = Join-Path $PSScriptRoot 'modules\Mad.Deploy\1.1.0\Mad.Deploy.psd1'
Import-Module $manifest -Force -ErrorAction Stop

$selfTest = Test-MadDeployModule
Write-Host ("Mad.Deploy {0} self-test: PASS ({1} checks)" -f $selfTest.ModuleVersion, $selfTest.TestCount)

$invokePester = Get-Command Invoke-Pester -ErrorAction SilentlyContinue
if ($null -ne $invokePester) {
    $tests = Join-Path $PSScriptRoot 'modules\Mad.Deploy\Tests\Mad.Deploy.Tests.ps1'
    $result = Invoke-Pester -Script $tests -PassThru
    if ($result.FailedCount -gt 0) {
        throw "Pester failed $($result.FailedCount) Mad.Deploy test(s)."
    }
    Write-Host "Mad.Deploy Pester: PASS"
}
elseif ($RequirePester) {
    throw 'Pester is required but is not installed.'
}
else {
    Write-Warning 'Pester is not installed; portable self-tests passed.'
}
