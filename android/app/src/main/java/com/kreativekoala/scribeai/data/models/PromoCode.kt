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
    val creatorName: String
) {
    val discountDescription: String
        get() = when (discountType) {
            "percent" -> "${discountValue.toInt()}% off first month"
            "fixed" -> "$${discountValue.toInt()} off"
            "trial_extension" -> "+$trialExtensionDays extra trial days"
            else -> ""
        }
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
