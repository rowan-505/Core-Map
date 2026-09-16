package com.coremapmm.fieldsurveyor.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val FieldLightColors = lightColorScheme(
    primary = Color(0xFF007A55),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF65E6B4),
    onPrimaryContainer = Color(0xFF063B2D),
    secondary = Color(0xFF007F9B),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFC6F4FC),
    onSecondaryContainer = Color(0xFF093D48),
    tertiary = Color(0xFF805600),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFE3A1),
    onTertiaryContainer = Color(0xFF3C2A00),
    background = Color(0xFFF5FAF7),
    onBackground = Color(0xFF10231B),
    surface = Color(0xFFFBFEFC),
    onSurface = Color(0xFF10231B),
    surfaceVariant = Color(0xFFE1EEE8),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF0F8F4),
    surfaceContainerHigh = Color(0xFFE4F2EB),
    outline = Color(0xFF60756B),
    outlineVariant = Color(0xFFC2D4CB),
    error = Color(0xFFBA1A1A),
)

private val FieldDarkColors = darkColorScheme(
    primary = Color(0xFF65E6B4),
    onPrimary = Color(0xFF003827),
    primaryContainer = Color(0xFF005139),
    onPrimaryContainer = Color(0xFF8AF8C7),
    secondary = Color(0xFF65D9F3),
    secondaryContainer = Color(0xFF124E5C),
    tertiary = Color(0xFFFFC857),
    tertiaryContainer = Color(0xFF5A3D00),
    background = Color(0xFF101512),
    surface = Color(0xFF101512),
    surfaceVariant = Color(0xFF404943),
    outline = Color(0xFF89938C),
)

private val FieldTypography = Typography(
    headlineLarge = TextStyle(fontSize = 24.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold),
    headlineMedium = TextStyle(fontSize = 22.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontSize = 20.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 19.sp, lineHeight = 29.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 23.sp, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun FieldTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) FieldDarkColors else FieldLightColors,
        typography = FieldTypography,
        content = content,
    )
}
