package com.kreativekoala.scribeai.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.revenuecat.purchases.Package

@Composable
fun PaywallScreen(
    subscriptionManager: SubscriptionManager,
    onDismiss: () -> Unit,
    onSubscribe: () -> Unit,
    dismissable: Boolean = true
) {
    val context = LocalContext.current
    val activity = context as? Activity
    var selectedPlan by remember { mutableStateOf("yearly") }
    val products by subscriptionManager.products.collectAsState()

    val monthlyPrice = subscriptionManager.getFormattedPrice(SubscriptionManager.MONTHLY_SUB_ID)
    val yearlyPrice = subscriptionManager.getFormattedPrice(SubscriptionManager.YEARLY_SUB_ID)
    val yearlyPerMonth = subscriptionManager.getYearlyPricePerMonth()
    val savingsPercent = subscriptionManager.getSavingsPercentage()

    Dialog(
        onDismissRequest = { if (dismissable) onDismiss() },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = dismissable,
            dismissOnClickOutside = dismissable
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Close button (hidden for hard paywall)
                if (dismissable) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.close))
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Title
                Text(
                    text = stringResource(R.string.unlock_pro),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = stringResource(R.string.unlimited_access),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(24.dp))

                // Features list
                val features = listOf(
                    stringResource(R.string.feature_unlimited_notes),
                    stringResource(R.string.feature_ai_summaries),
                    stringResource(R.string.feature_flashcards),
                    stringResource(R.string.feature_ai_chat),
                    stringResource(R.string.feature_mind_map),
                    stringResource(R.string.feature_podcast)
                )

                features.forEach { feature ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = null,
                            tint = Color(0xFF4CAF50),
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = feature,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }

                Spacer(modifier = Modifier.height(32.dp))

                // Yearly plan
                PlanCard(
                    title = stringResource(R.string.plan_yearly),
                    price = yearlyPrice,
                    perMonth = if (yearlyPerMonth.isNotEmpty()) stringResource(R.string.per_month_format, yearlyPerMonth) else "",
                    badge = if (savingsPercent > 0) stringResource(R.string.save_percent_format, savingsPercent.toInt()) else null,
                    isSelected = selectedPlan == "yearly",
                    onClick = { selectedPlan = "yearly" }
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Monthly plan
                PlanCard(
                    title = stringResource(R.string.plan_monthly),
                    price = monthlyPrice,
                    perMonth = "",
                    badge = null,
                    isSelected = selectedPlan == "monthly",
                    onClick = { selectedPlan = "monthly" }
                )

                Spacer(modifier = Modifier.weight(1f))

                // Subscribe button
                Button(
                    onClick = {
                        if (activity != null) {
                            val productId = if (selectedPlan == "yearly")
                                SubscriptionManager.YEARLY_SUB_ID
                            else
                                SubscriptionManager.MONTHLY_SUB_ID

                            subscriptionManager.launchSubscriptionFlow(
                                activity = activity,
                                productId = productId,
                                onSuccess = { onSubscribe() },
                                onError = { /* handled by billing client listener */ }
                            )
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary
                    ),
                    enabled = products.isNotEmpty()
                ) {
                    Text(
                        text = if (products.isEmpty()) stringResource(R.string.loading_plans) else stringResource(R.string.continue_button),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Restore / Terms
                TextButton(onClick = {
                    subscriptionManager.restorePurchases(
                        onSuccess = { onSubscribe() },
                        onError = { /* silently ignore */ }
                    )
                }) {
                    Text(
                        text = stringResource(R.string.restore_purchases),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun PlanCard(
    title: String,
    price: String,
    perMonth: String,
    badge: String?,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val borderColor = if (isSelected)
        MaterialTheme.colorScheme.primary
    else
        MaterialTheme.colorScheme.outlineVariant

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .border(
                width = if (isSelected) 2.dp else 1.dp,
                color = borderColor,
                shape = RoundedCornerShape(16.dp)
            )
            .clickable { onClick() }
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(
                        selected = isSelected,
                        onClick = onClick,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    if (badge != null) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            color = Color(0xFF4CAF50)
                        ) {
                            Text(
                                text = badge,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
                if (perMonth.isNotEmpty()) {
                    Text(
                        text = perMonth,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 28.dp)
                    )
                }
            }
            Text(
                text = price,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}
