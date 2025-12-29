//
//  FormattedNoteView.swift
//  scribeai
//
//  Renders formatted markdown notes with rich styling matching Android design
//

import SwiftUI

struct FormattedNoteView: View {
    let content: String
    let isFormatted: Bool

    // Parse the content into blocks for rendering
    private var contentBlocks: [ContentBlock] {
        parseMarkdown(content)
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(Array(contentBlocks.enumerated()), id: \.offset) { _, block in
                renderBlock(block)
            }
        }
    }

    @ViewBuilder
    private func renderBlock(_ block: ContentBlock) -> some View {
        switch block.type {
        case .header1:
            headerView(text: block.text, size: 24, emoji: block.emoji)
                .padding(.top, 20)
                .padding(.bottom, 6)

        case .header2:
            headerView(text: block.text, size: 20, emoji: block.emoji)
                .padding(.top, 16)
                .padding(.bottom, 4)

        case .header3:
            headerView(text: block.text, size: 17, emoji: block.emoji)
                .padding(.top, 12)
                .padding(.bottom, 2)

        case .bulletPoint:
            bulletPointView(text: block.text, indentLevel: block.indentLevel)

        case .numberedItem:
            numberedItemView(text: block.text, number: block.prefix, indentLevel: block.indentLevel)

        case .definition:
            definitionView(term: block.prefix, definition: block.text)

        case .blockquote:
            blockquoteView(text: block.text)

        case .codeBlock:
            codeBlockView(text: block.text)

        case .table:
            tableView(rows: block.tableRows, headers: block.tableHeaders)

        case .paragraph:
            paragraphView(text: block.text)

        case .divider:
            Divider()
                .background(Color.darkSurfaceVariant)
                .padding(.vertical, 12)

        case .empty:
            Spacer()
                .frame(height: 6)
        }
    }

    // MARK: - Header View
    @ViewBuilder
    private func headerView(text: String, size: CGFloat, emoji: String?) -> some View {
        HStack(spacing: 10) {
            if let emoji = emoji, !emoji.isEmpty {
                Text(emoji)
                    .font(.system(size: size))
            }
            Text(text)
                .font(.system(size: size, weight: .bold))
                .foregroundColor(.white)
        }
    }

    // MARK: - Bullet Point View
    @ViewBuilder
    private func bulletPointView(text: String, indentLevel: Int) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("•")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.purple80)

            RichTextView(text: text, fontSize: 15)
        }
        .padding(.leading, CGFloat(indentLevel * 16))
    }

    // MARK: - Numbered Item View
    @ViewBuilder
    private func numberedItemView(text: String, number: String, indentLevel: Int) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(.purple80)
                .frame(minWidth: 20, alignment: .trailing)

            RichTextView(text: text, fontSize: 15)
        }
        .padding(.leading, CGFloat(indentLevel * 16))
    }

    // MARK: - Definition View (with colored left border)
    @ViewBuilder
    private func definitionView(term: String, definition: String) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(Color.purple80)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 4) {
                Text("Definition: ")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.purple80)
                +
                Text(term)
                    .font(.system(size: 15, weight: .bold).italic())
                    .foregroundColor(.white)
                +
                Text(" – ")
                    .font(.system(size: 15))
                    .foregroundColor(.textSecondary)
                +
                Text(definition)
                    .font(.system(size: 15))
                    .foregroundColor(.textSecondary)
            }
            .padding(.leading, 12)
            .padding(.vertical, 10)
        }
        .background(Color.purple80.opacity(0.1))
        .cornerRadius(4)
    }

    // MARK: - Blockquote View
    @ViewBuilder
    private func blockquoteView(text: String) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(Color.purple80)
                .frame(width: 3)

            RichTextView(text: text, fontSize: 15, isItalic: true, color: .textSecondary)
                .padding(.leading, 12)
                .padding(.vertical, 10)
        }
        .background(Color.purple80.opacity(0.08))
        .cornerRadius(4)
    }

    // MARK: - Code Block View
    @ViewBuilder
    private func codeBlockView(text: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(text)
                .font(.system(size: 13, design: .monospaced))
                .foregroundColor(.textPrimary)
                .padding(12)
        }
        .background(Color.cardBackground)
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.darkSurfaceVariant, lineWidth: 1)
        )
    }

    // MARK: - Table View
    @ViewBuilder
    private func tableView(rows: [[String]], headers: [String]) -> some View {
        VStack(spacing: 0) {
            // Header row
            if !headers.isEmpty {
                HStack(spacing: 0) {
                    ForEach(Array(headers.enumerated()), id: \.offset) { index, header in
                        Text(header)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.purple80)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(Color.purple80.opacity(0.15))

                        if index < headers.count - 1 {
                            Rectangle()
                                .fill(Color.darkSurfaceVariant)
                                .frame(width: 1)
                        }
                    }
                }

                Rectangle()
                    .fill(Color.darkSurfaceVariant)
                    .frame(height: 1)
            }

            // Data rows
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                HStack(spacing: 0) {
                    ForEach(Array(row.enumerated()), id: \.offset) { colIndex, cell in
                        Text(cell)
                            .font(.system(size: 13))
                            .foregroundColor(.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)

                        if colIndex < row.count - 1 {
                            Rectangle()
                                .fill(Color.darkSurfaceVariant)
                                .frame(width: 1)
                        }
                    }
                }
                .background(rowIndex % 2 == 0 ? Color.clear : Color.white.opacity(0.03))

                if rowIndex < rows.count - 1 {
                    Rectangle()
                        .fill(Color.darkSurfaceVariant)
                        .frame(height: 1)
                }
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.darkSurfaceVariant, lineWidth: 1)
        )
        .cornerRadius(8)
    }

    // MARK: - Paragraph View
    @ViewBuilder
    private func paragraphView(text: String) -> some View {
        RichTextView(text: text, fontSize: 15)
    }
}

