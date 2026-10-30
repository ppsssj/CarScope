plugins {
    base
    // Share the Kotlin plugin classloader across Android and JVM subprojects.
    id("com.android.application") apply false
    kotlin("jvm") apply false
    kotlin("android") apply false
}
