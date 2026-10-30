pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        // Kotlin 2.2 bytecode tooling baseline (D8/R8), Gradle >= 8.11.1, JDK 17.
        id("com.android.application") version "8.10.0"
        kotlin("android") version "2.2.0"
        kotlin("jvm") version "2.2.0"
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://nexus-playground.pleos.ai/repository/maven-releases/") {
            content { includeGroup("ai.pleos.playground") }
        }
    }
}

rootProject.name = "CarScope"
include(":vehicle-core")
// Allows domain tests on hosts without an Android SDK. Never produces an APK.
if (providers.gradleProperty("coreOnly").orNull != "true") {
    include(":app")
}
