package com.kreativekoala.scribeai.data.models

import com.google.gson.annotations.SerializedName

// Request to validate a promo code
data class ValidatePromoCodeRequest(
    @SerializedName("code")
    val code: String
)

// Response from promo code validation
data class ValidatePromoCodeResponse(
    @SerializedName("success")
    val success: Boolean,
    @SerializedName("data")
    val data: PromoCodeData? = null,
    @SerializedName("error")
    val error: String? = null
)

data class PromoCodeData(
    @SerializedName("valid")
    val valid: Boolean,
    @SerializedName("code")
    val code: String,
    @SerializedName("trialExtensionDays")
    val trialExtensionDays: Int,
    @SerializedName("creatorName")
    val creatorName: String
) {
    // Promo codes extend trial period (discounts not supported on iOS/Android)
    val promoDescription: String
        get() = if (trialExtensionDays > 0) {
            "Trial extended by $trialExtensionDays days!"
        } else {
            "Code applied!"
        }

    val hasTrialExtension: Boolean
        get() = trialExtensionDays > 0
}

// Request to apply a promo code
data class ApplyPromoCodeRequest(
    @SerializedName("code")
    val code: String,
    @SerializedName("platform")
    val platform: String = "android",
    @SerializedName("deviceFingerprint")
    val deviceFingerprint: String
)
