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
    @SerializedName("discountType")
    val discountType: String,
    @SerializedName("discountValue")
    val discountValue: Double,
    @SerializedName("trialExtensionDays")
    val trialExtensionDays: Int,
    @SerializedName("creatorName")
    val creatorName: String,
    @SerializedName("discountEligible")
    val discountEligible: Boolean = true  // Whether user gets 10% off on web (not applicable on Android)
) {
    // On Android, promo codes extend trial period (discounts only work on web)
    val promoDescription: String
        get() = if (trialExtensionDays > 0) {
            "Trial extended to 14 days!"
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
