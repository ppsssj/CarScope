plugins {
    id("com.android.application")
    kotlin("android")
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
    buildTypes {
        getByName("debug") { buildConfigField("String", "VISION_EXPERIMENT_ORIGIN", "\"$visionOrigin\"") }
    }
    defaultConfig {
        applicationId = "io.carscope.app"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-p0"
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

kotlin { jvmToolchain(17) }

dependencies {
    // Public AAOS stubs for the debug identity probe only; supplied by the device at runtime.
    debugCompileOnly(files(android.sdkDirectory.resolve("platforms/android-${android.compileSdk}/optional/android.car.jar")))
    implementation(project(":vehicle-core"))
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    testImplementation("junit:junit:4.13.2")
    debugImplementation("com.google.code.gson:gson:2.15.0")
    debugImplementation("com.google.zxing:core:3.5.4")
    add("testDebugImplementation", "org.robolectric:robolectric:4.16")
}
