package com.kreativekoala.scribeai.ui.screens

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallView
import com.kreativekoala.scribeai.utils.SubscriptionManager

@Composable
fun PaywallScreen(
    subscriptionManager: SubscriptionManager,
    onDismiss: () -> Unit,
    onSubscribe: () -> Unit,
    dismissable: Boolean = true
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val products by subscriptionManager.products.collectAsState()

    // Swallow back when this paywall is operating as a hard gate.
    BackHandler(enabled = !dismissable) { /* no-op */ }

    if (products.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0A0A0F)),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Color(0xFF6C63FF))
        }
        return
    }

    val paywallProducts = products.map { details ->
        val productId = details.productId
        val offer = details.subscriptionOfferDetails?.firstOrNull()
        val phase = offer?.pricingPhases?.pricingPhaseList?.lastOrNull()
        val trialPhase = offer?.pricingPhases?.pricingPhaseList?.firstOrNull()
            ?.takeIf { it.priceAmountMicros == 0L }
        val trialDays = trialPhase?.billingCycleCount?.let {
            when {
                trialPhase.billingPeriod.contains("D") -> it
                trialPhase.billingPeriod.contains("W") -> it * 7
                else -> null
            }
        }
        PaywallProduct(
            id = productId,
            localizedPrice = phase?.formattedPrice ?: "",
            price = (phase?.priceAmountMicros ?: 0L) / 1_000_000.0,
            currencyCode = phase?.priceCurrencyCode ?: "USD",
            trialDays = trialDays,
            period = when {
                productId.contains("yearly") || productId.contains("annual") -> PaywallProduct.Period.YEARLY
                productId.contains("weekly") -> PaywallProduct.Period.WEEKLY
                else -> PaywallProduct.Period.MONTHLY
            }
        )
    }

    PaywallView(
        appId = "scribeai",
        appName = "ScribeAI",
        features = listOf(
            PaywallFeature("📝", "Unlimited Notes", "Create without limits"),
            PaywallFeature("🎤", "Transcription", "Voice to text in seconds"),
            PaywallFeature("🤖", "AI Summaries", "Smart summaries & insights"),
            PaywallFeature("🃏", "Flashcards", "Auto-generated study cards"),
            PaywallFeature("💬", "AI Chat", "Ask questions about your notes"),
            PaywallFeature("🎙️", "Podcast Mode", "Turn notes into audio")
        ),
        products = paywallProducts,
        theme = PaywallTheme(
            accent = Color(0xFF6C63FF),
            accent2 = Color(0xFF9C27B0)
        ),
        showWinback = true,
        isDismissible = dismissable,
        onPurchase = { productId ->
            if (activity != null) {
                subscriptionManager.launchSubscriptionFlow(
                    activity = activity,
                    productId = productId,
                    onSuccess = { onSubscribe() },
                    onError = { /* handled by billing client listener */ }
                )
            }
        },
        onRestore = {
            subscriptionManager.restorePurchases(
                onSuccess = { onSubscribe() },
                onError = { /* silently ignore */ }
            )
        },
        onRedeemCode = {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem?code=promo-1month-free"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { activity?.startActivity(intent) } catch (_: Exception) {}
        },
        onDismiss = onDismiss
    )
}
