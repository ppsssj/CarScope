# P2-A7 local evaluation: can the existing VehicleSvgRenderer draw the IONIQ 5 asset unchanged?
# Temporarily swaps vehicle-core's anatomy-car.parts for a model-derived ioniq5.parts, runs
# :vehicle-core:exportSvgSamples, copies the four state samples OUT of the repo, then restores the
# original resource and verifies its SHA-256. The swapped file is never committed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/eval-android-renderer.ps1 `
#     -Parts C:\CarScope-External\ioniq5-svg\ioniq5.parts -Out C:\CarScope-External\android-eval
param([Parameter(Mandatory = $true)][string]$Parts, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outFull = [System.IO.Path]::GetFullPath($Out)
if ($outFull.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Output must be outside the repository: $outFull" }
$res = Join-Path $repo 'vehicle-core\src\main\resources\io\carscope\visualization\anatomy-car.parts'
$before = (Get-FileHash $res -Algorithm SHA256).Hash
New-Item -ItemType Directory -Force $outFull | Out-Null
$backup = Join-Path $outFull 'anatomy-car.parts.orig'
Copy-Item $res $backup -Force
try {
  Copy-Item $Parts $res -Force
  Push-Location $repo
  try {
    & .\gradlew.bat -PcoreOnly=true :vehicle-core:exportSvgSamples --rerun-tasks --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'exportSvgSamples failed' }
  } finally { Pop-Location }
  Copy-Item (Join-Path $repo 'vehicle-core\build\validation\svg\*.svg') $outFull -Force
} finally {
  Copy-Item $backup $res -Force
  $after = (Get-FileHash $res -Algorithm SHA256).Hash
  if ($after -ne $before) { throw "RESTORE FAILED: anatomy-car.parts is $after, expected $before (backup: $backup)" }
  Write-Host "Restored anatomy-car.parts ($after)"
}
Get-ChildItem $outFull -Filter *.svg | ForEach-Object { Write-Host ("{0} {1} B" -f $_.Name, $_.Length) }
