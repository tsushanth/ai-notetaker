package com.kreativekoala.scribeai.ui.screens

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallView
import com.kreativekoala.scribeai.ui.theme.DarkBackground
import com.kreativekoala.scribeai.ui.theme.DarkSurface
import com.kreativekoala.scribeai.ui.theme.Purple40
import com.kreativekoala.scribeai.ui.theme.Purple80
import com.kreativekoala.scribeai.utils.SubscriptionManager

// Flip to false to fall back to the shared PaywallKit view (A/B templates, winback, etc.)
// unchanged. Kept as an easy revert switch for the native Turbo-styled paywall below.
private const val USE_NATIVE_PAYWALL = true

// Turbo AI light-theme palette, observed on-device. Local to this screen only — the rest
// of the app is dark, so these are NOT added to ui/theme/Color.kt.
private val TurboLightBase = Color(0xFFF3F1F7)
private val TurboLightBlueWash = Color(0xFFDBE9FC)
private val TurboLightPinkWash = Color(0xFFFADBD8)
private val TurboLightTextPrimary = Color(0xFF26232F)
private val TurboLightTextSecondary = Color(0xFF6B6775)
private val TurboLightAccent = Color(0xFF8A5BD3)
private val TurboLightAccentLip = Color(0xFF7A4CC0)
private val TurboLightCardBorder = Color(0xFFE4E0EC)
private val TurboLightIconTile = Color(0xFFEEE8FA)

// Small hardcoded English copy for the native Turbo-style layout. Adding new strings.xml
// keys here would require ~25 translations for a paywall-only redesign, so plain English
// constants are used instead (matches existing behavior: paywallkit's copy was also
// hardcoded English inside the library).
private const val TURBO_HEADLINE = "Choose your ScribeAI Unlimited plan"
private const val TURBO_NO_COMMITMENT = "No commitment, cancel any time"
private const val TURBO_SUBSCRIBE_CTA = "Subscribe Now"
private const val TURBO_RESTORE = "Restore Purchases"
private const val TURBO_TERMS = "Terms of Service"
private const val TURBO_REDEEM_CODE = "Redeem code"
private const val TURBO_TERMS_URL = "https://scribeai.online/terms"

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
                .background(if (USE_NATIVE_PAYWALL) TurboLightBase else DarkBackground),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Purple80)
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

    val features = listOf(
        PaywallFeature("📝", "Unlimited Notes", "Create without limits"),
        PaywallFeature("🎤", "Transcription", "Voice to text in seconds"),
        PaywallFeature("🤖", "AI Summaries", "Smart summaries & insights"),
        PaywallFeature("🃏", "Flashcards", "Auto-generated study cards"),
        PaywallFeature("💬", "AI Chat", "Ask questions about your notes"),
        PaywallFeature("🎙️", "Podcast Mode", "Turn notes into audio")
    )

    val onPurchase: (String) -> Unit = { productId ->
        if (activity != null) {
            subscriptionManager.launchSubscriptionFlow(
                activity = activity,
                productId = productId,
                onSuccess = { onSubscribe() },
                onError = { /* handled by billing client listener */ }
            )
        }
    }

    val onRestore: () -> Unit = {
        subscriptionManager.restorePurchases(
            onSuccess = { onSubscribe() },
            onError = { /* silently ignore */ }
        )
    }

    val onRedeemCode: () -> Unit = {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem?code=promo-1month-free"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { activity?.startActivity(intent) } catch (_: Exception) {}
    }

    if (USE_NATIVE_PAYWALL) {
        TurboPaywallContent(
            products = paywallProducts,
            features = features,
            dismissable = dismissable,
            onDismiss = onDismiss,
            onPurchase = onPurchase,
            onRestore = onRestore,
            onRedeemCode = onRedeemCode
        )
    } else {
        PaywallView(
            appId = "scribeai",
            appName = "ScribeAI",
            features = features,
            products = paywallProducts,
            theme = PaywallTheme(
                accent = Purple80,
                accent2 = Purple40,
                background = DarkBackground,
                cardBackground = DarkSurface
            ),
            showWinback = true,
            isDismissible = dismissable,
            onPurchase = onPurchase,
            onRestore = onRestore,
            onRedeemCode = onRedeemCode,
            onDismiss = onDismiss
        )
    }
}

/**
 * The native Turbo-styled paywall body. Public so other paywall entry points in the app
 * (e.g. MainActivity's post-onboarding hard gate) can reuse it instead of duplicating the
 * gradient/card styling. [onRedeemCode] is nullable: pass null to hide that affordance for
 * a placement that never offered it.
 */
