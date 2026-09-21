package com.kreativekoala.scribeai.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.ui.theme.AccentRed
import com.kreativekoala.scribeai.ui.theme.DarkSurfaceVariant
import com.kreativekoala.scribeai.ui.theme.TextPrimary
import com.kreativekoala.scribeai.ui.theme.TurboBorder
import com.kreativekoala.scribeai.ui.theme.TurboLip
import com.kreativekoala.scribeai.ui.theme.TurboWave
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * Turbo's depth cue: a lighter slab peeking out under the bottom edge instead of a shadow.
 * The caller must leave [depth] of bottom padding, since the slab draws outside the bounds.
 */
fun Modifier.turboLip(shape: Shape, color: Color = TurboLip, depth: Dp = 3.dp): Modifier =
    drawBehind {
        val outline = shape.createOutline(size, layoutDirection, this)
        translate(top = depth.toPx()) {
            drawOutline(outline, color)
        }
    }

/** Rounded-pill chip with a colored icon disc, used for the "what are you adding" row on Home. */
@Composable
fun TurboChip(
    icon: ImageVector,
    label: String,
    accent: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.padding(bottom = 3.dp)) {
        Row(
            modifier = Modifier
                .turboLip(CircleShape)
                .clip(CircleShape)
                .background(DarkSurfaceVariant)
                .border(BorderStroke(1.dp, TurboBorder), CircleShape)
                .clickable(onClick = onClick)
                .padding(start = 8.dp, end = 18.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier.size(30.dp).clip(CircleShape).background(accent),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(17.dp))
            }
            Text(label, color = TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** Decorative waveform. Bars sway while [active]; otherwise they hold a still, uneven pattern. */
@Composable
fun TurboWaveform(active: Boolean, modifier: Modifier = Modifier, color: Color = TurboWave) {
    val transition = rememberInfiniteTransition(label = "wave")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * PI).toFloat(),
        animationSpec = infiniteRepeatable(tween(1800, easing = LinearEasing)),
        label = "phase"
    )
    Canvas(modifier = modifier.fillMaxWidth().height(96.dp)) {
        val bars = 46
        val slot = size.width / bars
        val barWidth = slot * 0.42f
        for (i in 0 until bars) {
            val seed = abs(sin(i * 12.9898f) * 43758.547f) % 1f
            val base = 0.15f + 0.85f * seed
            val fraction = if (active) 0.12f + 0.88f * abs(sin(i * 0.5f + phase)) * base else base * 0.6f
            val h = size.height * fraction
            drawRoundRect(
                color = color,
                topLeft = Offset(i * slot + (slot - barWidth) / 2, (size.height - h) / 2),
                size = Size(barWidth, h),
                cornerRadius = CornerRadius(barWidth / 2)
            )
        }
    }
}

/** Turbo's record control: solid red disc inside a faint ring. */
@Composable
fun TurboRecordButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = AccentRed
) {
    Box(
        modifier = modifier
            .size(112.dp)
            .border(3.dp, color.copy(alpha = 0.3f), CircleShape)
            .padding(9.dp)
            .clip(CircleShape)
            .background(color)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = contentDescription, tint = Color.White, modifier = Modifier.size(40.dp))
    }
}
