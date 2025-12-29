package com.kreativekoala.scribeai.onboarding

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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
import com.kreativekoala.scribeai.utils.AnalyticsService
import com.kreativekoala.scribeai.utils.SubscriptionManager
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun OnboardingScreen(
    onboardingManager: OnboardingManager,
    subscriptionManager: SubscriptionManager,
    onComplete: () -> Unit
) {
    val currentStep by onboardingManager.currentStep.collectAsState()
    val hasCompleted by onboardingManager.hasCompletedOnboarding.collectAsState()

    // Complete when onboarding is done
    LaunchedEffect(hasCompleted) {
        if (hasCompleted) {
            onComplete()
        }
    }

    // Track onboarding started
    LaunchedEffect(Unit) {
        AnalyticsService.trackOnboardingStarted()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header with progress and navigation
            OnboardingHeader(
                currentStep = currentStep,
                onBack = { onboardingManager.previousStep() },
                onSkip = { onboardingManager.skipOnboarding() }
            )

            // Content based on current step
            AnimatedContent(
                targetState = currentStep,
                transitionSpec = {
                    slideInHorizontally { if (targetState.index > initialState.index) it else -it } + fadeIn() togetherWith
                            slideOutHorizontally { if (targetState.index > initialState.index) -it else it } + fadeOut()
                },
                label = "onboarding_content"
            ) { step ->
                Box(modifier = Modifier.fillMaxSize()) {
                    when (step) {
                        OnboardingStep.USER_TYPE -> UserTypeScreen(onboardingManager)
                        OnboardingStep.USE_CASE -> UseCaseScreen(onboardingManager)
                        OnboardingStep.FEATURE_UPLOAD -> FeatureScreen(
                            icon = Icons.Default.CloudUpload,
                            title = "Upload Any Content",
                            description = "Import PDFs, record audio, paste YouTube links, or scan documents. We'll convert them to smart notes.",
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.FEATURE_NOTES -> FeatureScreen(
                            icon = Icons.Default.AutoAwesome,
                            title = "AI-Powered Notes",
                            description = "Get instant summaries, key points, and organized notes from any content you upload.",
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.FEATURE_FLASHCARDS -> FeatureScreen(
                            icon = Icons.Default.Style,
                            title = "Smart Flashcards",
                            description = "Auto-generate flashcards from your notes. Perfect for memorization and spaced repetition.",
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.FEATURE_QUIZ -> FeatureScreen(
                            icon = Icons.Default.Quiz,
                            title = "Interactive Quizzes",
                            description = "Test your knowledge with AI-generated quizzes. Track your progress and identify weak areas.",
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.FEATURE_AUDIO -> FeatureScreen(
                            icon = Icons.Default.Podcasts,
                            title = "Audio Podcasts",
                            description = "Turn your notes into engaging audio podcasts. Learn on the go while commuting or exercising.",
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.SOCIAL_PROOF -> SocialProofScreen(
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.COMPARISON -> ComparisonScreen(
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.TRIAL -> TrialScreen(
                            subscriptionManager = subscriptionManager,
                            onSkip = { onboardingManager.skipTrial() },
                            onSuccess = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.NOTIFICATIONS -> NotificationsScreen(
                            onComplete = { onboardingManager.markOnboardingComplete() }
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Header

@Composable
private fun OnboardingHeader(
    currentStep: OnboardingStep,
    onBack: () -> Unit,
    onSkip: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Back button
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .size(40.dp)
                    .then(if (currentStep.index > 0) Modifier else Modifier.alpha(0f))
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = TextSecondary
                )
            }

            // Skip button
            TextButton(onClick = onSkip) {
                Text(
                    "Skip",
                    color = TextSecondary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }

        // Progress bar
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Color.White.copy(alpha = 0.1f))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(currentStep.progress)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Purple80)
            )
        }
    }
}


// MARK: - User Type Screen

@Composable
private fun UserTypeScreen(manager: OnboardingManager) {
    val selectedType by manager.selectedUserType.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        Text(
            "Tell us about yourself",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(8.dp))

        Text(
            "This helps us personalize your experience",
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(32.dp))

        UserType.values().forEach { userType ->
            SelectableCard(
                title = userType.displayName,
                isSelected = selectedType == userType,
                onClick = { manager.selectUserType(userType) }
            )
            Spacer(Modifier.height(12.dp))
        }

        Spacer(Modifier.weight(1f))

        OnboardingPrimaryButton(
            title = "Continue",
            onClick = { manager.nextStep() },
            enabled = selectedType != null
        )

        Spacer(Modifier.height(32.dp))
    }
}

// MARK: - Use Case Screen

@Composable
private fun UseCaseScreen(manager: OnboardingManager) {
    val selectedCases by manager.selectedUseCases.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        Text(
            "How will you use ScribeAI?",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(8.dp))

        Text(
            "Select all that apply",
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(32.dp))

        UseCase.values().forEach { useCase ->
            SelectableCard(
                title = useCase.displayName,
                isSelected = selectedCases.contains(useCase),
                onClick = { manager.toggleUseCase(useCase) },
                showCheckbox = true
            )
            Spacer(Modifier.height(12.dp))
        }

        Spacer(Modifier.weight(1f))

        OnboardingPrimaryButton(
            title = "Continue",
            onClick = { manager.nextStep() },
            enabled = selectedCases.isNotEmpty()
        )

        Spacer(Modifier.height(32.dp))
    }
}

// MARK: - Feature Screen

@Composable
private fun FeatureScreen(
    icon: ImageVector,
    title: String,
    description: String,
    onContinue: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(Modifier.weight(0.3f))

        // Icon
        Surface(
            modifier = Modifier.size(120.dp),
            shape = CircleShape,
            color = Purple80.copy(alpha = 0.2f)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.size(60.dp),
                    tint = Purple80
                )
            }
        }

        Spacer(Modifier.height(40.dp))

        Text(
            title,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(16.dp))

        Text(
            description,
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            lineHeight = 24.sp
        )

        Spacer(Modifier.weight(0.5f))

        OnboardingPrimaryButton(
            title = "Continue",
            onClick = onContinue
        )

        Spacer(Modifier.height(32.dp))
    }
}

// MARK: - Social Proof Screen

@Composable
private fun SocialProofScreen(onContinue: () -> Unit) {
    val reviews = listOf(
        Review("Sarah M.", "This app transformed my study routine! The AI summaries save me hours.", 5),
        Review("James K.", "Finally an app that actually understands my lecture notes.", 5),
        Review("Emily R.", "The flashcards feature is incredible. Passed my exams with flying colors!", 5)
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        Text(
            "Join 50,000+ Students",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(8.dp))

        // Star rating
        Row(horizontalArrangement = Arrangement.Center) {
            repeat(5) {
                Icon(
                    Icons.Default.Star,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = Color(0xFFFFD700)
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(
                "4.9 on App Store",
                fontSize = 16.sp,
                color = TextSecondary
            )
        }

        Spacer(Modifier.height(32.dp))

        reviews.forEach { review ->
            ReviewCard(review)
            Spacer(Modifier.height(16.dp))
        }

        Spacer(Modifier.weight(1f))

        OnboardingPrimaryButton(
            title = "Continue",
            onClick = onContinue
        )

        Spacer(Modifier.height(32.dp))
    }
}

private data class Review(val name: String, val text: String, val rating: Int)

@Composable
private fun ReviewCard(review: Review) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = CardBackground),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Avatar
                Surface(
                    modifier = Modifier.size(40.dp),
                    shape = CircleShape,
                    color = Purple80.copy(alpha = 0.3f)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            review.name.first().toString(),
                            fontWeight = FontWeight.Bold,
                            color = Purple80
                        )
                    }
                }

                Spacer(Modifier.width(12.dp))

                Column {
                    Text(
                        review.name,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                    Row {
                        repeat(review.rating) {
                            Icon(
                                Icons.Default.Star,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = Color(0xFFFFD700)
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            Text(
                review.text,
                fontSize = 14.sp,
                color = TextSecondary,
                lineHeight = 20.sp
            )
        }
    }
}

// MARK: - Comparison Screen

@Composable
private fun ComparisonScreen(onContinue: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        Text(
            "Study Smarter, Not Harder",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(32.dp))

        // Comparison table
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = CardBackground),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                // Header
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        "Feature",
                        modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold,
                        color = TextSecondary
                    )
                    Text(
                        "Others",
                        modifier = Modifier.weight(0.5f),
                        fontWeight = FontWeight.SemiBold,
                        color = TextSecondary,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        "ScribeAI",
                        modifier = Modifier.weight(0.5f),
                        fontWeight = FontWeight.SemiBold,
                        color = Purple80,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(16.dp))
                HorizontalDivider(color = DarkSurfaceVariant)
                Spacer(Modifier.height(16.dp))

                val features = listOf(
                    "AI Summaries" to Pair(false, true),
                    "Auto Flashcards" to Pair(false, true),
                    "Quiz Generation" to Pair(false, true),
                    "Audio Podcasts" to Pair(false, true),
                    "PDF/YouTube Import" to Pair(true, true),
                    "Cloud Sync" to Pair(true, true)
                )

                features.forEach { (feature, checks) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            feature,
                            modifier = Modifier.weight(1f),
                            color = TextPrimary,
                            fontSize = 14.sp
                        )
                        Box(
                            modifier = Modifier.weight(0.5f),
                            contentAlignment = Alignment.Center
                        ) {
                            if (checks.first) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = null,
                                    tint = TextSecondary,
                                    modifier = Modifier.size(20.dp)
                                )
                            } else {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = null,
                                    tint = AccentRed.copy(alpha = 0.5f),
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        Box(
                            modifier = Modifier.weight(0.5f),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = AccentGreen,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.weight(1f))

        OnboardingPrimaryButton(
            title = "Continue",
            onClick = onContinue
        )

        Spacer(Modifier.height(32.dp))
    }
}

// MARK: - Trial Screen

@Composable
private fun TrialScreen(
    subscriptionManager: SubscriptionManager,
    onSkip: () -> Unit,
    onSuccess: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? Activity

    var selectedPlan by remember { mutableStateOf(SubscriptionManager.YEARLY_SUB_ID) }
    var isPurchasing by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Get prices
    val monthlyPrice = subscriptionManager.getFormattedPrice(SubscriptionManager.MONTHLY_SUB_ID)
    val yearlyPrice = subscriptionManager.getFormattedPrice(SubscriptionManager.YEARLY_SUB_ID)
    val yearlyPricePerWeek = subscriptionManager.getYearlyPricePerWeek()
    val pricesLoaded = subscriptionManager.arePricesLoaded()

    // Date formatter
    val dateFormatter = remember { SimpleDateFormat("MMM d, yyyy", Locale.getDefault()) }
    val calendar = remember { Calendar.getInstance() }

    val today = dateFormatter.format(calendar.time)
    calendar.add(Calendar.DAY_OF_YEAR, 5)
    val reminderDate = dateFormatter.format(calendar.time)
    calendar.add(Calendar.DAY_OF_YEAR, 2)
    val endDate = dateFormatter.format(calendar.time)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        // Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(24.dp))

            Text(
                "Skeptical? Try ScribeAI Pro",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
                textAlign = TextAlign.Center
            )

            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = AccentGreen, textDecoration = TextDecoration.Underline)) {
                        append("free for 7 days.")
                    }
                },
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
        }

        Spacer(Modifier.height(32.dp))

        // Timeline
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
        ) {
            Text(
                "How your free trial works:",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextSecondary
            )

            Spacer(Modifier.height(24.dp))

            TimelineItem(
                icon = Icons.Default.CheckBox,
                iconColor = AccentGreen,
                title = "Today - Free trial starts",
                subtitle = "Enjoy full access free for 7 days",
                isLast = false
            )

            TimelineItem(
                icon = Icons.Default.Email,
                iconColor = Color(0xFF2196F3),
                title = "$reminderDate - Email reminder",
                subtitle = "We'll let you know when your trial is ending",
                isLast = false
            )

            TimelineItem(
                icon = Icons.Default.Favorite,
                iconColor = Color(0xFFF44336),
                title = "$endDate - Become a member",
                subtitle = "Your trial ends unless canceled. Enjoy!",
                isLast = true
            )
        }

        Spacer(Modifier.height(32.dp))

        // Pricing info
        if (pricesLoaded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val selectedProductId = selectedPlan
                val selectedPrice = if (selectedProductId == SubscriptionManager.YEARLY_SUB_ID) yearlyPrice else monthlyPrice
                val period = if (selectedProductId == SubscriptionManager.YEARLY_SUB_ID) "year" else "month"

                Text(
                    "7 days free, then $selectedPrice/$period",
                    fontSize = 14.sp,
                    color = TextSecondary
                )

                if (selectedProductId == SubscriptionManager.YEARLY_SUB_ID && yearlyPricePerWeek.isNotEmpty()) {
                    Text(
                        "Only $yearlyPricePerWeek / week",
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // Plan selector
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            PlanPill(
                title = "Yearly",
                price = yearlyPrice,
                weeklyPrice = yearlyPricePerWeek,
                isSelected = selectedPlan == SubscriptionManager.YEARLY_SUB_ID,
                isBestValue = true,
                modifier = Modifier.weight(1f),
                onClick = { selectedPlan = SubscriptionManager.YEARLY_SUB_ID }
            )

            PlanPill(
                title = "Monthly",
                price = monthlyPrice,
                weeklyPrice = null,
                isSelected = selectedPlan == SubscriptionManager.MONTHLY_SUB_ID,
                isBestValue = false,
                modifier = Modifier.weight(1f),
                onClick = { selectedPlan = SubscriptionManager.MONTHLY_SUB_ID }
            )
        }

        Spacer(Modifier.height(24.dp))

        // Error message
        if (errorMessage != null) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp),
                colors = CardDefaults.cardColors(containerColor = AccentRed.copy(alpha = 0.1f))
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
                    Text(errorMessage ?: "", fontSize = 14.sp, color = AccentRed)
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Start Trial Button
        Button(
            onClick = {
                if (activity != null) {
                    isPurchasing = true
                    errorMessage = null

                    subscriptionManager.launchSubscriptionFlow(
                        activity = activity,
                        productId = selectedPlan,
                        onSuccess = {
                            isPurchasing = false
                            onSuccess()
                        },
                        onError = { error ->
                            isPurchasing = false
                            errorMessage = error
                        }
                    )
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 24.dp),
            colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
            shape = RoundedCornerShape(16.dp),
            enabled = !isPurchasing && pricesLoaded
        ) {
            if (isPurchasing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = Color.White,
                    strokeWidth = 2.dp
                )
            } else {
                Text(
                    "Start your free 7-day trial",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // Google Play badge
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Lock,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = TextTertiary
            )
            Spacer(Modifier.width(6.dp))
            Text(
                "Cancel anytime. Secure with Google Play.",
                fontSize = 13.sp,
                color = TextTertiary
            )
        }

        // Skip button
        TextButton(
            onClick = onSkip,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
        ) {
            Text(
                "Skip for now",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = TextSecondary
            )
        }

        // Terms
        TrialTermsText(
            modifier = Modifier.padding(horizontal = 32.dp, vertical = 16.dp)
        )

        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun TimelineItem(
    icon: ImageVector,
    iconColor: Color,
    title: String,
    subtitle: String,
    isLast: Boolean
) {
    Row(
        modifier = Modifier.padding(bottom = if (isLast) 0.dp else 8.dp),
        verticalAlignment = Alignment.Top
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = iconColor
            )
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(40.dp)
                        .background(TextTertiary.copy(alpha = 0.3f))
                )
            }
        }

        Spacer(Modifier.width(16.dp))

        Column(modifier = Modifier.padding(bottom = if (isLast) 0.dp else 16.dp)) {
            Text(
                title,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )
            Spacer(Modifier.height(4.dp))
            Text(
                subtitle,
                fontSize = 14.sp,
                color = TextSecondary
            )
        }
    }
}

