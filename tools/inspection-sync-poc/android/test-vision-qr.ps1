<#
.SYNOPSIS
  Operator-only diagnosis of the AVD -> Vision service QR path (P22). Read-only by default.

.DESCRIPTION
  Checks, in order: AVD, Debug APK, Vision origin (endpoint file and the APK's compiled origin), /healthz,
  the private enrollment file, and - with the Vision service DB URL - the registration row, revocation, expiry,
  the proof against the stored hash (in memory only), schema and privileges.

  Live checks are separate approvals:
    -ApproveProvision  one POST /simulator/provision (writes one short-lived grant row on the Vision DB)
    -ApproveSession    with -ApproveProvision: one session created and cancelled at once (writes session rows)
  Each live check runs at most once a minute per serial.

  Never prints a proof, a stored hash, a grant, a session token or a database URL. The DB URL comes from
  PG_VISION_DATABASE_URL or a hidden prompt, is used through a read-only transaction, and is removed afterwards.
  Nothing is issued, revoked, deleted or changed on Render.

.EXAMPLE
  .\test-vision-qr.ps1 -Serial emulator-5554 -VisionOrigin https://carscope-vision-experiment.onrender.com -Schema carscope_vision -CaPemFile C:\CarScope-External\supabase\prod-ca-2021.crt
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Serial,
  [Parameter(Mandatory = $true)][string]$VisionOrigin,
  [Parameter(Mandatory = $true)][string]$Schema,
  [string]$Adb = 'C:\Android\Sdk\platform-tools\adb.exe',
  [string]$CaPemFile,
  [string]$StateDir = 'C:\CarScope-External\avd-vision',
  [string]$ReportDir = 'C:\CarScope-External\p22-avd-qr',
  [switch]$SkipDatabase,
  [switch]$SkipApkOrigin,
  [switch]$ApproveProvision,
  [switch]$ApproveSession
)
$ErrorActionPreference = 'Stop'

if ($VisionOrigin -cnotmatch '^https://[a-z0-9][a-z0-9-]*\.onrender\.com$') { throw 'VisionOrigin must be an exact Render HTTPS origin.' }
if ($Schema -cnotmatch '^[a-z_][a-z0-9_]{0,62}$') { throw 'Schema must be a plain PostgreSQL schema name.' }
if ($ApproveSession -and -not $ApproveProvision) { throw '-ApproveSession needs -ApproveProvision.' }
if (-not (Test-Path -PathType Leaf $Adb)) { throw "adb not found: $Adb" }

$Tool = Split-Path -Parent $PSScriptRoot
$OriginHost = ([Uri]$VisionOrigin).Host
$SerialName = $Serial -replace '[^A-Za-z0-9._-]', '_'
# P22: the state file is per origin; the older per-serial name is read only if no per-origin file exists.
$StateFile = Join-Path $StateDir ("registration-" + $SerialName + "-" + $OriginHost + ".json")
if (-not (Test-Path $StateFile)) { $StateFile = Join-Path $StateDir ("registration-" + $SerialName + ".json") }

$script:Owned = @()
function Set-Owned([string]$Name, [string]$Value) { Set-Item -Path "Env:$Name" -Value $Value; $script:Owned += $Name }

try {
  if (-not $SkipDatabase) {
    if (-not (Test-Path (Join-Path $Tool 'node_modules\pg'))) {
      throw "Run 'npm install --ignore-scripts --no-audit --no-fund --package-lock=false' in $Tool first, or pass -SkipDatabase."
    }
    if (-not $env:PG_VISION_DATABASE_URL) {
      $secure = Read-Host -AsSecureString 'Vision service DB URL, the role the Vision service uses (hidden; Enter to skip DB checks)'
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($plain) { Set-Owned 'PG_VISION_DATABASE_URL' $plain }
      } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $plain = $null }
    }
    if ($env:PG_VISION_DATABASE_URL -and -not $env:CARSCOPE_DB_CA_PEM_BASE64) {
      if (-not $CaPemFile -or -not (Test-Path -PathType Leaf $CaPemFile)) { throw 'Pass -CaPemFile with the database CA certificate (TLS is always verified).' }
      Set-Owned 'CARSCOPE_DB_CA_PEM_BASE64' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($CaPemFile)))
    }
  }

  New-Item -ItemType Directory -Force $ReportDir | Out-Null
  $report = Join-Path $ReportDir ('vision-qr-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.json')
  $arguments = @((Join-Path $Tool 'bin\vision-qr-diagnose.mjs'), '--serial', $Serial, '--origin', $VisionOrigin, '--schema', $Schema,
    '--adb', $Adb, '--report', $report, '--guard-dir', (Join-Path $ReportDir 'guard'))
  if (Test-Path $StateFile) { $arguments += @('--state-file', $StateFile) }
  if ($SkipApkOrigin) { $arguments += '--skip-apk-origin' }
  if ($ApproveProvision) { $arguments += '--approve-provision' }
  if ($ApproveSession) { $arguments += '--approve-session' }
  if ($SkipDatabase) { $arguments += '--no-database' }

  & node @arguments
  $code = $LASTEXITCODE
  Write-Output "Report (no secrets): $report"
  exit $code
} finally {
  foreach ($name in $script:Owned) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
}