// MARK: - Rich Text View (handles inline formatting)

struct RichTextView: View {
    let text: String
    let fontSize: CGFloat
    var isItalic: Bool = false
    var color: Color = .textPrimary

    var body: some View {
        Text(parseInlineFormatting(text))
            .font(.system(size: fontSize))
            .foregroundColor(color)
            .italic(isItalic)
            .lineSpacing(5)
    }

    private func parseInlineFormatting(_ text: String) -> AttributedString {
        var result = text
        var attributedString = AttributedString()

        // Process the text character by character to handle formatting
        var i = result.startIndex
        var currentText = ""
        var isBold = false
        var isItalic = false
        var isUnderline = false

        while i < result.endIndex {
            // Check for bold markers (**)
            if result[i...].hasPrefix("**") {
                // Flush current text
                if !currentText.isEmpty {
                    var attr = AttributedString(currentText)
                    applyFormatting(&attr, bold: isBold, italic: isItalic, underline: isUnderline, fontSize: fontSize)
                    attributedString.append(attr)
                    currentText = ""
                }
                isBold.toggle()
                result.formIndex(&i, offsetBy: 2)
                continue
            }

            // Check for italic markers (single *)
            if result[i] == "*" && !result[i...].hasPrefix("**") {
                // Flush current text
                if !currentText.isEmpty {
                    var attr = AttributedString(currentText)
                    applyFormatting(&attr, bold: isBold, italic: isItalic, underline: isUnderline, fontSize: fontSize)
                    attributedString.append(attr)
                    currentText = ""
                }
                isItalic.toggle()
                result.formIndex(after: &i)
                continue
            }

            // Check for underline markers (__)
            if result[i...].hasPrefix("__") {
                // Flush current text
                if !currentText.isEmpty {
                    var attr = AttributedString(currentText)
                    applyFormatting(&attr, bold: isBold, italic: isItalic, underline: isUnderline, fontSize: fontSize)
                    attributedString.append(attr)
                    currentText = ""
                }
                isUnderline.toggle()
                result.formIndex(&i, offsetBy: 2)
                continue
            }

            // Regular character
            currentText.append(result[i])
            result.formIndex(after: &i)
        }

        // Flush remaining text
        if !currentText.isEmpty {
            var attr = AttributedString(currentText)
            applyFormatting(&attr, bold: isBold, italic: isItalic, underline: isUnderline, fontSize: fontSize)
            attributedString.append(attr)
        }

        return attributedString
    }

