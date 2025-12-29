package com.kreativekoala.scribeai.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.ui.theme.*

/**
 * Renders formatted markdown notes with rich styling
 * Matches iOS FormattedNoteView implementation
 */
@Composable
fun FormattedNoteView(
    content: String,
    modifier: Modifier = Modifier
) {
    val contentBlocks = remember(content) {
        parseMarkdown(content)
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        contentBlocks.forEach { block ->
            RenderBlock(block)
        }
    }
}

@Composable
private fun RenderBlock(block: ContentBlock) {
    when (block.type) {
        ContentBlockType.HEADER1 -> HeaderView(
            text = block.text,
            fontSize = 24,
            emoji = block.emoji,
            modifier = Modifier.padding(top = 20.dp, bottom = 6.dp)
        )
        ContentBlockType.HEADER2 -> HeaderView(
            text = block.text,
            fontSize = 20,
            emoji = block.emoji,
            modifier = Modifier.padding(top = 16.dp, bottom = 4.dp)
        )
        ContentBlockType.HEADER3 -> HeaderView(
            text = block.text,
            fontSize = 17,
            emoji = block.emoji,
            modifier = Modifier.padding(top = 12.dp, bottom = 2.dp)
        )
        ContentBlockType.BULLET_POINT -> BulletPointView(
            text = block.text,
            indentLevel = block.indentLevel
        )
        ContentBlockType.NUMBERED_ITEM -> NumberedItemView(
            text = block.text,
            number = block.prefix,
            indentLevel = block.indentLevel
        )
        ContentBlockType.DEFINITION -> DefinitionView(
            term = block.prefix,
            definition = block.text
        )
        ContentBlockType.BLOCKQUOTE -> BlockquoteView(text = block.text)
        ContentBlockType.CODE_BLOCK -> CodeBlockView(text = block.text)
        ContentBlockType.TABLE -> TableView(
            headers = block.tableHeaders,
            rows = block.tableRows
        )
        ContentBlockType.PARAGRAPH -> ParagraphView(text = block.text)
        ContentBlockType.DIVIDER -> HorizontalDivider(
            color = DarkSurfaceVariant,
            modifier = Modifier.padding(vertical = 12.dp)
        )
        ContentBlockType.EMPTY -> Spacer(Modifier.height(6.dp))
    }
}

// MARK: - Header View
@Composable
private fun HeaderView(
    text: String,
    fontSize: Int,
    emoji: String?,
    modifier: Modifier = Modifier
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
    ) {
        if (!emoji.isNullOrEmpty()) {
            Text(
                text = emoji,
                fontSize = fontSize.sp
            )
        }
        Text(
            text = text,
            fontSize = fontSize.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )
    }
}

// MARK: - Bullet Point View
@Composable
private fun BulletPointView(
    text: String,
    indentLevel: Int
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.padding(start = (indentLevel * 16).dp)
    ) {
        Text(
            text = "•",
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Purple80
        )
        RichText(text = text, fontSize = 15)
    }
}

// MARK: - Numbered Item View
@Composable
private fun NumberedItemView(
    text: String,
    number: String,
    indentLevel: Int
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.padding(start = (indentLevel * 16).dp)
    ) {
        Text(
            text = number,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = Purple80,
            modifier = Modifier.widthIn(min = 20.dp)
        )
        RichText(text = text, fontSize = 15)
    }
}

// MARK: - Definition View
@Composable
private fun DefinitionView(
    term: String,
    definition: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .background(Purple80.copy(alpha = 0.1f))
    ) {
        // Purple left border
        Box(
            modifier = Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(Purple80)
        )

        Column(
            modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 12.dp)
        ) {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = Purple80, fontWeight = FontWeight.Bold)) {
                        append("Definition: ")
                    }
                    withStyle(SpanStyle(color = Color.White, fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic)) {
                        append(term)
                    }
                    if (term.isNotEmpty() && definition.isNotEmpty()) {
                        withStyle(SpanStyle(color = TextSecondary)) {
                            append(" – ")
                        }
                    }
                    withStyle(SpanStyle(color = TextSecondary)) {
                        append(definition)
                    }
                },
                fontSize = 15.sp,
                lineHeight = 22.sp
            )
        }
    }
}

