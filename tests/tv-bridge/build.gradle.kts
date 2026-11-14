plugins {
    kotlin("jvm") version "2.4.20"
    application
}
repositories { mavenCentral() }
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
}
kotlin {
    jvmToolchain(17)
    val sources = sourceSets.getByName("main").kotlin
    sources.srcDir("../../ios/shared/src/commonMain/kotlin")
    sources.include("**/TVRemoteSession.kt", "**/Json.kt", "**/BridgeContract.kt", "**/TrackTypes.kt", "**/QueueTypes.kt")
}
application { mainClass.set("BridgeContractKt") }
