package com.kreativekoala.scribeai.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.SubscriptionManager

@Composable
fun PaywallScreen(
    subscriptionManager: SubscriptionManager,
    onDismiss: () -> Unit,
    onSubscribe: () -> Unit
) {
    var selectedPlan by remember { mutableStateOf(SubscriptionManager.YEARLY_SUB_ID) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val context = LocalContext.current
    val activity = context as? androidx.activity.ComponentActivity

    // Get formatted prices from billing client (localized)
    val monthlyPrice = subscriptionManager.getFormattedPrice(SubscriptionManager.MONTHLY_SUB_ID)
    val yearlyPrice = subscriptionManager.getFormattedPrice(SubscriptionManager.YEARLY_SUB_ID)

    // Calculate dynamic values from actual prices
    val yearlyPricePerMonth = subscriptionManager.getYearlyPricePerMonth()
    val savingsPercentage = subscriptionManager.getSavingsPercentage()
    val pricesLoaded = subscriptionManager.arePricesLoaded()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            // Header
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Purple80.copy(alpha = 0.1f),
                        shape = RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)
                    )
                    .padding(24.dp)
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    // Logo
                    Icon(
                        Icons.Default.AutoAwesome,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = Purple80
                    )

                    Spacer(Modifier.height(16.dp))

                    Text(
                        "Unlock Premium",
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

                    Spacer(Modifier.height(8.dp))

                    Text(
                        "Create unlimited notebooks and access all AI features",
                        fontSize = 16.sp,
                        color = TextSecondary,
                        textAlign = TextAlign.Center
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp),
                horizontalArrangement = Arrangement.End
            ) {
                TextButton(onClick = onDismiss) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Close",
                        tint = TextSecondary,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "Maybe Later",
                        color = TextSecondary,
                        fontSize = 14.sp
                    )
                }
            }

            Spacer(Modifier.height(32.dp))

            // Features list
            Column(
                modifier = Modifier.padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                FeatureItem(
                    icon = Icons.Default.Inventory,
                    title = "Unlimited Notebooks",
                    description = "Create as many notebooks as you need"
                )

                FeatureItem(
                    icon = Icons.Default.AutoAwesome,
                    title = "All AI Features",
                    description = "Summaries, podcasts, quizzes, flashcards & chat"
                )

                FeatureItem(
                    icon = Icons.Default.Cloud,
                    title = "Cloud Sync",
                    description = "Access your notes from any device"
                )

                FeatureItem(
                    icon = Icons.Default.Speed,
                    title = "Priority Processing",
                    description = "Faster AI generation and transcription"
                )

                FeatureItem(
                    icon = Icons.Default.SupportAgent,
                    title = "Priority Support",
                    description = "Get help when you need it"
                )
            }

            Spacer(Modifier.height(32.dp))

            // Subscription plans
            Column(
                modifier = Modifier.padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    "Choose Your Plan",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )

                Spacer(Modifier.height(8.dp))

                // Build dynamic features list for yearly plan
                val yearlyFeatures = buildList {
                    if (yearlyPricePerMonth.isNotEmpty()) {
                        add("$yearlyPricePerMonth/month")
                    }
                    add("Best value")
                    add("Cancel anytime")
                }

                // Yearly plan (recommended)
                SubscriptionPlanCard(
                    title = "Yearly",
                    price = yearlyPrice,
                    period = "per year",
                    savings = if (savingsPercentage > 0) "Save $savingsPercentage%" else null,
                    features = yearlyFeatures,
                    isSelected = selectedPlan == SubscriptionManager.YEARLY_SUB_ID,
                    isRecommended = true,
                    onClick = { selectedPlan = SubscriptionManager.YEARLY_SUB_ID }
                )

                // Monthly plan
                SubscriptionPlanCard(
                    title = "Monthly",
                    price = monthlyPrice,
                    period = "per month",
                    savings = null,
                    features = listOf(
                        "Flexible billing",
                        "Cancel anytime"
                    ),
                    isSelected = selectedPlan == SubscriptionManager.MONTHLY_SUB_ID,
                    isRecommended = false,
                    onClick = { selectedPlan = SubscriptionManager.MONTHLY_SUB_ID }
                )
            }

            Spacer(Modifier.height(24.dp))

            // Error message
            AnimatedVisibility(visible = errorMessage != null) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = AccentRed.copy(alpha = 0.1f)
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = null,
                            tint = AccentRed,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            errorMessage ?: "",
                            fontSize = 14.sp,
                            color = AccentRed
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Subscribe button
            Button(
                onClick = {
                    if (activity != null) {
                        isLoading = true
                        errorMessage = null

                        subscriptionManager.launchSubscriptionFlow(
                            activity = activity,
                            productId = selectedPlan,
                            onSuccess = {
                                isLoading = false
                                onSubscribe()
                            },
                            onError = { error ->
                                isLoading = false
                                errorMessage = error
                            }
                        )
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(horizontal = 24.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Purple80
                ),
                shape = RoundedCornerShape(12.dp),
                enabled = !isLoading && pricesLoaded
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text(
                        "Continue",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // Terms & Privacy - CLICKABLE LINKS
            TermsAndPrivacyText(
                modifier = Modifier.padding(horizontal = 32.dp)
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * Clickable Terms of Service and Privacy Policy text
 */
@Composable
fun TermsAndPrivacyText(
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    // TODO: Replace with your actual URLs
    val termsUrl = "https://www.sendsmiles.biz/terms-of-service"
    val privacyUrl = "https://www.sendsmiles.biz/privacy-policy"

    val annotatedString = buildAnnotatedString {
        withStyle(style = SpanStyle(color = TextTertiary, fontSize = 11.sp)) {
            append("By subscribing, you agree to our ")
        }

        // Terms of Service - clickable
        pushStringAnnotation(tag = "URL", annotation = termsUrl)
        withStyle(
            style = SpanStyle(
                color = Purple80,
                fontSize = 11.sp,
                textDecoration = TextDecoration.Underline
            )
        ) {
            append("Terms of Service")
        }
        pop()

        withStyle(style = SpanStyle(color = TextTertiary, fontSize = 11.sp)) {
            append(" and ")
        }

        // Privacy Policy - clickable
        pushStringAnnotation(tag = "URL", annotation = privacyUrl)
        withStyle(
            style = SpanStyle(
                color = Purple80,
                fontSize = 11.sp,
                textDecoration = TextDecoration.Underline
            )
        ) {
            append("Privacy Policy")
        }
        pop()

        withStyle(style = SpanStyle(color = TextTertiary, fontSize = 11.sp)) {
            append(". Subscription automatically renews unless canceled at least 24 hours before the end of the current period.")
        }
    }

    ClickableText(
        text = annotatedString,
        modifier = modifier,
        style = LocalTextStyle.current.copy(
            textAlign = TextAlign.Center,
            lineHeight = 16.sp
        ),
        onClick = { offset ->
            annotatedString.getStringAnnotations(tag = "URL", start = offset, end = offset)
                .firstOrNull()?.let { annotation ->
                    // Open URL in browser
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(annotation.item))
                    context.startActivity(intent)
                }
        }
    )
}

@Composable
fun SubscriptionPlanCard(
    title: String,
    price: String,
    period: String,
    savings: String?,
    features: List<String>,
    isSelected: Boolean,
    isRecommended: Boolean,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) Purple80.copy(alpha = 0.15f) else CardBackground
        ),
        shape = RoundedCornerShape(16.dp),
        border = if (isSelected) {
            BorderStroke(2.dp, Purple80)
        } else {
            BorderStroke(1.dp, DarkSurfaceVariant)
        }
    ) {
        Column(
            modifier = Modifier.padding(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            title,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )

                        if (isRecommended) {
                            Spacer(Modifier.width(8.dp))
                            Surface(
                                color = Purple80,
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    "BEST VALUE",
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(4.dp))

                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            price.ifEmpty { "..." },
                            fontSize = 28.sp,
                            fontWeight = FontWeight.Bold,
                            color = Purple80
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            period,
                            fontSize = 14.sp,
                            color = TextSecondary
                        )
                    }

                    if (savings != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            savings,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color(0xFF4CAF50)
                        )
                    }
                }

                // Selection indicator
                if (isSelected) {
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = Purple80,
                        modifier = Modifier.size(28.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                } else {
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = Color.Transparent,
                        modifier = Modifier
                            .size(28.dp)
                            .border(2.dp, DarkSurfaceVariant, RoundedCornerShape(50))
                    ) {}
                }
            }

            Spacer(Modifier.height(16.dp))

            // Features
            features.forEach { feature ->
                Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.padding(vertical = 4.dp)
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = Purple80,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        feature,
                        fontSize = 14.sp,
                        color = TextSecondary
                    )
                }
            }
        }
    }
}

@Composable
fun FeatureItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String
) {
    Row(
        verticalAlignment = Alignment.Top
    ) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = Purple80.copy(alpha = 0.2f),
            modifier = Modifier.size(40.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = Purple80,
                    modifier = Modifier.size(20.dp)
                )
            }
        }

        Spacer(Modifier.width(16.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )
            Spacer(Modifier.height(2.dp))
            Text(
                description,
                fontSize = 14.sp,
                color = TextSecondary,
                lineHeight = 20.sp
            )
        }
    }
}