// MARK: - Blockquote View
@Composable
private fun BlockquoteView(text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .background(Purple80.copy(alpha = 0.08f))
    ) {
        // Purple left border
        Box(
            modifier = Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(Purple80)
        )

        RichText(
            text = text,
            fontSize = 15,
            isItalic = true,
            color = TextSecondary,
            modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 12.dp)
        )
    }
}

// MARK: - Code Block View
@Composable
private fun CodeBlockView(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(CardBackground)
            .horizontalScroll(rememberScrollState())
    ) {
        Text(
            text = text,
            fontSize = 13.sp,
            fontFamily = FontFamily.Monospace,
            color = TextPrimary,
            modifier = Modifier.padding(12.dp)
        )
    }
}

// MARK: - Table View
@Composable
private fun TableView(
    headers: List<String>,
    rows: List<List<String>>
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(CardBackground)
    ) {
        // Header row
        if (headers.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Purple80.copy(alpha = 0.15f))
            ) {
                headers.forEachIndexed { index, header ->
                    Text(
                        text = header,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Purple80,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 10.dp, vertical = 8.dp)
                    )
                    if (index < headers.size - 1) {
                        Box(
                            modifier = Modifier
                                .width(1.dp)
                                .height(36.dp)
                                .background(DarkSurfaceVariant)
                        )
                    }
                }
            }
            HorizontalDivider(color = DarkSurfaceVariant)
        }

        // Data rows
        rows.forEachIndexed { rowIndex, row ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (rowIndex % 2 == 0) Color.Transparent else Color.White.copy(alpha = 0.03f))
            ) {
                row.forEachIndexed { colIndex, cell ->
                    Text(
                        text = cell,
                        fontSize = 13.sp,
                        color = TextPrimary,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 10.dp, vertical = 8.dp)
                    )
                    if (colIndex < row.size - 1) {
                        Box(
                            modifier = Modifier
                                .width(1.dp)
                                .height(36.dp)
                                .background(DarkSurfaceVariant)
                        )
                    }
                }
            }
            if (rowIndex < rows.size - 1) {
                HorizontalDivider(color = DarkSurfaceVariant)
            }
        }
    }
}

// MARK: - Paragraph View
@Composable
private fun ParagraphView(text: String) {
    RichText(text = text, fontSize = 15)
}

// MARK: - Rich Text (handles inline formatting like **bold**, *italic*, __underline__)
@Composable
private fun RichText(
    text: String,
    fontSize: Int,
    isItalic: Boolean = false,
    color: Color = TextPrimary,
    modifier: Modifier = Modifier
) {
    val annotatedString = remember(text) {
        parseInlineFormatting(text, fontSize, color)
    }

    Text(
        text = annotatedString,
        fontSize = fontSize.sp,
        lineHeight = (fontSize + 7).sp,
        fontStyle = if (isItalic) FontStyle.Italic else FontStyle.Normal,
        modifier = modifier
    )
}

private fun parseInlineFormatting(text: String, fontSize: Int, defaultColor: Color) = buildAnnotatedString {
    var i = 0
    var isBold = false
    var isItalic = false
    var isUnderline = false

    while (i < text.length) {
        // Check for bold markers (**)
        if (i + 1 < text.length && text.substring(i, i + 2) == "**") {
            isBold = !isBold
            i += 2
            continue
        }

        // Check for underline markers (__)
        if (i + 1 < text.length && text.substring(i, i + 2) == "__") {
            isUnderline = !isUnderline
            i += 2
            continue
        }

        // Check for italic marker (single * not followed by another *)
        if (text[i] == '*' && (i + 1 >= text.length || text[i + 1] != '*')) {
            isItalic = !isItalic
            i++
            continue
        }

        // Regular character - apply current formatting
        val spanStyle = when {
            isBold && isItalic -> SpanStyle(
                fontWeight = FontWeight.Bold,
                fontStyle = FontStyle.Italic,
                color = Purple80
            )
            isBold -> SpanStyle(
                fontWeight = FontWeight.Bold,
                color = Purple80
            )
            isItalic -> SpanStyle(
                fontStyle = FontStyle.Italic,
                color = defaultColor
            )
            isUnderline -> SpanStyle(
                textDecoration = TextDecoration.Underline,
                color = Purple80
            )
            else -> SpanStyle(color = defaultColor)
        }

        withStyle(spanStyle) {
            append(text[i])
        }
        i++
    }
}

// MARK: - Content Block Types

