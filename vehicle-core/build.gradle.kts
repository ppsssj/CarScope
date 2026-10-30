plugins {
    kotlin("jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

tasks.register<JavaExec>("exportSvgSamples") {
    group = "verification"
    description = "Exports deterministic MOCK SVG samples; does not verify browser/WebView painting."
    dependsOn(tasks.testClasses)
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass.set("io.carscope.vehicle.VehicleSvgSamples")
    args(layout.buildDirectory.dir("validation/svg").get().asFile.absolutePath)
}
