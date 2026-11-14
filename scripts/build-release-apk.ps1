<#
  Builds the signed contest Release APK (docs/release-submission.md).
  - The keystore and its DPAPI-protected password stay outside Git (default C:\CarScope-External\release-signing).
  - The IONIQ 5 GLB is read from a local path and must match its SHA-256 (checked by Gradle).
  - The password is decrypted into this process's environment only, never printed, and removed afterwards.
  Output: the APK copied to -OutFile, plus apksigner verification and SHA-256 lines.
#>
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$SigningDir = 'C:\CarScope-External\release-signing',
  [string]$Glb = 'C:\CarScope-External\ioniq5-carscope\hyundai_ioniq_5_2022.glb',
  [string]$BuildTools = 'C:\Android\Sdk\build-tools\35.0.0'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$store = Join-Path $SigningDir 'carscope-release.jks'
$secret = Join-Path $SigningDir 'keystore-password.dpapi'
if (-not (Test-Path $store) -or -not (Test-Path $secret)) { throw "signing material missing in $SigningDir" }
if (-not (Test-Path (Join-Path $root 'app\src\debug\assets\inspection\index.html'))) {
  throw 'inspection page missing: run node tools/three-poc/build-android-inspection.mjs first'
}
$secure = Get-Content $secret | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:CARSCOPE_RELEASE_STORE_FILE = $store
  $env:CARSCOPE_RELEASE_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:CARSCOPE_RELEASE_KEY_PASSWORD = $env:CARSCOPE_RELEASE_STORE_PASSWORD
  $env:CARSCOPE_RELEASE_KEY_ALIAS = 'carscope-release'
  Push-Location $root
  try {
    & .\gradlew.bat :app:assembleRelease --rerun-tasks --console=plain "-PcarscopeSubmission=true" "-PcarscopeInspectionGlb=$Glb"
    if ($LASTEXITCODE -ne 0) { throw "assembleRelease failed ($LASTEXITCODE)" }
  } finally { Pop-Location }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  foreach ($name in 'CARSCOPE_RELEASE_STORE_FILE', 'CARSCOPE_RELEASE_STORE_PASSWORD', 'CARSCOPE_RELEASE_KEY_PASSWORD', 'CARSCOPE_RELEASE_KEY_ALIAS') {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}
$apk = Join-Path $root 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "signed APK not produced: $apk" }
& (Join-Path $BuildTools 'apksigner.bat') verify --verbose --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'apksigner verify failed' }
New-Item -ItemType Directory -Force (Split-Path -Parent $OutFile) | Out-Null
Copy-Item $apk $OutFile -Force
"APK: $OutFile"
"Bytes: $((Get-Item $OutFile).Length)"
"SHA-256: $((Get-FileHash -Algorithm SHA256 $OutFile).Hash.ToLower())"
