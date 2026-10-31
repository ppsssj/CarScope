# P2-A8: copy a locally generated drawing into the DEBUG app's private files directory on a device/AVD.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/ioniq5-asset/push-debug-asset.ps1 `
#     -Parts C:\CarScope-External\ioniq5-svg\ioniq5.parts [-Serial emulator-5554] [-Remove]
# Uses `run-as`, which Android allows only for debuggable builds: a release install cannot receive the
# file this way. Nothing is written to shared storage and no permission is requested.
param([string]$Parts, [string]$Serial = 'emulator-5554', [string]$Profile = 'hyundai-ioniq5-2022', [switch]$Remove)
$ErrorActionPreference = 'Stop'
$adb = if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' } else { 'adb' }
$package = 'io.carscope.app'
$target = "files/debug-visual-assets/$Profile.parts"
# adb writes progress to stderr; in Windows PowerShell 5.1 that becomes an error record under 'Stop',
# so native calls run under 'Continue' and are judged by their exit code only.
function Adb([string[]]$a) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $adb -s $Serial @a 2>&1 | ForEach-Object { "$_" }; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "adb $($a -join ' ') (exit $code): $out" }
  $out
}

# AAOS runs apps as the current (non-system) user, e.g. u10; run-as defaults to user 0.
$user = "$(Adb @('shell', 'am get-current-user'))".Trim()
if ($user -notmatch '^\d+$') { throw "Cannot read the current Android user: $user" }
$runAs = "run-as $package --user $user"   # usage: run-as <package> [--user <uid>] <command>
$debuggable = Adb @('shell', "$runAs id")
if ("$debuggable" -notmatch 'uid=') { throw "run-as failed (not a debuggable install?): $debuggable" }
if ($Remove) { Adb @('shell', "$runAs rm -f $target") | Out-Null; Write-Host "Removed $target"; return }
if (-not $Parts -or -not (Test-Path $Parts)) { throw "Missing -Parts file" }
$bytes = (Get-Item $Parts).Length
if ($bytes -le 0 -or $bytes -gt 2000000) { throw "Size $bytes outside 1..2000000" }
$sha = (Get-FileHash $Parts -Algorithm SHA256).Hash.ToLowerInvariant()
$tmp = "/data/local/tmp/carscope-$Profile.parts"
Adb @('push', $Parts, $tmp) | Out-Null
try {
  # The shell user reads the temp file and pipes it into run-as (app uid), so the app never reads /data/local/tmp.
  Adb @('shell', "cat $tmp | $runAs sh -c 'mkdir -p files/debug-visual-assets && cat > $target && chmod 600 $target'") | Out-Null
} finally {
  Adb @('shell', "rm -f $tmp") | Out-Null
}
$remote = "$(Adb @('shell', "$runAs sha256sum $target"))".Split(' ')[0]
if ($remote -ne $sha) { throw "SHA mismatch on device: $remote vs $sha" }
Write-Host "Pushed $Parts -> $package (user $user)/$target ($bytes B, sha256 $sha)"
