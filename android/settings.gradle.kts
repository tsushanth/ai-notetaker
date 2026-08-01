pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "ScribeAI"
include(":app")
include(":paywallkit")
project(":paywallkit").projectDir = file("/Users/sushanthtiruvaipati/Documents/GitHub/PaywallKit-Android/paywallkit")

include(":crosspromokit")
project(":crosspromokit").projectDir = file("/Users/sushanthtiruvaipati/Documents/GitHub/CrossPromoKit-Android/crosspromokit")
