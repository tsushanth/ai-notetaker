package com.kreativekoala.scribeai.ui.theme

import androidx.compose.ui.graphics.Color

// Palette sampled from Turbo AI on-device (Sep 2026). Surfaces are dark violet-ink; depth comes
// from a lighter "lip" along the bottom edge of buttons and cards, not from shadows.
val DarkBackground = Color(0xFF191722)
val DarkSurface = Color(0xFF1F1C29)
val DarkSurfaceVariant = Color(0xFF262333)
val CardBackground = Color(0xFF1F1C29)
val TurboLip = Color(0xFF3B3749)
val TurboBorder = Color(0xFF393547)

// Accent. Names kept from the old palette so existing call sites pick up the new
// color without a rename sweep: Purple80 = accent, Purple40 = pressed/solid, Purple20 = deep.
val Purple80 = Color(0xFF8A5BD3)
val Purple40 = Color(0xFF7A4CC0)
val Purple20 = Color(0xFF533474)
val PurpleGrey80 = Color(0xFFE8DEFD)
val Pink80 = Color(0xFFEFB8C8)

// Text colors
val TextPrimary = Color(0xFFEFEDF5)
val TextSecondary = Color(0xFFA6A3B3)
val TextTertiary = Color(0xFF63626C)

// Content-type accents (Turbo lesson cards: gold, violet, red, green) plus record red
val AccentRed = Color(0xFFEB4D3D)
val AccentGreen = Color(0xFF468447)
val AccentBlue = Color(0xFF4DA3FF)
val AccentAmber = Color(0xFFE0A526)
val TurboWave = Color(0xFF5D5077)
