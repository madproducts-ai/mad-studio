@{
    RootModule        = 'Mad.Deploy.psm1'
    ModuleVersion     = '1.1.0'
    GUID              = 'c9f11155-93f2-46af-a225-1b0b0f6f2ee2'
    Author            = 'MADProducts'
    CompanyName       = 'MADProducts'
    Copyright         = '(c) MADProducts. All rights reserved.'
    Description       = 'Audited IIS deployment primitives for the MADProducts fleet, with self-healing app-pool restore.'
    PowerShellVersion = '5.1'
    FunctionsToExport = @(
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
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
    PrivateData       = @{
        PSData = @{
            Tags       = @('MADProducts', 'IIS', 'Deployment')
            ProjectUri = 'https://github.com/madproducts-ai/template'
        }
    }
}
