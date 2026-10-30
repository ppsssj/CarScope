param(
    [string]$GradleHome
)

# Offline fallback only. This does not run the Kotlin Gradle plugin or Android tools.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path $PSScriptRoot
if (-not $GradleHome) {
    $gradleUserDir = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $env:USERPROFILE '.gradle' }
    $distributionDir = Join-Path $gradleUserDir 'wrapper/dists/gradle-8.14-bin'
    $launcher = Get-ChildItem $distributionDir -Recurse -Filter gradle.bat -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $launcher) { throw 'Local Gradle 8.14 not found. Pass -GradleHome; no download is performed.' }
    $GradleHome = Split-Path (Split-Path $launcher.FullName)
}
$lib = Join-Path $GradleHome 'lib'
$compiler = Join-Path $lib 'kotlin-compiler-embeddable-2.0.21.jar'
$stdlib = Join-Path $lib 'kotlin-stdlib-2.0.21.jar'
$junit = Join-Path $lib 'junit-4.13.2.jar'
$hamcrest = Join-Path $lib 'hamcrest-core-1.3.jar'
foreach ($dependency in @($compiler, $stdlib, $junit, $hamcrest)) {
    if (-not (Test-Path -LiteralPath $dependency)) { throw "Required local JAR missing: $dependency" }
}
$javaCommand = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/java.exe' } else { (Get-Command java -ErrorAction Stop).Source }
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$outputDir = Join-Path $projectRoot "vehicle-core/build/standalone/$runId"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$mainJar = Join-Path $outputDir 'vehicle-core.jar'
$testJar = Join-Path $outputDir 'vehicle-core-tests.jar'
$separator = [IO.Path]::PathSeparator
$compileRuntime = (Get-ChildItem $lib -Filter '*.jar' | ForEach-Object FullName) -join $separator
$compileClasspath = @($stdlib, (Join-Path $lib 'annotations-24.0.1.jar')) -join $separator
$mainSources = @(Get-ChildItem (Join-Path $projectRoot 'vehicle-core/src/main/kotlin') -Recurse -Filter '*.kt' | ForEach-Object FullName)
$testSources = @(Get-ChildItem (Join-Path $projectRoot 'vehicle-core/src/test/kotlin') -Recurse -Filter '*.kt' | ForEach-Object FullName)
if ($mainSources.Count -eq 0 -or $testSources.Count -eq 0) { throw 'Main or test sources missing.' }

Start-Transcript -Path (Join-Path $outputDir 'validation.log') | Out-Null
try {
    Write-Output "OUTPUT=$outputDir"
    & $javaCommand -version
    & $javaCommand -cp $compileRuntime org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -version
    if ($LASTEXITCODE -ne 0) { throw 'Compiler version check failed.' }
    Write-Output 'COMMAND: K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -classpath <stdlib,annotations> -d vehicle-core.jar <all main sources>'
    & $javaCommand -cp $compileRuntime org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -classpath $compileClasspath -d $mainJar @mainSources
    if ($LASTEXITCODE -ne 0) { throw 'Main Kotlin compilation failed.' }
    $testClasspath = @($compileClasspath, $mainJar, $junit, $hamcrest) -join $separator
    Write-Output 'COMMAND: K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -Xfriend-paths=<main JAR> -classpath <main,stdlib,annotations,JUnit,Hamcrest> -d vehicle-core-tests.jar <all test sources>'
    & $javaCommand -cp $compileRuntime org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 "-Xfriend-paths=$mainJar" -classpath $testClasspath -d $testJar @testSources
    if ($LASTEXITCODE -ne 0) { throw 'Test Kotlin compilation failed.' }
    $testRuntime = @($testClasspath, $testJar) -join $separator
    Write-Output 'COMMAND: java -cp <test runtime> org.junit.runner.JUnitCore io.carscope.vehicle.VehiclePipelineTest'
    & $javaCommand -cp $testRuntime org.junit.runner.JUnitCore io.carscope.vehicle.VehiclePipelineTest
    if ($LASTEXITCODE -ne 0) { throw 'JUnit tests failed.' }
    Write-Output 'COMMAND: java -cp <test runtime> io.carscope.vehicle.VehicleSvgSamples <run output>/svg'
    & $javaCommand -cp $testRuntime io.carscope.vehicle.VehicleSvgSamples (Join-Path $outputDir 'svg')
    if ($LASTEXITCODE -ne 0) { throw 'SVG sample export failed.' }
    Write-Output 'PASS: standalone Kotlin 2.0.21 compilation and JUnit; Gradle KGP 2.2.0 and Android are not validated by this command.'
} finally {
    Stop-Transcript | Out-Null
}
