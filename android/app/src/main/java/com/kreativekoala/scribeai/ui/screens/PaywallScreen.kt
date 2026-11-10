package com.kreativekoala.scribeai.ui.screens

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.VideoCall
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Podcasts
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.ui.theme.Purple80
import com.kreativekoala.scribeai.utils.SubscriptionManager

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

/** The three Pro features: everything else in ScribeAI is free. */
enum class ProFeature { PODCAST, INFOGRAPHIC, MEETING_BOT }

private const val TURBO_TERMS_URL = "https://scribeai.online/terms"
private const val PLANS_TIMEOUT_MS = 8_000L

/**
 * The single "Go Pro" screen. It is only shown when someone opens a Pro feature (podcast, infographic,
 * meeting bot) without Pro; it is always dismissible. [feature] tells the user which feature they
 * opened. Prices come from Google Play Billing.
 */
@Composable
fun PaywallScreen(
    subscriptionManager: SubscriptionManager,
    onDismiss: () -> Unit,
    onSubscribe: () -> Unit,
    feature: ProFeature? = null
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val products by subscriptionManager.products.collectAsState()
    val subscriptionState by subscriptionManager.subscriptionState.collectAsState()

    // Close by itself once a purchase (or restore) turns Pro on.
    LaunchedEffect(subscriptionState) {
        if (subscriptionState is SubscriptionManager.SubscriptionState.Subscribed) onSubscribe()
    }

    // Google Play can fail to return plans (no Play account, offline): say so instead of spinning forever.
    var plansTimedOut by remember { mutableStateOf(false) }
    LaunchedEffect(products.isEmpty()) {
        if (products.isEmpty()) {
            kotlinx.coroutines.delay(PLANS_TIMEOUT_MS)
            plansTimedOut = true
        } else {
            plansTimedOut = false
        }
    }

    if (products.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(TurboLightBase)
                .windowInsetsPadding(WindowInsets.statusBars),
            contentAlignment = Alignment.Center
        ) {
            if (plansTimedOut) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(32.dp)
                ) {
                    Text(
                        text = stringResource(R.string.pro_plans_unavailable),
                        color = TurboLightTextPrimary,
                        fontSize = 16.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    TextButton(onClick = onDismiss) {
                        Text(stringResource(R.string.close), color = TurboLightAccent)
                    }
                }
            } else {
                CircularProgressIndicator(color = Purple80)
            }
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

    TurboPaywallContent(
        products = paywallProducts,
        feature = feature,
        onDismiss = onDismiss,
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
                onError = {
                    Toast.makeText(context, context.getString(R.string.pro_nothing_to_restore), Toast.LENGTH_SHORT).show()
                }
            )
        }
    )
}

@Composable
private fun TurboPaywallContent(
    products: List<PaywallProduct>,
    feature: ProFeature?,
    onDismiss: () -> Unit,
    onPurchase: (String) -> Unit,
    onRestore: () -> Unit
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
                // bar window on some devices: the tap never reaches Compose at all because
                // that window intercepts it first, even though the content is drawn visibly.
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 20.dp)
        ) {
            Spacer(modifier = Modifier.height(16.dp))

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
                    contentDescription = stringResource(R.string.close),
                    tint = TurboLightTextPrimary,
                    modifier = Modifier.size(18.dp)
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = stringResource(R.string.pro_title),
                color = TurboLightTextPrimary,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(12.dp))

            if (feature != null) {
                Text(
                    text = stringResource(
                        when (feature) {
                            ProFeature.PODCAST -> R.string.pro_needed_podcast
                            ProFeature.INFOGRAPHIC -> R.string.pro_needed_infographic
                            ProFeature.MEETING_BOT -> R.string.pro_needed_meeting
                        }
                    ),
                    color = TurboLightTextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            Text(
                text = stringResource(R.string.pro_intro),
                color = TurboLightTextSecondary,
                fontSize = 15.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(20.dp))

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TurboFeatureCard(
                    icon = Icons.Filled.Podcasts,
                    title = stringResource(R.string.pro_feature_podcast),
                    subtitle = stringResource(R.string.pro_feature_podcast_desc)
                )
                TurboFeatureCard(
                    icon = Icons.Filled.Image,
                    title = stringResource(R.string.pro_feature_infographic),
                    subtitle = stringResource(R.string.pro_feature_infographic_desc)
                )
                TurboFeatureCard(
                    icon = Icons.Filled.VideoCall,
                    title = stringResource(R.string.pro_feature_meeting),
                    subtitle = stringResource(R.string.pro_feature_meeting_desc)
                )
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
                    text = stringResource(R.string.pro_cancel_anytime),
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
                    text = stringResource(R.string.pro_go_pro),
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
                    Text(stringResource(R.string.restore_purchases), color = TurboLightTextSecondary, fontSize = 13.sp)
                }
                TextButton(onClick = {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(TURBO_TERMS_URL))
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try { termsContext.startActivity(intent) } catch (_: Exception) {}
                }) {
                    Text(stringResource(R.string.pro_terms), color = TurboLightTextSecondary, fontSize = 13.sp)
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
    // Only the monthly and yearly Play subscriptions exist.
    val periodLabel = stringResource(
        if (product.period == PaywallProduct.Period.YEARLY) R.string.plan_yearly else R.string.plan_monthly
    )

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
                text = product.localizedPrice + (monthlyEquivalent?.let { " (" + stringResource(R.string.per_month_format, it) + ")" } ?: ""),
                color = TurboLightTextSecondary,
                fontSize = 13.sp
            )
            product.trialDays?.let { days ->
                Text(
                    text = stringResource(R.string.pro_trial_format, days),
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