@Composable
fun TurboPaywallContent(
    products: List<PaywallProduct>,
    features: List<PaywallFeature>,
    dismissable: Boolean,
    onDismiss: () -> Unit,
    onPurchase: (String) -> Unit,
    onRestore: () -> Unit,
    onRedeemCode: (() -> Unit)? = null
) {
    val yearlyProduct = products.firstOrNull { it.period == PaywallProduct.Period.YEARLY }
    var selectedProductId by remember(products) {
        mutableStateOf(yearlyProduct?.id ?: products.firstOrNull()?.id ?: "")
    }

    val backgroundBrush = Brush.linearGradient(
        colors = listOf(TurboLightBlueWash, TurboLightBase, TurboLightPinkWash)
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(TurboLightBase)
            .background(backgroundBrush)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                // Without this, the close button/headline sit under the real system status
                // bar window on some devices — the tap never reaches Compose at all because
                // that window intercepts it first, even though the content is drawn visibly.
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 20.dp)
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            if (dismissable) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Close",
                        tint = TurboLightTextPrimary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(36.dp))
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = TURBO_HEADLINE,
                color = TurboLightTextPrimary,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(24.dp))

            val featureIcons = mapOf(
                "Unlimited Notes" to Icons.Filled.Description,
                "Transcription" to Icons.Filled.Mic,
                "AI Summaries" to Icons.Filled.AutoAwesome,
                "Flashcards" to Icons.Filled.Style,
                "AI Chat" to Icons.Filled.Chat,
                "Podcast Mode" to Icons.Filled.Podcasts
            )
            val featuresToShow = features.take(4)

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                featuresToShow.forEach { feature ->
                    TurboFeatureCard(
                        icon = featureIcons[feature.title] ?: Icons.Filled.AutoAwesome,
                        title = feature.title,
                        subtitle = feature.description
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                products.forEach { product ->
                    TurboPlanCard(
                        product = product,
                        monthlyEquivalent = if (product.period == PaywallProduct.Period.YEARLY) {
                            computeYearlyPerMonth(product)
                        } else null,
                        selected = product.id == selectedProductId,
                        onClick = { selectedProductId = product.id }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = TurboLightAccent,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = TURBO_NO_COMMITMENT,
                    color = TurboLightTextSecondary,
                    fontSize = 14.sp
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Button(
                onClick = { if (selectedProductId.isNotEmpty()) onPurchase(selectedProductId) },
                enabled = selectedProductId.isNotEmpty(),
                shape = RoundedCornerShape(28.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = TurboLightAccent,
                    contentColor = Color.White
                ),
                border = BorderStroke(3.dp, TurboLightAccentLip),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                Text(
                    text = TURBO_SUBSCRIBE_CTA,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            val termsContext = LocalContext.current
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center
            ) {
                TextButton(onClick = onRestore) {
                    Text(TURBO_RESTORE, color = TurboLightTextSecondary, fontSize = 13.sp)
                }
                TextButton(onClick = {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(TURBO_TERMS_URL))
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try { termsContext.startActivity(intent) } catch (_: Exception) {}
                }) {
                    Text(TURBO_TERMS, color = TurboLightTextSecondary, fontSize = 13.sp)
                }
            }

            if (onRedeemCode != null) {
                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    TextButton(onClick = onRedeemCode) {
                        Text(TURBO_REDEEM_CODE, color = TurboLightTextSecondary, fontSize = 12.sp)
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun TurboFeatureCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Color.White)
            .border(BorderStroke(1.dp, TurboLightCardBorder), RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(TurboLightIconTile),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = TurboLightAccent,
                modifier = Modifier.size(22.dp)
            )
        }
        Spacer(modifier = Modifier.width(14.dp))
        Column {
            Text(
                text = title,
                color = TurboLightTextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    text = subtitle,
                    color = TurboLightTextSecondary,
                    fontSize = 13.sp
                )
            }
        }
    }
}

@Composable
private fun TurboPlanCard(
    product: PaywallProduct,
    monthlyEquivalent: String?,
    selected: Boolean,
    onClick: () -> Unit
) {
    val periodLabel = when (product.period) {
        PaywallProduct.Period.WEEKLY -> "Weekly"
        PaywallProduct.Period.MONTHLY -> "Monthly"
        PaywallProduct.Period.YEARLY -> "Yearly"
        PaywallProduct.Period.LIFETIME -> "Lifetime"
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(Color.White)
            .border(
                BorderStroke(if (selected) 2.dp else 1.dp, if (selected) TurboLightAccent else TurboLightCardBorder),
                RoundedCornerShape(28.dp)
            )
            .clickable { onClick() }
            .padding(18.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(
                text = periodLabel,
                color = TurboLightTextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = product.localizedPrice + (monthlyEquivalent?.let { " ($it/mo)" } ?: ""),
                color = TurboLightTextSecondary,
                fontSize = 13.sp
            )
            product.trialDays?.let { days ->
                Text(
                    text = "$days-day free trial",
                    color = TurboLightAccent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (selected) TurboLightAccent else Color.White)
                .border(BorderStroke(1.dp, TurboLightCardBorder), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (selected) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }
}

private fun computeYearlyPerMonth(product: PaywallProduct): String {
    if (product.price <= 0.0) return ""
    val perMonth = product.price / 12.0
    return try {
        val fmt = java.text.NumberFormat.getCurrencyInstance()
        fmt.currency = java.util.Currency.getInstance(product.currencyCode)
        fmt.format(perMonth)
    } catch (_: Exception) {
        String.format("%.2f", perMonth)
    }
}