enum class ContentBlockType {
    HEADER1,
    HEADER2,
    HEADER3,
    BULLET_POINT,
    NUMBERED_ITEM,
    DEFINITION,
    BLOCKQUOTE,
    CODE_BLOCK,
    TABLE,
    PARAGRAPH,
    DIVIDER,
    EMPTY
}

data class ContentBlock(
    val type: ContentBlockType,
    val text: String,
    val prefix: String = "",
    val emoji: String? = null,
    val indentLevel: Int = 0,
    val tableHeaders: List<String> = emptyList(),
    val tableRows: List<List<String>> = emptyList()
)

// MARK: - Markdown Parser

private fun parseMarkdown(content: String): List<ContentBlock> {
    val lines = content.split("\n")
    val blocks = mutableListOf<ContentBlock>()
    val codeBlockContent = mutableListOf<String>()
    var inCodeBlock = false
    var tableHeaders = mutableListOf<String>()
    var tableRows = mutableListOf<List<String>>()
    var inTable = false

    lines.forEachIndexed { index, line ->
        val trimmedLine = line.trim()

        // Handle code blocks
        if (trimmedLine.startsWith("```")) {
            if (inCodeBlock) {
                blocks.add(ContentBlock(
                    type = ContentBlockType.CODE_BLOCK,
                    text = codeBlockContent.joinToString("\n")
                ))
                codeBlockContent.clear()
                inCodeBlock = false
            } else {
                inCodeBlock = true
            }
            return@forEachIndexed
        }

        if (inCodeBlock) {
            codeBlockContent.add(line)
            return@forEachIndexed
        }

        // Handle tables
        if (trimmedLine.contains("|") && !trimmedLine.startsWith(">")) {
            val cells = trimmedLine.split("|")
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            // Check if this is a separator row (---|---|---)
            if (cells.all { it.all { c -> c == '-' || c == ':' } }) {
                return@forEachIndexed // Skip separator row
            }

            if (!inTable) {
                // First row is headers
                tableHeaders = cells.toMutableList()
                inTable = true
            } else {
                tableRows.add(cells)
            }

            // Check if next line is not a table row
            val nextIndex = index + 1
            if (nextIndex >= lines.size || !lines[nextIndex].contains("|")) {
                // End of table
                blocks.add(ContentBlock(
                    type = ContentBlockType.TABLE,
                    text = "",
                    tableHeaders = tableHeaders.toList(),
                    tableRows = tableRows.toList()
                ))
                tableHeaders.clear()
                tableRows.clear()
                inTable = false
            }
            return@forEachIndexed
        }

        // End table if we were in one
        if (inTable) {
            blocks.add(ContentBlock(
                type = ContentBlockType.TABLE,
                text = "",
                tableHeaders = tableHeaders.toList(),
                tableRows = tableRows.toList()
            ))
            tableHeaders.clear()
            tableRows.clear()
            inTable = false
        }

        // Empty line
        if (trimmedLine.isEmpty()) {
            blocks.add(ContentBlock(type = ContentBlockType.EMPTY, text = ""))
            return@forEachIndexed
        }

        // Headers with emoji detection
        if (trimmedLine.startsWith("### ")) {
            val headerText = trimmedLine.drop(4)
            val (emoji, text) = extractEmoji(headerText)
            blocks.add(ContentBlock(type = ContentBlockType.HEADER3, text = text, emoji = emoji))
            return@forEachIndexed
        }
        if (trimmedLine.startsWith("## ")) {
            val headerText = trimmedLine.drop(3)
            val (emoji, text) = extractEmoji(headerText)
            blocks.add(ContentBlock(type = ContentBlockType.HEADER2, text = text, emoji = emoji))
            return@forEachIndexed
        }
        if (trimmedLine.startsWith("# ")) {
            val headerText = trimmedLine.drop(2)
            val (emoji, text) = extractEmoji(headerText)
            blocks.add(ContentBlock(type = ContentBlockType.HEADER1, text = text, emoji = emoji))
            return@forEachIndexed
        }

        // Definition pattern
        if (trimmedLine.lowercase().startsWith("definition:") ||
            (trimmedLine.startsWith("> ") && trimmedLine.lowercase().contains("definition:"))) {
            val defText = if (trimmedLine.startsWith("> ")) trimmedLine.drop(2) else trimmedLine
            val afterDefinition = defText.substringAfter(":", "").trim()

            // Check for term – definition or term - definition pattern
            val dashIndex = afterDefinition.indexOf(" – ").takeIf { it >= 0 }
                ?: afterDefinition.indexOf(" - ").takeIf { it >= 0 }

            if (dashIndex != null && dashIndex >= 0) {
                val term = afterDefinition.substring(0, dashIndex).trim()
                val definition = afterDefinition.substring(dashIndex + 3).trim()
                blocks.add(ContentBlock(type = ContentBlockType.DEFINITION, text = definition, prefix = term))
            } else {
                blocks.add(ContentBlock(type = ContentBlockType.DEFINITION, text = afterDefinition, prefix = ""))
            }
            return@forEachIndexed
        }

        // Bullet points with indent detection
        if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ") || trimmedLine.startsWith("• ")) {
            val indentLevel = countLeadingSpaces(line) / 2
            val bulletText = trimmedLine.drop(2)
            blocks.add(ContentBlock(
                type = ContentBlockType.BULLET_POINT,
                text = bulletText,
                indentLevel = indentLevel
            ))
            return@forEachIndexed
        }

        // Numbered lists
        val numberedMatch = Regex("^(\\d+\\.\\s+)(.*)").find(trimmedLine)
        if (numberedMatch != null) {
            val number = numberedMatch.groupValues[1].trim()
            val text = numberedMatch.groupValues[2]
            val indentLevel = countLeadingSpaces(line) / 2
            blocks.add(ContentBlock(
                type = ContentBlockType.NUMBERED_ITEM,
                text = text,
                prefix = number,
                indentLevel = indentLevel
            ))
            return@forEachIndexed
        }

        // Blockquotes (that aren't definitions)
        if (trimmedLine.startsWith("> ")) {
            blocks.add(ContentBlock(type = ContentBlockType.BLOCKQUOTE, text = trimmedLine.drop(2)))
            return@forEachIndexed
        }

        // Dividers
        if (trimmedLine == "---" || trimmedLine == "***" || trimmedLine == "___") {
            blocks.add(ContentBlock(type = ContentBlockType.DIVIDER, text = ""))
            return@forEachIndexed
        }

        // Regular paragraph
        blocks.add(ContentBlock(type = ContentBlockType.PARAGRAPH, text = trimmedLine))
    }

    // Handle unclosed code block
    if (inCodeBlock && codeBlockContent.isNotEmpty()) {
        blocks.add(ContentBlock(
            type = ContentBlockType.CODE_BLOCK,
            text = codeBlockContent.joinToString("\n")
        ))
    }

    // Handle unclosed table
    if (inTable && (tableHeaders.isNotEmpty() || tableRows.isNotEmpty())) {
        blocks.add(ContentBlock(
            type = ContentBlockType.TABLE,
            text = "",
            tableHeaders = tableHeaders.toList(),
            tableRows = tableRows.toList()
        ))
    }

    return blocks
}

