# CarScope external-source helper: fetch (or re-verify) the OpenX IONIQ 5 Blender source via Git LFS.
# Reads the upstream public repository only. Never uploads, commits, relicenses or redistributes the model.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/get-openx-source.ps1 -Destination C:\CarScope-External\openx-assets
#
# An existing clone is reused (LFS pull + verification) instead of being overwritten.
# P2-A6 fix: Blender 3+/5.x saves .blend Zstandard-compressed, so the first bytes are 28 B5 2F FD,
# not "BLENDER". The container is now classified from raw bytes and the decompressed data is
# verified by tools/ioniq5-asset/convert.mjs --check (Node.js >= 22.15, built-in zstd).
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($Destination)
$rel = 'src/vehicles/hyundai_ioniq_5_2022/hyundai_ioniq_5_2022.blend'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($target.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Destination must be outside the CarScope repository: $target" }

& git --version | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Git not available' }
& git lfs version | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Git LFS not installed: https://git-lfs.com' }

if (Test-Path $target) {
  $origin = (& git -C $target remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or $origin -notmatch 'vevalabs/openx-assets') { throw "Destination exists and is not an openx-assets clone; refusing to touch it: $target" }
  Write-Host "Reusing existing clone: $target ($origin)"
} else {
  & git clone --depth 1 https://github.com/vevalabs/openx-assets.git $target
  if ($LASTEXITCODE -ne 0) { throw 'Git clone failed' }
}
& git -C $target lfs pull --include='src/vehicles/hyundai_ioniq_5_2022/*' --exclude=''
if ($LASTEXITCODE -ne 0) { throw 'Git LFS pull failed' }

$blend = Join-Path $target ($rel -replace '/', '\')
if (-not (Test-Path $blend)) { throw "Blender source not found: $blend" }

# 1. Classify the container from raw bytes (no assumptions about corruption).
$stream = [System.IO.File]::OpenRead($blend)
try { $buf = New-Object byte[] 64; $n = $stream.Read($buf, 0, 64) } finally { $stream.Dispose() }
$hex = ($buf[0..([Math]::Min($n, 16) - 1)] | ForEach-Object { $_.ToString('X2') }) -join ' '
$ascii = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
if ($ascii.StartsWith('version https://git-lfs.github.com/spec/')) { $kind = 'GIT_LFS_POINTER' }
elseif ($ascii.StartsWith('BLENDER')) { $kind = 'BLEND_UNCOMPRESSED' }
elseif ($n -ge 4 -and $buf[0] -eq 0x28 -and $buf[1] -eq 0xB5 -and $buf[2] -eq 0x2F -and $buf[3] -eq 0xFD) { $kind = 'ZSTD' }
elseif ($n -ge 2 -and $buf[0] -eq 0x1F -and $buf[1] -eq 0x8B) { $kind = 'GZIP' }
else { $kind = 'UNKNOWN' }
Write-Host "First bytes: $hex  -> container $kind"
if ($kind -eq 'GIT_LFS_POINTER') { throw "Only the Git LFS pointer was retrieved, not the model: $blend" }
if ($kind -eq 'UNKNOWN') { throw "Unrecognised container; inspect the file before use: $blend" }

# 2. Compare with the LFS object id recorded in Git.
$size = (Get-Item $blend).Length
$sha = (Get-FileHash -Algorithm SHA256 $blend).Hash.ToLowerInvariant()
$lfs = (& git -C $target lfs ls-files -l | Where-Object { $_ -match [Regex]::Escape($rel) }) -join ''
$oid = if ($lfs -match '^([0-9a-f]{64})') { $Matches[1] } else { $null }
Write-Host "Size $size bytes, SHA-256 $sha, LFS oid $oid"
if (-not $oid -or $oid -ne $sha) { throw 'SHA-256 does not match the Git LFS object id' }

# 3. Decompress and parse the Blender structure (header, SDNA, ENDB) without Blender.
& node --version | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Node.js is required for decompression/structure checks' }
& node (Join-Path $PSScriptRoot 'convert.mjs') --check "--input=$blend"
if ($LASTEXITCODE -ne 0) { throw 'Blender structure check failed' }

Write-Host "SOURCE_VERIFIED: $blend" -ForegroundColor Green
Write-Host 'License: MPL-2.0 AND CC-BY-4.0 (see the .xoma copyrights). Keep the source and any derived GLB outside the CarScope repository.'
Write-Host 'Next: node tools/ioniq5-asset/convert.mjs --input=<blend> --out=C:\CarScope-External\ioniq5-carscope'
