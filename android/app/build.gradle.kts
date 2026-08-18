plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    id("com.google.devtools.ksp") version "2.0.0-1.0.21"
    id("com.google.gms.google-services")
}

android {
    namespace = "com.kreativekoala.scribeai"
    compileSdk = 36

    signingConfigs {
        create("release") {
            storeFile = file("/Users/sushanthtiruvaipati/Documents/GitHub/AndroidAppKey")
            storePassword = "KashtePhale!9"
            keyAlias = "androidappkey"
            keyPassword = "KashtePhale!9"
        }
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    defaultConfig {
        applicationId = "com.kreativekoala.scribeai"
        minSdk = 26
        targetSdk = 36
        versionCode = 81
        versionName = "58.21"

        // 16KB page size support
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
        }

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        // Add BuildConfig support
        buildFeatures {
            buildConfig = true
        }

        // Backend URL. Matches the iOS Constants.baseURL so both clients hit
        // the same deployment (Fly.io). The Cloud Run instance is no longer
        // kept in sync — do not point at it.
        buildConfigField("String", "BASE_URL", "\"https://ai-notetaker-backend.fly.dev/\"")
        buildConfigField("boolean", "DEBUG", "true")

        // Sent as `x-bypass-rate-limit` for subscribed users so the server
        // exempts them from the 100-req/15min window. Override per-machine
        // via `RATE_LIMIT_BYPASS_TOKEN` in local.properties.
        val bypassToken: String = (project.findProperty("RATE_LIMIT_BYPASS_TOKEN")
            ?: System.getenv("RATE_LIMIT_BYPASS_TOKEN")
            ?: "ZFkOTdbeZ3RiXM4yAUwySQgfc1Zi039gtNPcOXVNn_c") as String
        buildConfigField("String", "RATE_LIMIT_BYPASS_TOKEN", "\"$bypassToken\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
            buildConfigField("boolean", "DEBUG", "false")
        }
        debug {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }

    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        // CRITICAL: 16KB page size support
        jniLibs {
            useLegacyPackaging = false
        }
    }


}

dependencies {
    // Core Android
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation("androidx.appcompat:appcompat:1.7.0")

    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)

    // Navigation
    implementation(libs.androidx.navigation.compose)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging.interceptor)

    // JSON
    implementation(libs.gson)

    // Permissions
    implementation(libs.accompanist.permissions)

    // DataStore
    implementation(libs.androidx.datastore.preferences)

    // Google Play In-App Review
    implementation(libs.play.review.ktx)

    // Firebase Analytics (free, unlimited)
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-analytics")

    // Testing
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)

    // Debug
    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)

    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.1")

    implementation("com.itextpdf:itext7-core:8.0.5")

    // CameraX for camera preview
    implementation("androidx.camera:camera-camera2:1.4.0")
    implementation("androidx.camera:camera-lifecycle:1.4.0")
    implementation("androidx.camera:camera-view:1.4.0")

    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")

    // Google Sign-In (Modern Credential Manager approach)
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    // Google Play Billing
    implementation("com.android.billingclient:billing-ktx:7.1.1")

    // Twilio Voice SDK — in-app VoIP phone calls
    implementation("com.twilio:voice-android:6.9.0")

    // PaywallKit
    implementation(project(":paywallkit"))
    implementation(project(":crosspromokit"))

    // Room Database (Local Cache)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // Image Loading
    implementation(libs.coil.compose)

    // TikTok Events SDK (install attribution & event tracking)
    implementation("com.github.tiktok:tiktok-business-android-sdk:1.6.0")

    // Facebook SDK
    implementation("com.facebook.android:facebook-android-sdk:17.0.2")

}