private fun extractEmoji(text: String): Pair<String?, String> {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return Pair(null, trimmed)

    // Check if starts with emoji
    val firstCodePoint = trimmed.codePointAt(0)
    val firstChar = String(Character.toChars(firstCodePoint))

    // Simple emoji detection - check if first character is outside basic ASCII and looks like an emoji
    if (firstCodePoint > 127 && Character.isValidCodePoint(firstCodePoint)) {
        // Check for common emoji ranges
        val isEmoji = when (firstCodePoint) {
            in 0x1F300..0x1F9FF, // Misc Symbols and Pictographs, Emoticons, etc.
            in 0x2600..0x26FF,   // Misc symbols
            in 0x2700..0x27BF,   // Dingbats
            in 0x1F600..0x1F64F, // Emoticons
            in 0x1F680..0x1F6FF  // Transport and Map
            -> true
            else -> false
        }

        if (isEmoji) {
            val charCount = Character.charCount(firstCodePoint)
            val emoji = trimmed.substring(0, charCount)
            val cleanText = trimmed.substring(charCount).trim()
            return Pair(emoji, cleanText)
        }
    }

    return Pair(null, trimmed)
}

private fun countLeadingSpaces(line: String): Int {
    var count = 0
    for (char in line) {
        when (char) {
            ' ' -> count++
            '\t' -> count += 2
            else -> break
        }
    }
    return count
}
