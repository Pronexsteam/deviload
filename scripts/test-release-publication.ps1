# Exercises the actual workflow's notes arguments without contacting GitHub.
# Run with PowerShell 7; pass -Node when Node.js is not on PATH.
#Requires -Version 7.0
param([string]$Node = 'node')

$ErrorActionPreference = 'Stop'
$workflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\.github\workflows\release.yml')
$sourceLine = $workflow | Where-Object { $_ -match '^\s+\$source = ' } | Select-Object -First 1
$guardLine = $workflow | Where-Object { $_ -match '^\s+if \(\$LASTEXITCODE -ne 0\)' } | Select-Object -First 1
if (-not $sourceLine -or -not $guardLine) { throw 'Release publication arguments or exit-code guard not found' }
$assignment = [scriptblock]::Create($sourceLine.Trim())
$guard = [scriptblock]::Create($guardLine.Trim())
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('deviload-release-arguments-' + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $present = Join-Path $fixture 'release notes.md'
    [IO.File]::WriteAllText($present, 'Release notes')
    $cases = @(
        @{ Name = 'generated notes'; Path = (Join-Path $fixture 'absent notes.md'); Expected = @('--generate-notes') },
        @{ Name = 'notes file with spaces'; Path = $present; Expected = @('--notes-file', $present) }
    )
    foreach ($case in $cases) {
        $notes = $case.Path
        $source = $null
        . $assignment
        # A native process observes exactly what gh would receive through @source.
        $actual = & $Node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- @source
        if ($LASTEXITCODE -ne 0) { throw 'Native argument capture failed' }
        $expected = ConvertTo-Json -InputObject @($case.Expected) -Compress
        if ($actual -cne $expected) { throw "Unexpected native arguments for $($case.Name): $actual" }
        Write-Host "PASS: $($case.Name)"
    }
    $LASTEXITCODE = 0
    . $guard
    $LASTEXITCODE = 17
    $rejected = $false
    try { . $guard } catch { $rejected = $_.Exception.Message -match '17' }
    if (-not $rejected) { throw 'A failed gh command did not stop publication' }
    $LASTEXITCODE = 0
    Write-Host 'PASS: a failed gh command stops publication'
} finally {
    # Remove only this test's newly created, fully qualified temporary directory.
    if (Test-Path -LiteralPath $fixture) {
        $resolved = (Resolve-Path -LiteralPath $fixture).Path
        if ($resolved -ne [IO.Path]::GetFullPath($fixture)) { throw 'Unexpected temporary directory resolution' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
