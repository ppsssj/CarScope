plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "io.carscope.app"
    compileSdk = 34
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
}

kotlin { jvmToolchain(17) }

dependencies {
    // Public AAOS stubs for the debug identity probe only; supplied by the device at runtime.
    debugCompileOnly(files(android.sdkDirectory.resolve("platforms/android-${android.compileSdk}/optional/android.car.jar")))
    implementation(project(":vehicle-core"))
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    testImplementation("junit:junit:4.13.2")
}