@Composable
private fun PlanPill(
    title: String,
    price: String,
    weeklyPrice: String?,
    isSelected: Boolean,
    isBestValue: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = CardBackground),
        shape = RoundedCornerShape(12.dp),
        border = if (isSelected) BorderStroke(2.dp, Purple80) else null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (isBestValue) {
                Surface(
                    color = AccentGreen,
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        "BEST VALUE",
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
                Spacer(Modifier.height(4.dp))
            }

            Text(
                title,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )

            Text(
                price.ifEmpty { "..." },
                fontSize = 12.sp,
                color = TextSecondary
            )

            if (weeklyPrice != null) {
                Text(
                    "$weeklyPrice/wk",
                    fontSize = 11.sp,
                    color = Purple80
                )
            }
        }
    }
}

@Composable
private fun TrialTermsText(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val termsUrl = "https://scribeai.online/terms"
    val privacyUrl = "https://scribeai.online/privacy"

    val annotatedString = buildAnnotatedString {
        withStyle(SpanStyle(color = TextTertiary, fontSize = 11.sp)) {
            append("By subscribing, you agree to our ")
        }

        pushStringAnnotation(tag = "URL", annotation = termsUrl)
        withStyle(SpanStyle(color = Purple80, fontSize = 11.sp, textDecoration = TextDecoration.Underline)) {
            append("Terms of Service")
        }
        pop()

        withStyle(SpanStyle(color = TextTertiary, fontSize = 11.sp)) {
            append(" and ")
        }

        pushStringAnnotation(tag = "URL", annotation = privacyUrl)
        withStyle(SpanStyle(color = Purple80, fontSize = 11.sp, textDecoration = TextDecoration.Underline)) {
            append("Privacy Policy")
        }
        pop()

        withStyle(SpanStyle(color = TextTertiary, fontSize = 11.sp)) {
            append(". Subscription automatically renews unless canceled at least 24 hours before the end of the current period.")
        }
    }

    ClickableText(
        text = annotatedString,
        modifier = modifier,
        style = LocalTextStyle.current.copy(textAlign = TextAlign.Center, lineHeight = 16.sp),
        onClick = { offset ->
            annotatedString.getStringAnnotations(tag = "URL", start = offset, end = offset)
                .firstOrNull()?.let { annotation ->
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(annotation.item))
                    context.startActivity(intent)
                }
        }
    )
}

