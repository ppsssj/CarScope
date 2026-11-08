<#
.SYNOPSIS
  Operator-only setup of one approved Pleos AVD for the mobile inspection flow.

.DESCRIPTION
  Install   Checks that Render already runs the operator-approved simulation mode, issues a short-lived
            enrollment through bin/avd-simulator-admin.mjs, and writes sync-endpoint.json and the enrollment
            into the Debug app's private files. The local copy of the proof is deleted afterwards.
  Endpoint  Writes only the non-secret sync-endpoint.json.
  Status    Reads the mode and the file permissions and sizes. Never reads file contents.
  Remove    Revokes the registration and deletes the enrollment from the device.

  This never changes Render, never proves a real vehicle or its owner, and never prints or passes a secret on a
  command line. The database URL comes from PG_ADMIN_DATABASE_URL or a hidden prompt. Use the carscope_app
  Session Pooler URL: that role owns the schema, and the tool creates the cs_avd_* tables there when they are missing.

.EXAMPLE
  .\setup-avd-simulator.ps1 -Serial emulator-5554 -CaPemFile C:\CarScope-External\supabase-ca.pem
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Serial,
  [ValidateSet('Install', 'Endpoint', 'Status', 'Remove')][string]$Action = 'Install',
  [string]$Adb = 'C:\Android\Sdk\platform-tools\adb.exe',
  [string]$Label = 'CarScope_Pleos_API34',
  [ValidateRange(1, 24)][int]$Hours = 2,
  [string]$CaPemFile,
  [string]$Schema = 'carscope',
  [string]$StateDir = 'C:\CarScope-External\avd-simulator',
  [string]$GlbPath,
  [string]$VisionOrigin
)
$ErrorActionPreference = 'Stop'

# Must stay equal to AvdSimulatorPolicy.API_ORIGIN: the app accepts no other origin for this mode.
$Origin = 'https://carscope-lluo.onrender.com'
if ($VisionOrigin) {
  if ($VisionOrigin -cnotmatch '^https://[a-z0-9][a-z0-9-]*\.onrender\.com$' -or $VisionOrigin -eq $Origin) {
    throw 'VisionOrigin must be a separate exact Render HTTPS origin'
  }
  # The installed Debug APK must have been built with -PcarscopeVisionOrigin equal to this origin.
  $Origin = $VisionOrigin
}
$Package = 'io.carscope.app'
$EndpointFile = 'sync-endpoint.json'
$EnrollmentFile = 'avd-simulator-enrollment.json'
if ($VisionOrigin) { $EnrollmentFile = 'avd-vision-enrollment.json' }
$Tool = Split-Path -Parent $PSScriptRoot
$Repository = Split-Path -Parent (Split-Path -Parent $Tool)
$StateFile = Join-Path $StateDir ("registration-" + ($Serial -replace '[^A-Za-z0-9._-]', '_') + ".json")

function Get-AndroidUser {
  $value = & $Adb -s $Serial shell am get-current-user
  if ($LASTEXITCODE -ne 0 -or -not ("$value".Trim() -match '^\d+$')) { throw "Cannot read the current Android user on $Serial." }
  return "$value".Trim()
}

function Assert-DebugApp([string]$User) {
  & $Adb -s $Serial shell "run-as $Package --user $User true" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "run-as failed. Install the Debug APK for user $User. Do not uninstall: that deletes the private files." }
}

# Content travels on stdin only. PowerShell 5.1 appends CRLF, which the app's JSON parser accepts.
# A UTF-8 console input encoding makes this pipe start with a BOM, which is not JSON. Both files are pure ASCII.
function Set-PrivateFile([string]$User, [string]$Name, [string]$Content, [int]$MaxBytes) {
  $consoleEncoding = [Console]::InputEncoding
  [Console]::InputEncoding = New-Object System.Text.ASCIIEncoding
  try {
    $Content | & $Adb -s $Serial shell "run-as $Package --user $User sh -c 'umask 077; mkdir -p files; cat > files/$Name && chmod 600 files/$Name'" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Writing $Name failed." }
  } finally { [Console]::InputEncoding = $consoleEncoding }
  $shape = Get-PrivateFileShape $User $Name
  if ($shape -notmatch '^600:(\d+)$' -or [int]$Matches[1] -lt 1 -or [int]$Matches[1] -gt $MaxBytes) { throw "$Name has an unexpected mode or size: $shape" }
  $first = & $Adb -s $Serial shell "run-as $Package --user $User head -c 1 files/$Name"
  if ("$first".Trim() -ne '{') { throw "$Name does not start with a JSON object." }
}

# No space or quotes in the format: PowerShell 5.1 drops embedded quotes on the way to adb, which splits a quoted format.
function Get-PrivateFileShape([string]$User, [string]$Name) {
  $value = & $Adb -s $Serial shell "run-as $Package --user $User sh -c 'if [ -f files/$Name ]; then stat -c %a:%s files/$Name; else echo missing; fi'"
  return "$value".Trim()
}

function Get-Health {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  return Invoke-RestMethod -Uri "$Origin/healthz" -Method Get -TimeoutSec 60
}

function Assert-SimulationMode {
  $health = Get-Health
  if ($VisionOrigin -and $health.vision -ne 'EXPERIMENT') { throw 'VisionOrigin is not the separate Vision experiment. Nothing was issued.' }
  if ($health.status -ne 'UP' -or $health.mode -ne 'STATEFUL_AVD_SIMULATION' -or $health.sessionCreation -ne 'OPERATOR_APPROVED_AVD_ONLY') {
    throw "Render reports mode=$($health.mode) sessionCreation=$($health.sessionCreation). Nothing was issued. Set CARSCOPE_AVD_SIMULATOR_MODE=OPERATOR_APPROVED on Render and redeploy first: that is a separate operator approval."
  }
}