    private func applyFormatting(_ attr: inout AttributedString, bold: Bool, italic: Bool, underline: Bool, fontSize: CGFloat) {
        if bold && italic {
            attr.font = .system(size: fontSize, weight: .bold).italic()
            attr.foregroundColor = .purple80
        } else if bold {
            attr.font = .system(size: fontSize, weight: .bold)
            attr.foregroundColor = .purple80
        } else if italic {
            attr.font = .system(size: fontSize).italic()
        } else {
            attr.font = .system(size: fontSize)
        }

        if underline {
            attr.underlineStyle = .single
            attr.foregroundColor = .purple80
        }
    }
}

// MARK: - Content Block Types

enum ContentBlockType {
    case header1
    case header2
    case header3
    case bulletPoint
    case numberedItem
    case definition
    case blockquote
    case codeBlock
    case table
    case paragraph
    case divider
    case empty
}

struct ContentBlock {
    let type: ContentBlockType
    let text: String
    var prefix: String = ""
    var emoji: String? = nil
    var indentLevel: Int = 0
    var tableHeaders: [String] = []
    var tableRows: [[String]] = []
}

// MARK: - Markdown Parser

private func parseMarkdown(_ content: String) -> [ContentBlock] {
    let lines = content.components(separatedBy: "\n")
    var blocks: [ContentBlock] = []
    var codeBlockContent: [String] = []
    var inCodeBlock = false
    var tableHeaders: [String] = []
    var tableRows: [[String]] = []
    var inTable = false

    for (index, line) in lines.enumerated() {
        let trimmedLine = line.trimmingCharacters(in: .whitespaces)

        // Handle code blocks
        if trimmedLine.hasPrefix("```") {
            if inCodeBlock {
                blocks.append(ContentBlock(type: .codeBlock, text: codeBlockContent.joined(separator: "\n")))
                codeBlockContent = []
                inCodeBlock = false
            } else {
                inCodeBlock = true
            }
            continue
        }

        if inCodeBlock {
            codeBlockContent.append(line)
            continue
        }

        // Handle tables
        if trimmedLine.contains("|") && !trimmedLine.hasPrefix(">") {
            let cells = trimmedLine.split(separator: "|").map { String($0).trimmingCharacters(in: .whitespaces) }

            // Check if this is a separator row (---|---|---)
            if cells.allSatisfy({ $0.allSatisfy({ $0 == "-" || $0 == ":" }) }) {
                continue // Skip separator row
            }

            if !inTable {
                // First row is headers
                tableHeaders = cells.filter { !$0.isEmpty }
                inTable = true
            } else {
                tableRows.append(cells.filter { !$0.isEmpty })
            }

            // Check if next line is not a table row
            let nextIndex = index + 1
            if nextIndex >= lines.count || !lines[nextIndex].contains("|") {
                // End of table
                blocks.append(ContentBlock(
                    type: .table,
                    text: "",
                    tableHeaders: tableHeaders,
                    tableRows: tableRows
                ))
                tableHeaders = []
                tableRows = []
                inTable = false
            }
            continue
        }

        // End table if we were in one
        if inTable {
            blocks.append(ContentBlock(
                type: .table,
                text: "",
                tableHeaders: tableHeaders,
                tableRows: tableRows
            ))
            tableHeaders = []
            tableRows = []
            inTable = false
        }

        // Empty line
        if trimmedLine.isEmpty {
            blocks.append(ContentBlock(type: .empty, text: ""))
            continue
        }

        // Headers with emoji detection
        if trimmedLine.hasPrefix("### ") {
            let headerText = String(trimmedLine.dropFirst(4))
            let (emoji, text) = extractEmoji(from: headerText)
            blocks.append(ContentBlock(type: .header3, text: text, emoji: emoji))
            continue
        }
        if trimmedLine.hasPrefix("## ") {
            let headerText = String(trimmedLine.dropFirst(3))
            let (emoji, text) = extractEmoji(from: headerText)
            blocks.append(ContentBlock(type: .header2, text: text, emoji: emoji))
            continue
        }
        if trimmedLine.hasPrefix("# ") {
            let headerText = String(trimmedLine.dropFirst(2))
            let (emoji, text) = extractEmoji(from: headerText)
            blocks.append(ContentBlock(type: .header1, text: text, emoji: emoji))
            continue
        }

        // Definition pattern: "Definition: term - explanation" or "> Definition:"
        if trimmedLine.lowercased().hasPrefix("definition:") ||
           (trimmedLine.hasPrefix("> ") && trimmedLine.lowercased().contains("definition:")) {
            let defText = trimmedLine.hasPrefix("> ") ? String(trimmedLine.dropFirst(2)) : trimmedLine
            if let colonRange = defText.range(of: ":", options: [], range: defText.index(defText.startIndex, offsetBy: 10)..<defText.endIndex) {
                // Has term and definition separated by – or -
                let afterColon = String(defText[colonRange.upperBound...]).trimmingCharacters(in: .whitespaces)
                if let dashRange = afterColon.range(of: " – ") ?? afterColon.range(of: " - ") {
                    let term = String(afterColon[..<dashRange.lowerBound]).trimmingCharacters(in: .whitespaces)
                    let definition = String(afterColon[dashRange.upperBound...]).trimmingCharacters(in: .whitespaces)
                    blocks.append(ContentBlock(type: .definition, text: definition, prefix: term))
                    continue
                }
            }
            // Fallback - treat the whole thing as definition text
            let defContent = defText.replacingOccurrences(of: "Definition:", with: "", options: .caseInsensitive).trimmingCharacters(in: .whitespaces)
            if let dashRange = defContent.range(of: " – ") ?? defContent.range(of: " - ") {
                let term = String(defContent[..<dashRange.lowerBound]).trimmingCharacters(in: .whitespaces)
                let definition = String(defContent[dashRange.upperBound...]).trimmingCharacters(in: .whitespaces)
                blocks.append(ContentBlock(type: .definition, text: definition, prefix: term))
            } else {
                blocks.append(ContentBlock(type: .definition, text: defContent, prefix: ""))
            }
            continue
        }

        // Bullet points with indent detection
        if trimmedLine.hasPrefix("- ") || trimmedLine.hasPrefix("* ") || trimmedLine.hasPrefix("• ") {
            let indentLevel = countLeadingSpaces(line) / 2
            let bulletText = String(trimmedLine.dropFirst(2))
            blocks.append(ContentBlock(type: .bulletPoint, text: bulletText, indentLevel: indentLevel))
            continue
        }

        // Numbered lists
        if let match = trimmedLine.range(of: "^\\d+\\.\\s+", options: .regularExpression) {
            let number = String(trimmedLine[match]).trimmingCharacters(in: .whitespaces)
            let text = String(trimmedLine[match.upperBound...])
            let indentLevel = countLeadingSpaces(line) / 2
            blocks.append(ContentBlock(type: .numberedItem, text: text, prefix: number, indentLevel: indentLevel))
            continue
        }

        // Blockquotes (that aren't definitions)
        if trimmedLine.hasPrefix("> ") {
            blocks.append(ContentBlock(type: .blockquote, text: String(trimmedLine.dropFirst(2))))
            continue
        }

        // Dividers
        if trimmedLine == "---" || trimmedLine == "***" || trimmedLine == "___" {
            blocks.append(ContentBlock(type: .divider, text: ""))
            continue
        }

        // Regular paragraph
        blocks.append(ContentBlock(type: .paragraph, text: trimmedLine))
    }

    // Handle unclosed code block
    if inCodeBlock && !codeBlockContent.isEmpty {
        blocks.append(ContentBlock(type: .codeBlock, text: codeBlockContent.joined(separator: "\n")))
    }

    // Handle unclosed table
    if inTable && (!tableHeaders.isEmpty || !tableRows.isEmpty) {
        blocks.append(ContentBlock(
            type: .table,
            text: "",
            tableHeaders: tableHeaders,
            tableRows: tableRows
        ))
    }

    return blocks
}

