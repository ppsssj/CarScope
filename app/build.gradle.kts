import java.security.MessageDigest

plugins {
    id("com.android.application")
    kotlin("android")
}

/**
 * Release 3D inspection assets: the generated `src/debug/assets/inspection` page (tools/three-poc/build-android-inspection.mjs)
 * plus, for a submission build only, the third-party IONIQ 5 GLB at `inspection/external/ioniq5.glb`.
 * The GLB is never committed. It is read from a local path and must match the converted file's SHA-256 exactly.
 */
abstract class PackageReleaseInspectionAssets : DefaultTask() {
    @get:InputDirectory @get:Optional abstract val page: DirectoryProperty
    @get:InputFile @get:Optional abstract val model: RegularFileProperty
    @get:Input abstract val modelSha256: Property<String>
    @get:Input abstract val requireModel: Property<Boolean>
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction fun run() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        val pageDir = page.orNull?.asFile
        if (pageDir == null || !File(pageDir, "index.html").isFile) {
            // CI builds the page before Gradle; a submission build must never ship without it.
            check(!requireModel.get()) { "inspection page missing: run node tools/three-poc/build-android-inspection.mjs first" }
            return
        }
        pageDir.copyRecursively(File(out, "inspection"))
        val glb = model.orNull?.asFile
        if (glb == null) {
            check(!requireModel.get()) { "carscopeSubmission=true requires -PcarscopeInspectionGlb=<local GLB path>" }
            return
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(glb.readBytes()).joinToString("") { "%02x".format(it) }
        check(digest == modelSha256.get()) { "IONIQ 5 GLB SHA-256 mismatch: expected the converted file ${modelSha256.get()}" }
        glb.copyTo(File(out, "inspection/external/ioniq5.glb"))
    }
}

android {
    namespace = "io.carscope.app"
    compileSdk = 34
    buildFeatures { buildConfig = true }
    // Operator-selected, compiled into debug only; a runtime file/Intent cannot add an origin.
    val visionOrigin = providers.gradleProperty("carscopeVisionOrigin").orElse("").get()
    require(visionOrigin.isEmpty() || Regex("https://[a-z0-9][a-z0-9-]*\\.onrender\\.com").matches(visionOrigin)) {
        "carscopeVisionOrigin must be an exact Render HTTPS origin"
    }
    // Release signing comes only from the local environment (never Git). Without it the release APK stays unsigned.
    val storeFile = System.getenv("CARSCOPE_RELEASE_STORE_FILE").orEmpty()
    val releaseSigning = if (storeFile.isEmpty()) null else signingConfigs.create("carscopeRelease") {
        this.storeFile = file(storeFile)
        storePassword = System.getenv("CARSCOPE_RELEASE_STORE_PASSWORD")
        keyAlias = System.getenv("CARSCOPE_RELEASE_KEY_ALIAS")
        keyPassword = System.getenv("CARSCOPE_RELEASE_KEY_PASSWORD")
        enableV1Signing = true
        enableV2Signing = true
        enableV3Signing = true
    }
    buildTypes {
        getByName("debug") { buildConfigField("String", "VISION_EXPERIMENT_ORIGIN", "\"$visionOrigin\"") }
        getByName("release") { if (releaseSigning != null) signingConfig = releaseSigning }
    }
    // The 3D inspection screen, its WebView host and the read-only Pleos status sources are shared by both build types.
    // Network sync, enrollment, the AVD simulator and every probe/lab stay in src/debug.
    sourceSets {
        getByName("debug") { java.srcDir("src/inspection/java") }
        getByName("release") { java.srcDir("src/inspection/java") }
    }
    defaultConfig {
        applicationId = "io.carscope.app"
        minSdk = 28
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Android/Robolectric and plain JDK TLS fixtures must not inherit another class's process globals.
        // Keep every test and its strict TLS assertions; only isolate class-level JVM workers.
        unitTests.all { it.forkEvery = 1 }
    }
}

val packageReleaseInspectionAssets = tasks.register<PackageReleaseInspectionAssets>("packageReleaseInspectionAssets") {
    val pageDir = layout.projectDirectory.dir("src/debug/assets/inspection")
    if (pageDir.asFile.isDirectory) page.set(pageDir)
    providers.gradleProperty("carscopeInspectionGlb").orNull?.let { model.set(file(it)) }
    modelSha256.set("cfe0d754b5aaf8daeff7b498b0f786d7b2fb94323850f214678a3b68d00139e1")
    requireModel.set(providers.gradleProperty("carscopeSubmission").map { it == "true" }.orElse(false))
    outputDir.set(layout.buildDirectory.dir("generated/carscope/releaseInspectionAssets"))
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(packageReleaseInspectionAssets, PackageReleaseInspectionAssets::outputDir)
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    // Public AAOS stubs for the debug identity probe only; supplied by the device at runtime.
    debugCompileOnly(files(android.sdkDirectory.resolve("platforms/android-${android.compileSdk}/optional/android.car.jar")))
    implementation(project(":vehicle-core"))
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    testImplementation("junit:junit:4.13.2")
    // The shared inspection bridge and status channels encode JSON with Gson; QR rendering (ZXing) stays debug-only.
    implementation("com.google.code.gson:gson:2.15.0")
    debugImplementation("com.google.zxing:core:3.5.4")
    add("testDebugImplementation", "org.robolectric:robolectric:4.16")
}
