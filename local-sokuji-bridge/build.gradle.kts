plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.0")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

application {
    mainClass.set("local.sokuji.Main")
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = "local.sokuji.Main"
    }
}