private func extractEmoji(from text: String) -> (emoji: String?, cleanText: String) {
    let trimmed = text.trimmingCharacters(in: .whitespaces)

    // Check if starts with emoji
    if let firstScalar = trimmed.unicodeScalars.first {
        // Check if it's an emoji (not alphanumeric)
        if firstScalar.properties.isEmoji && firstScalar.value > 127 {
            // Find where the emoji ends
            var emojiEndIndex = trimmed.startIndex
            for (i, char) in trimmed.enumerated() {
                if char.unicodeScalars.first?.properties.isEmoji == true && char.unicodeScalars.first!.value > 127 {
                    emojiEndIndex = trimmed.index(trimmed.startIndex, offsetBy: i + 1)
                } else {
                    break
                }
            }
            let emoji = String(trimmed[..<emojiEndIndex])
            let cleanText = String(trimmed[emojiEndIndex...]).trimmingCharacters(in: .whitespaces)
            return (emoji, cleanText)
        }
    }

    return (nil, trimmed)
}

private func countLeadingSpaces(_ line: String) -> Int {
    var count = 0
    for char in line {
        if char == " " {
            count += 1
        } else if char == "\t" {
            count += 2
        } else {
            break
        }
    }
    return count
}

// MARK: - Preview

#Preview {
    ScrollView {
        FormattedNoteView(
            content: """
            ## 📚 AI Learning & Toolkits

            **Brief Overview**

            This note covers **AI Learning & Toolkits** and was created from the YouTube video. The content distills key AI concepts, user pathways, terminology, tool categories, and more.

            ### Key Points

            • A clear map of the **AI Landscape** and three user paths (Explorer, Power User, Builder).
            • Definitions of core AI concepts and terminology, plus a guide to major tool categories.
            • A step-by-step roadmap for selecting tools, crafting prompts, and building simple AI workflows.

            ---

            ## 🚀 AI Landscape Overview

            • AI is increasingly integrated into everyday tasks and business processes.
            • Ignoring AI is not an option; the focus is on **how** to learn and apply it.
            • No coding is required to get started; most modern tools are built for non-technical users.

            Definition: *Artificial Intelligence (AI)* – software designed to simulate human intelligence and perform tasks.

            ---

            ## 🔧 Tool Categories

            1. **LLMs** – Core engines for text generation and reasoning.
            2. **Research Tools** – Combine LLMs with real-time data (e.g., Perplexity, Notebook LM).
            3. **Image Generation** – Diffusion-based models (e.g., MidJourney, Ideogram, ChatGPT Image).

            ---

            | Path | Goal | Typical Activities |
            |------|------|-------------------|
            | Everyday Explorer | Simplify routine tasks | Summarize documents, draft emails |
            | Power User | Increase speed and output | Content creation, brainstorming |
            | Builder | Automate, customize, scale | Build agents, connect apps |

            ---

            ## 🎯 Prompt Engineering Essentials

            • **Structure**: Aim → Context → Rules
              • *Aim*: What you want the AI to do.
              • *Context*: Background information, target audience, examples.
              • *Rules*: Formatting, length, tone, output style.

            > Example of a good prompt: "I'm a business productivity coach. Write a 500-word blog post for busy entrepreneurs about planning a weekly review."
            """,
            isFormatted: true
        )
        .padding()
    }
    .background(Color.darkBackground)
}