// MARK: - Notifications Screen

@Composable
private fun NotificationsScreen(onComplete: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(Modifier.weight(0.3f))

        Surface(
            modifier = Modifier.size(120.dp),
            shape = CircleShape,
            color = Purple80.copy(alpha = 0.2f)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Notifications,
                    contentDescription = null,
                    modifier = Modifier.size(60.dp),
                    tint = Purple80
                )
            }
        }

        Spacer(Modifier.height(40.dp))

        Text(
            "Stay on Track",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(16.dp))

        Text(
            "Get reminders to study, notifications about new features, and tips to maximize your learning.",
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            lineHeight = 24.sp
        )

        Spacer(Modifier.weight(0.5f))

        OnboardingPrimaryButton(
            title = "Enable Notifications",
            onClick = {
                // TODO: Request notification permission
                onComplete()
            }
        )

        Spacer(Modifier.height(16.dp))

        TextButton(onClick = onComplete) {
            Text(
                "Maybe Later",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = TextSecondary
            )
        }

        Spacer(Modifier.height(32.dp))
    }
}

// MARK: - Shared Components

@Composable
private fun SelectableCard(
    title: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    showCheckbox: Boolean = false
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) Purple80.copy(alpha = 0.15f) else CardBackground
        ),
        shape = RoundedCornerShape(12.dp),
        border = if (isSelected) BorderStroke(2.dp, Purple80) else null
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                title,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = TextPrimary
            )

            if (showCheckbox) {
                if (isSelected) {
                    Surface(
                        modifier = Modifier.size(24.dp),
                        shape = RoundedCornerShape(6.dp),
                        color = Purple80
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .border(2.dp, DarkSurfaceVariant, RoundedCornerShape(6.dp))
                    )
                }
            } else {
                if (isSelected) {
                    Surface(
                        modifier = Modifier.size(24.dp),
                        shape = CircleShape,
                        color = Purple80
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .border(2.dp, DarkSurfaceVariant, CircleShape)
                    )
                }
            }
        }
    }
}

@Composable
private fun OnboardingPrimaryButton(
    title: String,
    onClick: () -> Unit,
    enabled: Boolean = true
) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Purple80,
            disabledContainerColor = Purple80.copy(alpha = 0.5f)
        ),
        shape = RoundedCornerShape(16.dp),
        enabled = enabled
    ) {
        Text(
            title,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}
