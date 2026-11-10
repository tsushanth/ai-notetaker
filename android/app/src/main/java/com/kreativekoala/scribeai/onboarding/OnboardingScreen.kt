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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
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
import com.kreativekoala.scribeai.ui.components.turboLip
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AnalyticsService
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun OnboardingScreen(
    onboardingManager: OnboardingManager,
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
                            title = "Audio Podcasts (Pro)",
                            description = "ScribeAI is free. Podcasts are part of the optional Pro plan: turn your notes into audio and learn on the go.",
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.SOCIAL_PROOF -> SocialProofScreen(
                            onContinue = { onboardingManager.nextStep() }
                        )
                        OnboardingStep.COMPARISON -> ComparisonScreen(
                            onContinue = { onboardingManager.nextStep() }
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
                    Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                    contentDescription = "Back",
                    tint = TextPrimary,
                    modifier = Modifier.size(32.dp)
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
                .height(6.dp)
                .clip(CircleShape)
                .background(TurboLip)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(currentStep.progress)
                    .clip(CircleShape)
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
            fontSize = 32.sp,
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
            fontSize = 32.sp,
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
            modifier = Modifier.size(150.dp),
            shape = RoundedCornerShape(36.dp),
            color = Purple20
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    tint = Color(0xFF8D67CC)
                )
            }
        }

        Spacer(Modifier.height(40.dp))

        Text(
            title,
            fontSize = 32.sp,
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
// Kept as the SOCIAL_PROOF step so the onboarding flow is unchanged. It makes only
// claims the app can back up: no user counts, ratings, or testimonials.

@Composable
private fun SocialProofScreen(onContinue: () -> Unit) {
    val highlights = listOf(
        Highlight("AI summaries", "Turn lectures, videos, and documents into clear, organized notes."),
        Highlight("Flashcards and quizzes", "Generate study material from your own notes to review and practice."),
        Highlight("Study on the go", "Listen to your notes as audio podcasts whenever it suits you.")
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
            "Built for Students",
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(32.dp))

        highlights.forEach { highlight ->
            HighlightCard(highlight)
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

private data class Highlight(val title: String, val text: String)

@Composable
private fun HighlightCard(highlight: Highlight) {
    val cardShape = RoundedCornerShape(20.dp)
    Box(modifier = Modifier.fillMaxWidth().padding(bottom = 3.dp)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .turboLip(cardShape)
                .clip(cardShape)
                .background(CardBackground)
                .border(BorderStroke(1.dp, TurboBorder), cardShape)
                .padding(16.dp)
        ) {
            Text(
                highlight.title,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )

            Spacer(Modifier.height(8.dp))

            Text(
                highlight.text,
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
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(32.dp))

        // Comparison table
        val tableShape = RoundedCornerShape(20.dp)
        Box(modifier = Modifier.fillMaxWidth().padding(bottom = 3.dp)) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .turboLip(tableShape)
                    .clip(tableShape)
                    .background(CardBackground)
                    .border(BorderStroke(1.dp, TurboBorder), tableShape)
                    .padding(16.dp)
            ) {
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
                        color = PurpleGrey80,
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
                    "Audio Podcasts (Pro)" to Pair(false, true),
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
            modifier = Modifier.size(150.dp),
            shape = RoundedCornerShape(36.dp),
            color = Purple20
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Notifications,
                    contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    tint = Color(0xFF8D67CC)
                )
            }
        }

        Spacer(Modifier.height(40.dp))

        Text(
            "Stay on Track",
            fontSize = 32.sp,
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
    val pillShape = RoundedCornerShape(50)
    Box(modifier = Modifier.fillMaxWidth().padding(bottom = 3.dp)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .turboLip(pillShape)
                .clip(pillShape)
                .background(if (isSelected) DarkSurfaceVariant else CardBackground)
                .border(BorderStroke(if (isSelected) 2.dp else 1.dp, if (isSelected) Purple80 else TurboBorder), pillShape)
                .clickable(onClick = onClick)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                title,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp)
            )

            Box(modifier = Modifier.align(Alignment.CenterEnd)) {
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
                            .border(2.dp, TurboBorder, CircleShape)
                    )
                }
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
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            "$title →",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = if (enabled) TextPrimary else TextTertiary
        )
    }
}