# Variables set here are removed in the finally block below, and only those.
$script:OwnedVariables = @()
function Set-OwnedVariable([string]$Name, [string]$Value) {
  Set-Item -Path "Env:$Name" -Value $Value
  $script:OwnedVariables += $Name
}

function Initialize-Database {
  if (-not (Test-Path (Join-Path $Tool 'node_modules\pg'))) {
    throw "Run 'npm install --ignore-scripts --no-audit --no-fund --package-lock=false' in $Tool first."
  }
  if (-not $env:PG_ADMIN_DATABASE_URL) {
    $secure = Read-Host -AsSecureString 'carscope_app Session Pooler URL (hidden)'
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { Set-OwnedVariable 'PG_ADMIN_DATABASE_URL' ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
  if (-not $env:CARSCOPE_DB_CA_PEM_BASE64) {
    if (-not $CaPemFile -or -not (Test-Path -PathType Leaf $CaPemFile)) { throw 'Pass -CaPemFile with the Supabase CA certificate.' }
    Set-OwnedVariable 'CARSCOPE_DB_CA_PEM_BASE64' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($CaPemFile)))
  }
  if (-not $env:CARSCOPE_DB_SCHEMA) { Set-OwnedVariable 'CARSCOPE_DB_SCHEMA' $Schema }
}

function Invoke-Admin([string[]]$Arguments) {
  $output = & node (Join-Path $Tool 'bin\avd-simulator-admin.mjs') @Arguments
  if ($LASTEXITCODE -ne 0) { throw "The admin command '$($Arguments[0])' failed." }
  return ($output | Out-String) | ConvertFrom-Json
}

function Install-Endpoint([string]$User) {
  $json = '{"apiOrigin":"' + $Origin + '","mobileRoot":"' + $Origin + '/"}'
  Set-PrivateFile $User $EndpointFile $json 2048
  Write-Output "$EndpointFile installed."
}

function Install-Simulator([string]$User) {
  if (Test-Path $StateFile) { throw "$StateFile exists. Run -Action Remove for the previous registration first." }
  Assert-SimulationMode
  Initialize-Database

  New-Item -ItemType Directory -Force $StateDir | Out-Null
  $folder = Join-Path $StateDir ('issue-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $folder | Out-Null
  & icacls $folder /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { Remove-Item -Recurse -Force $folder; throw 'Could not restrict the temporary folder.' }

  $secretFile = Join-Path $folder 'enrollment.json'
  $issued = $null
  try {
    $issued = Invoke-Admin @('issue', '--label', $Label, '--out', $secretFile, '--hours', "$Hours")
    Install-Endpoint $User
    Set-PrivateFile $User $EnrollmentFile ([IO.File]::ReadAllText($secretFile).Trim()) 512
    @{ registrationId = $issued.registrationId; expiresAt = $issued.expiresAt; serial = $Serial; user = $User } |
      ConvertTo-Json | Set-Content -Encoding ascii $StateFile
  } catch {
    # A proof that did not reach the device must not stay valid.
    if ($issued) { Invoke-Admin @('revoke', '--id', $issued.registrationId) | Out-Null }
    throw
  } finally {
    Remove-Item -Recurse -Force $folder
  }

  if ($GlbPath) {
    & node (Join-Path $Repository 'tools\three-poc\push-android-lab-model.mjs') "--serial=$Serial" "--glb=$GlbPath"
    if ($LASTEXITCODE -ne 0) { throw "Pushing the model failed. Registration $($issued.registrationId) stays active; use -Action Remove to end it." }
  }
  Write-Output "Enrollment installed. registrationId=$($issued.registrationId) hours=$Hours (proof not printed, local copy deleted)."
  Write-Output "Next: open the CarScope inspection (debug) launcher entry on the AVD. The app asks for a grant only when a part is requested."
  Write-Output "This is an AVD simulation. It does not verify a real vehicle or its owner."
}

function Remove-Simulator([string]$User) {
  if (Test-Path $StateFile) {
    Initialize-Database
    $registration = (Get-Content -Raw $StateFile | ConvertFrom-Json).registrationId
    $result = Invoke-Admin @('revoke', '--id', $registration)
    Write-Output "Registration $registration`: $($result.status)"
  } else {
    Write-Output "No local registration record for $Serial. Use bin/avd-simulator-admin.mjs list to check the server."
  }
  & $Adb -s $Serial shell "run-as $Package --user $User rm -f files/$EnrollmentFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Deleting $EnrollmentFile failed. The record is kept." }
  if (Test-Path $StateFile) { Remove-Item -Force $StateFile }
  Write-Output "$EnrollmentFile deleted. Render's simulation mode is unchanged: removing it is a separate operator step."
}

try {
  if (-not (Test-Path -PathType Leaf $Adb)) { throw "adb not found: $Adb" }
  $user = Get-AndroidUser
  Assert-DebugApp $user
  switch ($Action) {
    'Install' { Install-Simulator $user }
    'Endpoint' { Install-Endpoint $user }
    'Status' {
      $health = Get-Health
      Write-Output "server mode=$($health.mode) sessionCreation=$($health.sessionCreation)"
      Write-Output "$EndpointFile : $(Get-PrivateFileShape $user $EndpointFile)"
      Write-Output "$EnrollmentFile : $(Get-PrivateFileShape $user $EnrollmentFile)"
    }
    'Remove' { Remove-Simulator $user }
  }
} finally {
  foreach ($name in $script:OwnedVariables) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
}
