param([switch]$Check)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$source = Join-Path $root 'native/DesktopLyricsHost.cs'
$target = Join-Path $root 'src/desktop-host.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x compiler is required' }
$refs = @('System.dll','System.Core.dll','System.Web.Extensions.dll','WPF/PresentationCore.dll','WPF/PresentationFramework.dll','WPF/WindowsBase.dll','System.Xaml.dll')
$arguments = @('/nologo','/target:winexe','/platform:anycpu','/optimize+','/utf8output',('/out:' + $target))
foreach ($ref in $refs) { $arguments += '/reference:' + (Join-Path $framework $ref) }
& $compiler @arguments $source
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Check) {
    $testDir = Join-Path $root 'tests/private/desktop-native'
    $process = Start-Process -FilePath $target -ArgumentList @('--self-test',('"' + $testDir + '"')) -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Native self-test timeout' }
    Get-Content -LiteralPath (Join-Path $testDir 'native-result.json') -Encoding UTF8
    if ($process.ExitCode -ne 0) { throw 'Native self-test failed' }
}
Get-FileHash -LiteralPath $target
