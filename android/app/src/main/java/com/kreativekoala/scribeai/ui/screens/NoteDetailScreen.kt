package com.kreativekoala.scribeai.ui.screens

import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.data.models.Note
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AnalyticsService
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.viewmodel.AIViewModel
import com.kreativekoala.scribeai.viewmodel.AIContentState
import kotlinx.coroutines.delay
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import kotlinx.coroutines.launch
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.lazy.rememberLazyListState
import com.kreativekoala.scribeai.viewmodel.ChatMessage
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import com.kreativekoala.scribeai.data.repository.NoteRepository
import com.kreativekoala.scribeai.ui.components.FormattedNoteView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteDetailScreen(
    note: Note,
    authManager: AuthManager,
    noteViewModel: NoteViewModel,
    aiViewModel: AIViewModel = androidx.lifecycle.viewmodel.compose.viewModel(),
    onNavigateBack: () -> Unit,
    onNoteDeleted: () -> Unit = onNavigateBack
) {
    // Tab indices: 0 = Notes, 1 = Chat, 2 = Quiz, 3 = Flashcards, 4 = Podcast
    var selectedTab by remember { mutableStateOf(0) }
    val authToken by authManager.authToken.collectAsState(initial = null)
    val context = LocalContext.current
    val sharedPrefs = context.getSharedPreferences("scribe_prefs", Context.MODE_PRIVATE)
    val preferredLanguage = sharedPrefs.getString("preferred_language", "english") ?: "english"
    val scope = rememberCoroutineScope()

    // Menu and dialog state
    var showMenu by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    // Track note view and reset AI states when note changes
    LaunchedEffect(note.id) {
        // Reset all AI content states immediately to prevent showing stale content from previous note
        aiViewModel.resetAllStates()
        AnalyticsService.trackNoteViewed(note.id, note.sourceType ?: "unknown")
    }

    LaunchedEffect(note.id, authToken) {
        authToken?.let { token ->
            aiViewModel.loadExistingContent(token, note.id)
        }
    }

    // Track tab switches
    LaunchedEffect(selectedTab) {
        when (selectedTab) {
            1 -> AnalyticsService.trackChatTabViewed(note.id)
            2 -> AnalyticsService.trackQuizTabViewed(note.id)
            3 -> AnalyticsService.trackFlashcardsTabViewed(note.id)
            4 -> AnalyticsService.trackPodcastTabViewed(note.id)
        }
    }

    // Delete confirmation dialog
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Delete Note", color = TextPrimary) },
            text = { Text("Are you sure you want to delete this note? This action cannot be undone.", color = TextSecondary) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteDialog = false
                        authToken?.let { token ->
                            noteViewModel.deleteNote(
                                token = token,
                                noteId = note.id,
                                onSuccess = {
                                    AnalyticsService.trackNoteDeleted(note.id)
                                    onNoteDeleted()
                                },
                                onError = { error ->
                                    Toast.makeText(context, error, Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = AccentRed)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("Cancel")
                }
            },
            containerColor = CardBackground
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            note.title,
                            maxLines = 1,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary
                        )
                        Text(
                            formatNoteDate(note.createdAt),
                            fontSize = 12.sp,
                            color = TextSecondary
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More options")
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false },
                            modifier = Modifier.background(CardBackground)
                        ) {
                            DropdownMenuItem(
                                text = { Text("Share", color = TextPrimary) },
                                onClick = {
                                    showMenu = false
                                    // Share note content
                                    val shareIntent = Intent().apply {
                                        action = Intent.ACTION_SEND
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_SUBJECT, note.title)
                                        putExtra(Intent.EXTRA_TEXT, "${note.title}\n\n${note.content}")
                                    }
                                    context.startActivity(Intent.createChooser(shareIntent, "Share Note"))
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Share, contentDescription = null, tint = TextSecondary)
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Delete", color = AccentRed) },
                                onClick = {
                                    showMenu = false
                                    showDeleteDialog = true
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Delete, contentDescription = null, tint = AccentRed)
                                }
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkBackground,
                    titleContentColor = TextPrimary,
                    navigationIconContentColor = TextPrimary
                )
            )
        },
        containerColor = DarkBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Main content area (takes remaining space)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
            ) {
                // Tab Content
                when (selectedTab) {
                    0 -> NotesTab(note, aiViewModel, authToken, preferredLanguage)
                    1 -> ChatTab(note, aiViewModel, authToken, preferredLanguage)
                    2 -> QuizTab(note, aiViewModel, authToken, preferredLanguage)
                    3 -> FlashcardsTab(note, aiViewModel, authToken, preferredLanguage)
                    4 -> PodcastTab(note, aiViewModel, authToken, preferredLanguage)
                }
            }

            // Bottom navigation bar (like iOS)
            HorizontalDivider(color = DarkSurfaceVariant, thickness = 1.dp)
            BottomTabBar(
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it }
            )
        }
    }
}

/**
 * Bottom tab bar component (like iOS)
 */
@Composable
private fun BottomTabBar(
    selectedTab: Int,
    onTabSelected: (Int) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(CardBackground)
            .padding(top = 8.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        // Notes tab
        BottomTabItem(
            icon = Icons.Default.Description,
            label = "Notes",
            isSelected = selectedTab == 0,
            onClick = { onTabSelected(0) }
        )
        // Chat tab
        BottomTabItem(
            icon = Icons.Default.Message,
            label = "Chat",
            isSelected = selectedTab == 1,
            onClick = { onTabSelected(1) }
        )
        // Quiz tab
        BottomTabItem(
            icon = Icons.Default.Quiz,
            label = "Quiz",
            isSelected = selectedTab == 2,
            onClick = { onTabSelected(2) }
        )
        // Flashcards tab
        BottomTabItem(
            icon = Icons.Default.Style,
            label = "Flashcards",
            isSelected = selectedTab == 3,
            onClick = { onTabSelected(3) }
        )
        // Podcast tab
        BottomTabItem(
            icon = Icons.Default.Podcasts,
            label = "Podcast",
            isSelected = selectedTab == 4,
            onClick = { onTabSelected(4) }
        )
    }
}

@Composable
private fun BottomTabItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier
            .padding(horizontal = 12.dp)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            ),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (isSelected) Purple80 else TextSecondary,
            modifier = Modifier.size(24.dp)
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = label,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            color = if (isSelected) Purple80 else TextSecondary
        )
    }
}

/**
 * Split large content into chunks for better performance
 * Matches iOS implementation for handling large notes
 */
private fun splitContentIntoChunks(content: String, chunkSize: Int = 5000): List<String> {
    if (content.length <= chunkSize) {
        return listOf(content)
    }

    val chunks = mutableListOf<String>()
    var currentIndex = 0

    while (currentIndex < content.length) {
        var endIndex = minOf(currentIndex + chunkSize, content.length)

        // Try to break at a space or newline for cleaner chunks
        if (endIndex < content.length) {
            val searchStart = maxOf(endIndex - 100, currentIndex)
            val searchRange = content.substring(searchStart, endIndex)
            val lastBreak = maxOf(
                searchRange.lastIndexOf(' '),
                searchRange.lastIndexOf('\n')
            )
            if (lastBreak > 0) {
                endIndex = searchStart + lastBreak + 1
            }
        }

        chunks.add(content.substring(currentIndex, endIndex))
        currentIndex = endIndex
    }

    return chunks
}

/**
 * Calculate word count - uses approximation for very large content
 */
private fun calculateWordCount(content: String): Int {
    return if (content.length > 100000) {
        // Approximate: average word length is ~5 chars + 1 space
        content.length / 6
    } else {
        content.split(Regex("\\s+")).filter { it.isNotEmpty() }.size
    }
}

@Composable
fun NotesTab(
    note: Note,
    aiViewModel: AIViewModel,
    authToken: String?,
    preferredLanguage: String
) {
    // State for current note (may be updated when formatting completes)
    var currentNote by remember { mutableStateOf(note) }
    var isCheckingFormatting by remember { mutableStateOf(false) }
    var showRawContent by remember { mutableStateOf(false) }
    var showSummary by remember { mutableStateOf(false) }

    // Summary state
    val summaryState by aiViewModel.summaryState.collectAsState()
    var isGeneratingSummary by remember { mutableStateOf(false) }

    // Get content to display (formatted or raw)
    val displayContent = if (currentNote.hasFormattedContent && !showRawContent) {
        currentNote.formattedContent ?: currentNote.content
    } else {
        currentNote.content
    }

    // Debug logging
    LaunchedEffect(currentNote.id) {
        android.util.Log.d("NotesTab", "Note: ${currentNote.id}")
        android.util.Log.d("NotesTab", "hasFormattedContent: ${currentNote.hasFormattedContent}")
        android.util.Log.d("NotesTab", "formattingStatus: ${currentNote.formattingStatus}")
        android.util.Log.d("NotesTab", "formattedContent length: ${currentNote.formattedContent?.length ?: 0}")
        android.util.Log.d("NotesTab", "showRawContent: $showRawContent")
        android.util.Log.d("NotesTab", "displayContent preview: ${displayContent.take(200)}")
    }

    // Split content into chunks for performance with large notes
    val contentChunks = remember(displayContent) {
        splitContentIntoChunks(displayContent)
    }

    val wordCount = remember(currentNote.content) {
        calculateWordCount(currentNote.content)
    }

    val characterCount = remember(currentNote.content) {
        currentNote.content.length
    }

    // Poll for formatted content if not available
    LaunchedEffect(note.id, currentNote.hasFormattedContent) {
        if (!currentNote.hasFormattedContent && currentNote.content.length >= 200 && authToken != null) {
            isCheckingFormatting = true
            val repository = NoteRepository()

            repeat(15) { // Poll for up to 30 seconds
                delay(2000)
                try {
                    val result = repository.getNote(authToken, note.id)
                    result.fold(
                        onSuccess = { refreshedNote ->
                            if (refreshedNote.hasFormattedContent) {
                                currentNote = refreshedNote
                                isCheckingFormatting = false
                                return@LaunchedEffect
                            }
                        },
                        onFailure = { /* Continue polling */ }
                    )
                } catch (e: Exception) {
                    // Continue polling on error
                }
            }
            isCheckingFormatting = false
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        contentPadding = PaddingValues(vertical = 16.dp)
    ) {
        // Metadata header
        item {
            Column(
                modifier = Modifier.padding(bottom = 12.dp)
            ) {
                // Date
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(bottom = 4.dp)
                ) {
                    Icon(
                        Icons.Default.DateRange,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = formatNoteDate(currentNote.createdAt),
                        fontSize = 13.sp,
                        color = TextSecondary
                    )
                }

                // Source type with optional clickable link
                currentNote.sourceType?.let { sourceType ->
                    val context = LocalContext.current
                    val hasSourceUrl = !currentNote.sourceUrl.isNullOrEmpty()

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .padding(bottom = 4.dp)
                            .then(
                                if (hasSourceUrl) {
                                    Modifier.clickable {
                                        currentNote.sourceUrl?.let { url ->
                                            try {
                                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                                context.startActivity(intent)
                                            } catch (e: Exception) {
                                                Toast.makeText(context, "Could not open link", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    }
                                } else Modifier
                            )
                    ) {
                        Icon(
                            when (sourceType) {
                                "video" -> Icons.Default.PlayArrow
                                "recording" -> Icons.Default.Mic
                                "pdf" -> Icons.Default.Description
                                "scan" -> Icons.Default.CameraAlt
                                else -> Icons.Default.Note
                            },
                            contentDescription = null,
                            tint = if (hasSourceUrl) Purple80 else TextSecondary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Source: ${getSourceLabel(sourceType)}",
                            fontSize = 13.sp,
                            color = if (hasSourceUrl) Purple80 else TextSecondary
                        )
                        if (hasSourceUrl) {
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                Icons.Default.OpenInNew,
                                contentDescription = "Open source",
                                tint = Purple80,
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }
                }

                // Character and word count with format toggle
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        Icons.Default.Description,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${"%,d".format(characterCount)} characters • ${"%,d".format(wordCount)} words",
                        fontSize = 13.sp,
                        color = TextSecondary
                    )

                    Spacer(Modifier.weight(1f))

                    // Toggle between formatted and raw content
                    if (currentNote.hasFormattedContent) {
                        TextButton(
                            onClick = { showRawContent = !showRawContent },
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Icon(
                                if (showRawContent) Icons.Default.AutoAwesome else Icons.Default.Description,
                                contentDescription = null,
                                tint = Purple80,
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                if (showRawContent) "Formatted" else "Raw",
                                fontSize = 12.sp,
                                color = Purple80
                            )
                        }
                    }
                }

                // Formatting status indicator
                if (currentNote.isFormatting || isCheckingFormatting) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(top = 4.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(12.dp),
                            strokeWidth = 2.dp,
                            color = TextTertiary
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Formatting notes...",
                            fontSize = 12.sp,
                            color = TextTertiary
                        )
                    }
                }
            }
        }

        // Collapsible Summary Section
        item {
            SummarySection(
                showSummary = showSummary,
                onToggle = { showSummary = !showSummary },
                summaryState = summaryState,
                onGenerateSummary = {
                    if (authToken != null) {
                        aiViewModel.generateSummary(authToken, note.id, "medium", preferredLanguage)
                    }
                }
            )
            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = DarkSurfaceVariant)
            Spacer(Modifier.height(16.dp))
        }

        // Content - use FormattedNoteView for formatted content, plain text for raw
        item {
            if (currentNote.hasFormattedContent && !showRawContent) {
                // Use formatted markdown view
                FormattedNoteView(
                    content = displayContent,
                    modifier = Modifier.fillMaxWidth()
                )
            } else {
                // Plain text for raw content
                contentChunks.forEach { chunk ->
                    Text(
                        chunk,
                        fontSize = 16.sp,
                        lineHeight = 24.sp,
                        color = TextPrimary
                    )
                }
            }
        }

        // Bottom spacing
        item {
            Spacer(Modifier.height(32.dp))
        }
    }
}

/**
 * Collapsible Summary Section (like iOS)
 */
@Composable
private fun SummarySection(
    showSummary: Boolean,
    onToggle: () -> Unit,
    summaryState: AIContentState,
    onGenerateSummary: () -> Unit
) {
    val hasSummary = summaryState is AIContentState.Success &&
                     (summaryState as? AIContentState.Success)?.content?.summary != null

    Column {
        // Summary header/toggle button
        Card(
            onClick = onToggle,
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = CardBackground),
            shape = RoundedCornerShape(10.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Summarize,
                    contentDescription = null,
                    tint = Purple80,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Summary",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = Purple80
                )

                if (hasSummary) {
                    Spacer(Modifier.width(8.dp))
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = AccentGreen,
                        modifier = Modifier.size(14.dp)
                    )
                }

                Spacer(Modifier.weight(1f))

                Icon(
                    if (showSummary) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = TextSecondary,
                    modifier = Modifier.size(20.dp)
                )
            }
        }

        // Expanded summary content
        AnimatedVisibility(
            visible = showSummary,
            enter = expandVertically(),
            exit = shrinkVertically()
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                colors = CardDefaults.cardColors(containerColor = CardBackground.copy(alpha = 0.5f)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    when (summaryState) {
                        is AIContentState.Loading -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = Purple80
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Generating summary...",
                                    fontSize = 13.sp,
                                    color = TextSecondary
                                )
                            }
                        }
                        is AIContentState.Success -> {
                            val summary = summaryState.content.summary
                            if (summary != null) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.Top
                                ) {
                                    Text(
                                        summary,
                                        fontSize = 14.sp,
                                        color = TextPrimary,
                                        lineHeight = 20.sp,
                                        modifier = Modifier.weight(1f)
                                    )
                                    IconButton(
                                        onClick = onGenerateSummary,
                                        modifier = Modifier.size(24.dp)
                                    ) {
                                        Icon(
                                            Icons.Default.Refresh,
                                            contentDescription = "Regenerate",
                                            tint = TextSecondary,
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                }
                            } else {
                                NoSummaryContent(onGenerateSummary)
                            }
                        }
                        else -> {
                            NoSummaryContent(onGenerateSummary)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NoSummaryContent(onGenerateSummary: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            "No summary yet",
            fontSize = 13.sp,
            color = TextSecondary
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = onGenerateSummary,
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(8.dp)
        ) {
            Icon(
                Icons.Default.AutoAwesome,
                contentDescription = null,
                modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(6.dp))
            Text("Generate Summary", fontSize = 13.sp)
        }
    }
}

private fun formatNoteDate(dateString: String): String {
    return try {
        val inputFormat = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault())
        val outputFormat = java.text.SimpleDateFormat("MMM d, yyyy 'at' h:mm a", java.util.Locale.getDefault())
        val date = inputFormat.parse(dateString.substringBefore(".").substringBefore("Z"))
        date?.let { outputFormat.format(it) } ?: dateString
    } catch (e: Exception) {
        dateString
    }
}

/**
 * Get a user-friendly label for the source type
 */
private fun getSourceLabel(sourceType: String): String {
    return when (sourceType.lowercase()) {
        "video" -> "YouTube Video"
        "recording" -> "Audio Recording"
        "pdf" -> "PDF Document"
        "scan" -> "Scanned Document"
        "image" -> "Image"
        "text" -> "Text"
        else -> sourceType.replaceFirstChar { it.uppercase() }
    }
}

@Composable
fun SummaryTab(note: Note, aiViewModel: AIViewModel, authToken: String?, language: String) {
    val summaryState by aiViewModel.summaryState.collectAsState()
    var selectedLength by remember { mutableStateOf("medium") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        when (val state = summaryState) {
            is AIContentState.Idle -> {
                Column {
                    // Length selector
                    Text(
                        "Summary Length",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(bottom = 24.dp)
                    ) {
                        listOf("short", "medium", "long").forEach { length ->
                            FilterChip(
                                selected = selectedLength == length,
                                onClick = { selectedLength = length },
                                label = { Text(length.capitalize()) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Purple80,
                                    selectedLabelColor = DarkBackground
                                )
                            )
                        }
                    }

                    GenerateContentPrompt(
                        icon = Icons.Default.Summarize,
                        title = "Generate Summary",
                        description = "Create a concise summary of your notes",
                        onGenerate = {
                            if (authToken != null) {
                                aiViewModel.generateSummary(authToken, note.id, selectedLength, language)
                            }
                        }
                    )
                }
            }
            is AIContentState.Loading -> {
                LoadingContent("Generating summary...")
            }
            is AIContentState.Success -> {
                Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = CardBackground),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Summary",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Purple80
                                )
                                IconButton(
                                    onClick = {
                                        if (authToken != null) {
                                            aiViewModel.generateSummary(authToken, note.id, selectedLength, language)
                                        }
                                    }
                                ) {
                                    Icon(
                                        Icons.Default.Refresh,
                                        contentDescription = "Regenerate",
                                        tint = Purple80
                                    )
                                }
                            }
                            Spacer(Modifier.height(12.dp))
                            Text(
                                state.content.summary ?: "No summary available",
                                fontSize = 15.sp,
                                lineHeight = 22.sp,
                                color = TextPrimary
                            )
                        }
                    }
                }
            }
            is AIContentState.Error -> {
                ErrorContent(state.message) {
                    if (authToken != null) {
                        aiViewModel.generateSummary(authToken, note.id, selectedLength, language)
                    }
                }
            }
        }
    }
}

@Composable
fun ChatTab(note: Note, aiViewModel: AIViewModel, authToken: String?, preferredLanguage: String) {
    var messages by remember { mutableStateOf(listOf<ChatMessage>()) }
    var inputText by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var isVoiceMode by remember { mutableStateOf(false) }
    var isListening by remember { mutableStateOf(false) }
    var isSpeaking by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // Text-to-Speech setup
    val tts = remember {
        android.speech.tts.TextToSpeech(context) { status ->
            if (status == android.speech.tts.TextToSpeech.SUCCESS) {
                // TTS initialized successfully
            }
        }
    }

    // Cleanup TTS
    DisposableEffect(Unit) {
        onDispose {
            tts.stop()
            tts.shutdown()
        }
    }

    // Speech recognizer setup
    val speechRecognizerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        isListening = false
        if (result.resultCode == Activity.RESULT_OK) {
            val spokenText = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.get(0)
            if (!spokenText.isNullOrBlank()) {
                if (isVoiceMode) {
                    // In voice mode, automatically send the message
                    sendChatMessage(
                        message = spokenText,
                        noteId = note.id,
                        authToken = authToken,
                        aiViewModel = aiViewModel,
                        messages = messages,
                        onMessagesUpdate = { messages = it },
                        onLoadingChange = { isLoading = it },
                        onInputClear = { inputText = "" },
                        onResponseReceived = { response ->
                            // Speak the response in voice mode
                            if (isVoiceMode) {
                                isSpeaking = true
                                tts.speak(response, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, null)
                                tts.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                                    override fun onStart(utteranceId: String?) {
                                        isSpeaking = true
                                    }
                                    override fun onDone(utteranceId: String?) {
                                        isSpeaking = false
                                    }
                                    override fun onError(utteranceId: String?) {
                                        isSpeaking = false
                                    }
                                })
                            }
                        }
                    )
                } else {
                    // In text mode, just fill the input
                    inputText = spokenText
                }
            }
        }
    }

    // Auto-scroll to bottom when new message arrives
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(0)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize()
    ) {
        // Mode Toggle Header
        Surface(
            color = CardBackground,
            shadowElevation = 2.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (isVoiceMode) Icons.Default.RecordVoiceOver else Icons.Default.Chat,
                        contentDescription = null,
                        tint = if (isVoiceMode) Purple80 else TextSecondary,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (isVoiceMode) "Voice Conversation Mode" else "Text Chat Mode",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = if (isVoiceMode) Purple80 else TextPrimary
                    )
                }

                Switch(
                    checked = isVoiceMode,
                    onCheckedChange = {
                        isVoiceMode = it
                        if (!it) {
                            // Stop speaking when exiting voice mode
                            tts.stop()
                            isSpeaking = false
                        }
                    },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Purple80,
                        checkedTrackColor = Purple80.copy(alpha = 0.5f)
                    )
                )
            }
        }

        // Messages list
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            if (messages.isEmpty()) {
                WelcomeMessage(isVoiceMode)
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    reverseLayout = true,
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.Bottom)
                ) {
                    items(
                        items = messages.reversed(),
                        key = { it.id }
                    ) { message ->
                        ChatMessageBubble(message)
                    }
                }
            }
        }

        // Voice Mode Status Indicator
        if (isVoiceMode) {
            VoiceModeStatusBar(isListening, isSpeaking, isLoading)
        }

        // Loading indicator (for text mode)
        if (!isVoiceMode) {
            AnimatedVisibility(visible = isLoading) {
                LoadingIndicator()
            }
        }

        // Input area
        if (isVoiceMode) {
            VoiceModeInput(
                isListening = isListening,
                isSpeaking = isSpeaking,
                isLoading = isLoading,
                onStartListening = {
                    if (!isLoading && !isSpeaking) {
                        isListening = true
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask a question about your notes...")
                        }
                        try {
                            speechRecognizerLauncher.launch(intent)
                        } catch (e: Exception) {
                            isListening = false
                            Toast.makeText(context, "Voice input not available", Toast.LENGTH_SHORT).show()
                        }
                    }
                },
                onStopSpeaking = {
                    tts.stop()
                    isSpeaking = false
                }
            )
        } else {
            ChatInputArea(
                inputText = inputText,
                onInputChange = { inputText = it },
                isLoading = isLoading,
                onSendMessage = {
                    if (inputText.isNotBlank() && !isLoading && authToken != null) {
                        sendChatMessage(
                            message = inputText,
                            noteId = note.id,
                            authToken = authToken,
                            aiViewModel = aiViewModel,
                            messages = messages,
                            onMessagesUpdate = { messages = it },
                            onLoadingChange = { isLoading = it },
                            onInputClear = { inputText = "" },
                            onResponseReceived = {}
                        )
                    }
                },
                onVoiceInput = {
                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask a question about your notes...")
                    }
                    try {
                        speechRecognizerLauncher.launch(intent)
                    } catch (e: Exception) {
                        Toast.makeText(context, "Voice input not available", Toast.LENGTH_SHORT).show()
                    }
                }
            )
        }
    }
}

@Composable
private fun WelcomeMessage(isVoiceMode: Boolean) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                if (isVoiceMode) Icons.Default.RecordVoiceOver else Icons.Default.Chat,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = Purple80
            )
            Spacer(Modifier.height(16.dp))
            Text(
                if (isVoiceMode) "Have a voice conversation" else "Ask anything about your notes",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                if (isVoiceMode)
                    "Tap the microphone to start talking. I'll respond with voice too!"
                else
                    "Type or use voice to ask questions",
                fontSize = 14.sp,
                color = TextSecondary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
}

@Composable
private fun VoiceModeStatusBar(isListening: Boolean, isSpeaking: Boolean, isLoading: Boolean) {
    AnimatedVisibility(visible = isListening || isSpeaking || isLoading) {
        Surface(
            color = when {
                isListening -> Purple80.copy(alpha = 0.1f)
                isSpeaking -> Purple80.copy(alpha = 0.2f)
                else -> CardBackground
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                when {
                    isListening -> {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Purple80
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            "Listening...",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                            color = Purple80
                        )
                    }
                    isSpeaking -> {
                        Icon(
                            Icons.Default.VolumeUp,
                            contentDescription = null,
                            tint = Purple80,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            "Speaking...",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                            color = Purple80
                        )
                    }
                    isLoading -> {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Purple80
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            "Thinking...",
                            fontSize = 15.sp,
                            color = TextSecondary
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceModeInput(
    isListening: Boolean,
    isSpeaking: Boolean,
    isLoading: Boolean,
    onStartListening: () -> Unit,
    onStopSpeaking: () -> Unit
) {
    Surface(
        color = CardBackground,
        shadowElevation = 8.dp
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            if (isSpeaking) {
                // Stop button when AI is speaking
                FloatingActionButton(
                    onClick = onStopSpeaking,
                    containerColor = AccentRed,
                    contentColor = DarkBackground,
                    modifier = Modifier.size(80.dp)
                ) {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = "Stop speaking",
                        modifier = Modifier.size(36.dp)
                    )
                }
            } else {
                // Microphone button
                FloatingActionButton(
                    onClick = onStartListening,
                    containerColor = Purple80,
                    contentColor = DarkBackground,
                    modifier = Modifier.size(80.dp),
                    elevation = FloatingActionButtonDefaults.elevation(
                        defaultElevation = if (isListening) 8.dp else 6.dp
                    )
                ) {
                    Icon(
                        Icons.Default.Mic,
                        contentDescription = if (isListening) "Listening..." else "Tap to speak",
                        modifier = Modifier.size(36.dp)
                    )
                }
            }
        }
    }
}

// Update the sendChatMessage function to include callback for response
private fun sendChatMessage(
    message: String,
    noteId: String,
    authToken: String?,
    aiViewModel: AIViewModel,
    messages: List<ChatMessage>,
    onMessagesUpdate: (List<ChatMessage>) -> Unit,
    onLoadingChange: (Boolean) -> Unit,
    onInputClear: () -> Unit,
    onResponseReceived: (String) -> Unit
) {
    if (authToken == null) return

    val userMessage = ChatMessage(
        id = System.currentTimeMillis().toString(),
        text = message,
        isUser = true
    )
    onMessagesUpdate(messages + userMessage)
    onInputClear()
    onLoadingChange(true)

    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
        try {
            val conversationHistory = messages.map { msg ->
                ChatMessage(
                    text = msg.text,
                    isUser = msg.isUser
                )
            }

            val response = aiViewModel.chatWithNote(authToken, noteId, message, conversationHistory)
            val aiMessage = ChatMessage(
                id = System.currentTimeMillis().toString(),
                text = response,
                isUser = false
            )
            onMessagesUpdate(messages + userMessage + aiMessage)
            onResponseReceived(response)
        } catch (e: Exception) {
            val errorMessage = ChatMessage(
                id = System.currentTimeMillis().toString(),
                text = "Sorry, I encountered an error: ${e.message}",
                isUser = false
            )
            onMessagesUpdate(messages + userMessage + errorMessage)
        } finally {
            onLoadingChange(false)
        }
    }
}

@Composable
private fun WelcomeMessage() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.Chat,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = Purple80
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "Ask anything about your notes",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Type or use voice to ask questions",
                fontSize = 14.sp,
                color = TextSecondary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
}

@Composable
private fun LoadingIndicator() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(16.dp),
            strokeWidth = 2.dp,
            color = Purple80
        )
        Spacer(Modifier.width(8.dp))
        Text(
            "Thinking...",
            fontSize = 14.sp,
            color = TextSecondary
        )
    }
}

@Composable
fun ChatInputArea(
    inputText: String,
    onInputChange: (String) -> Unit,
    isLoading: Boolean,
    onSendMessage: () -> Unit,
    onVoiceInput: () -> Unit
) {
    Surface(
        color = CardBackground,
        shadowElevation = 8.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            // Voice input button
            IconButton(
                onClick = onVoiceInput,
                enabled = !isLoading,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(
                    Icons.Default.Mic,
                    contentDescription = "Voice input",
                    tint = if (isLoading) TextTertiary else Purple80,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(Modifier.width(8.dp))

            // Text input
            OutlinedTextField(
                value = inputText,
                onValueChange = onInputChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Ask a question...", fontSize = 14.sp) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Purple80,
                    unfocusedBorderColor = DarkSurfaceVariant,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    cursorColor = Purple80,
                    disabledBorderColor = DarkSurfaceVariant,
                    disabledTextColor = TextSecondary
                ),
                shape = RoundedCornerShape(24.dp),
                keyboardOptions = KeyboardOptions(
                    imeAction = ImeAction.Send
                ),
                keyboardActions = KeyboardActions(
                    onSend = { onSendMessage() }
                ),
                maxLines = 4,
                enabled = !isLoading
            )

            Spacer(Modifier.width(8.dp))

            // Send button
            FloatingActionButton(
                onClick = onSendMessage,
                containerColor = Purple80,
                contentColor = DarkBackground,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(
                    Icons.Default.Send,
                    contentDescription = "Send",
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
fun ChatMessageBubble(message: ChatMessage) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.isUser) Arrangement.End else Arrangement.Start
    ) {
        Card(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .wrapContentHeight(), // Changed from fixed height
            colors = CardDefaults.cardColors(
                containerColor = if (message.isUser) Purple80 else CardBackground
            ),
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (message.isUser) 16.dp else 4.dp,
                bottomEnd = if (message.isUser) 4.dp else 16.dp
            )
        ) {
            Text(
                message.text,
                modifier = Modifier.padding(12.dp),
                fontSize = 14.sp,
                color = if (message.isUser) DarkBackground else TextPrimary,
                lineHeight = 20.sp
            )
        }
    }
}

// Helper function to send messages
private fun sendChatMessage(
    message: String,
    noteId: String,
    authToken: String,
    aiViewModel: AIViewModel,
    messages: List<ChatMessage>,
    onMessagesUpdate: (List<ChatMessage>) -> Unit,
    onLoadingChange: (Boolean) -> Unit,
    onInputClear: () -> Unit
) {
    val userMessage = ChatMessage(
        id = System.currentTimeMillis().toString(),
        text = message,
        isUser = true
    )
    onMessagesUpdate(messages + userMessage)
    onInputClear()
    onLoadingChange(true)

    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
        try {
            val response = aiViewModel.chatWithNote(authToken, noteId, message, messages)
            val aiMessage = ChatMessage(
                id = System.currentTimeMillis().toString(),
                text = response,
                isUser = false
            )
            onMessagesUpdate(messages + userMessage + aiMessage)
        } catch (e: Exception) {
            val errorMessage = ChatMessage(
                id = System.currentTimeMillis().toString(),
                text = "Sorry, I encountered an error: ${e.message}",
                isUser = false
            )
            onMessagesUpdate(messages + userMessage + errorMessage)
        } finally {
            onLoadingChange(false)
        }
    }
}



// Voice options enum (like iOS)
enum class PodcastVoice(val value: String, val displayName: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    FEMALE("nova", "Female", Icons.Default.Face),
    MALE("onyx", "Male", Icons.Default.Person)
}

// Duration options
data class DurationOption(val id: String, val label: String, val description: String)

@Composable
fun PodcastTab(note: Note, aiViewModel: AIViewModel, authToken: String?, preferredLanguage: String) {
    val podcastState by aiViewModel.podcastState.collectAsState()
    var timeElapsed by remember { mutableStateOf(0) }
    var isPlaying by remember { mutableStateOf(false) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var currentPosition by remember { mutableStateOf(0) }
    var duration by remember { mutableStateOf(0) }

    // Podcast generation options
    var selectedDuration by remember { mutableStateOf("short") }
    var selectedVoice by remember { mutableStateOf(PodcastVoice.FEMALE) }
    var showInstructions by remember { mutableStateOf(false) }
    var instructions by remember { mutableStateOf("") }

    val durationOptions = listOf(
        DurationOption("short", "Short", "3-5 min"),
        DurationOption("medium", "Medium", "8-12 min"),
        DurationOption("long", "Long", "15-20 min")
    )

    val context = LocalContext.current

    // Cleanup media player
    DisposableEffect(Unit) {
        onDispose {
            mediaPlayer?.release()
        }
    }

    LaunchedEffect(podcastState) {
        if (podcastState is AIContentState.Loading) {
            while (true) {
                delay(1000)
                timeElapsed++
            }
        } else {
            timeElapsed = 0
        }
    }

    // Update progress
    LaunchedEffect(isPlaying) {
        while (isPlaying) {
            mediaPlayer?.let {
                currentPosition = it.currentPosition
                if (duration == 0) {
                    duration = it.duration
                }
            }
            delay(100)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        when (val state = podcastState) {
            is AIContentState.Idle -> {
                // Podcast generation options UI
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        Icons.Default.Podcasts,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = Purple80
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "Generate Audio Podcast",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Transform your notes into an AI-generated podcast",
                        fontSize = 14.sp,
                        color = TextSecondary,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )

                    Spacer(Modifier.height(24.dp))

                    // Duration selector
                    Text(
                        "Duration",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary,
                        modifier = Modifier.align(Alignment.Start)
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        durationOptions.forEach { option ->
                            DurationOptionCard(
                                option = option,
                                isSelected = selectedDuration == option.id,
                                onClick = { selectedDuration = option.id },
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    Spacer(Modifier.height(20.dp))

                    // Voice selector
                    Text(
                        "Voice",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary,
                        modifier = Modifier.align(Alignment.Start)
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        PodcastVoice.entries.forEach { voice ->
                            VoiceOptionCard(
                                voice = voice,
                                isSelected = selectedVoice == voice,
                                onClick = { selectedVoice = voice },
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    Spacer(Modifier.height(20.dp))

                    // Instructions (expandable)
                    if (showInstructions) {
                        Column(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Instructions",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = TextPrimary
                                )
                                IconButton(onClick = { showInstructions = false; instructions = "" }) {
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = "Remove",
                                        tint = TextSecondary,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = instructions,
                                onValueChange = { instructions = it },
                                modifier = Modifier.fillMaxWidth(),
                                placeholder = { Text("Describe any specific focus or style...", color = TextTertiary) },
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = Purple80,
                                    unfocusedBorderColor = DarkSurfaceVariant,
                                    focusedContainerColor = CardBackground,
                                    unfocusedContainerColor = CardBackground
                                ),
                                shape = RoundedCornerShape(12.dp),
                                minLines = 2,
                                maxLines = 4
                            )
                        }
                    } else {
                        OutlinedButton(
                            onClick = { showInstructions = true },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Purple80.copy(alpha = 0.3f))
                        ) {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = null,
                                tint = Purple80,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Add instructions", color = Purple80)
                            Spacer(Modifier.weight(1f))
                            Text(
                                "OPTIONAL",
                                fontSize = 10.sp,
                                color = TextTertiary
                            )
                        }
                    }

                    Spacer(Modifier.height(32.dp))

                    // Generate button
                    Button(
                        onClick = {
                            if (authToken != null) {
                                val trimmedInstructions = instructions.trim().ifEmpty { null }
                                aiViewModel.generatePodcast(
                                    authToken,
                                    note.id,
                                    generateAudio = true,
                                    duration = selectedDuration,
                                    voice = selectedVoice.value,
                                    instructions = trimmedInstructions,
                                    language = preferredLanguage
                                )
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Generate Podcast", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            is AIContentState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(32.dp)
                    ) {
                        CircularProgressIndicator(
                            color = Purple80,
                            modifier = Modifier.size(64.dp),
                            strokeWidth = 6.dp
                        )
                        Spacer(Modifier.height(24.dp))
                        Text(
                            "Generating your podcast...",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "This may take 30-60 seconds",
                            fontSize = 14.sp,
                            color = TextSecondary
                        )
                        Spacer(Modifier.height(16.dp))

                        LinearProgressIndicator(
                            modifier = Modifier
                                .fillMaxWidth(0.6f)
                                .height(4.dp),
                            color = Purple80,
                            trackColor = Purple80.copy(alpha = 0.2f)
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "${timeElapsed}s elapsed",
                            fontSize = 12.sp,
                            color = TextTertiary
                        )

                        Spacer(Modifier.height(32.dp))
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(
                                containerColor = CardBackground
                            )
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Default.Lightbulb,
                                        contentDescription = null,
                                        tint = Purple80,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        "Did you know?",
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Purple80
                                    )
                                }
                                Spacer(Modifier.height(8.dp))
                                Text(
                                    "AI is converting your notes into natural-sounding audio using advanced text-to-speech technology.",
                                    fontSize = 13.sp,
                                    color = TextSecondary,
                                    lineHeight = 18.sp
                                )
                            }
                        }
                    }
                }
            }
            is AIContentState.Success -> {
                state.content.audioUrl?.let { audioUrl ->
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = CardBackground
                            ),
                            shape = RoundedCornerShape(24.dp)
                        ) {
                            Column(
                                modifier = Modifier.padding(32.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                // Podcast icon
                                Box(
                                    modifier = Modifier
                                        .size(120.dp)
                                        .background(Purple80.copy(alpha = 0.2f), RoundedCornerShape(60.dp)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        Icons.Default.Podcasts,
                                        contentDescription = null,
                                        tint = Purple80,
                                        modifier = Modifier.size(64.dp)
                                    )
                                }

                                Spacer(Modifier.height(24.dp))

                                Text(
                                    note.title,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = TextPrimary,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                    maxLines = 2
                                )

                                Spacer(Modifier.height(8.dp))

                                Text(
                                    "AI-Generated Podcast",
                                    fontSize = 14.sp,
                                    color = TextSecondary
                                )

                                Spacer(Modifier.height(32.dp))

                                // Progress bar
                                if (duration > 0) {
                                    Column(modifier = Modifier.fillMaxWidth()) {
                                        LinearProgressIndicator(
                                            progress = currentPosition.toFloat() / duration.toFloat(),
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .height(4.dp),
                                            color = Purple80,
                                            trackColor = Purple80.copy(alpha = 0.2f)
                                        )
                                        Spacer(Modifier.height(8.dp))
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Text(
                                                formatTime(currentPosition),
                                                fontSize = 12.sp,
                                                color = TextTertiary
                                            )
                                            Text(
                                                formatTime(duration),
                                                fontSize = 12.sp,
                                                color = TextTertiary
                                            )
                                        }
                                    }
                                    Spacer(Modifier.height(24.dp))
                                }

                                // Play/Pause button
                                FloatingActionButton(
                                    onClick = {
                                        if (isPlaying) {
                                            mediaPlayer?.pause()
                                            isPlaying = false
                                        } else {
                                            if (mediaPlayer == null) {
                                                mediaPlayer = MediaPlayer().apply {
                                                    try {
                                                        setDataSource(audioUrl)
                                                        prepareAsync()
                                                        setOnPreparedListener {
                                                            duration = it.duration
                                                            start()
                                                            isPlaying = true
                                                        }
                                                        setOnErrorListener { mp, what, extra ->
                                                            android.util.Log.e("PodcastTab", "MediaPlayer error: what=$what, extra=$extra")
                                                            // Show error to user
                                                            isPlaying = false
                                                            true
                                                        }
                                                        setOnCompletionListener {
                                                            isPlaying = false
                                                            currentPosition = 0
                                                        }
                                                    } catch (e: Exception) {
                                                        android.util.Log.e("PodcastTab", "Error playing audio", e)
                                                    }
                                                }
                                            } else {
                                                mediaPlayer?.start()
                                                isPlaying = true
                                            }
                                        }
                                    },
                                    containerColor = Purple80,
                                    contentColor = DarkBackground,
                                    modifier = Modifier.size(72.dp)
                                ) {
                                    Icon(
                                        if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                                        contentDescription = if (isPlaying) "Pause" else "Play",
                                        modifier = Modifier.size(40.dp)
                                    )
                                }

                                Spacer(Modifier.height(24.dp))

                                // Status text
                                Text(
                                    if (isPlaying) "Now Playing" else "Ready to Play",
                                    fontSize = 14.sp,
                                    color = if (isPlaying) Purple80 else TextSecondary,
                                    fontWeight = if (isPlaying) FontWeight.Medium else FontWeight.Normal
                                )
                            }
                        }
                    }
                } ?: run {
                    // No audio available
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(32.dp)
                        ) {
                            Icon(
                                Icons.Default.ErrorOutline,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = AccentRed
                            )
                            Spacer(Modifier.height(16.dp))
                            Text(
                                "Audio generation failed",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Medium,
                                color = TextPrimary
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "Please try generating again",
                                fontSize = 14.sp,
                                color = TextSecondary
                            )
                            Spacer(Modifier.height(24.dp))
                            Button(
                                onClick = {
                                    if (authToken != null) {
                                        aiViewModel.generatePodcast(authToken, note.id, generateAudio = true, language = preferredLanguage)
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Purple80
                                )
                            ) {
                                Text("Retry")
                            }
                        }
                    }
                }
            }
            is AIContentState.Error -> {
                ErrorContent(state.message) {
                    if (authToken != null) {
                        aiViewModel.generatePodcast(authToken, note.id, generateAudio = true, language = preferredLanguage)
                    }
                }
            }
        }
    }
}

// Helper function to format time
private fun formatTime(milliseconds: Int): String {
    val seconds = milliseconds / 1000
    val minutes = seconds / 60
    val remainingSeconds = seconds % 60
    return String.format("%d:%02d", minutes, remainingSeconds)
}

@Composable
fun QuizTab(note: Note, aiViewModel: AIViewModel, authToken: String?, preferredLanguage: String) {
    val quizState by aiViewModel.quizState.collectAsState()

    // Quiz interaction state
    var currentQuestionIndex by remember { mutableStateOf(0) }
    var selectedAnswer by remember { mutableStateOf<Int?>(null) }
    var showExplanation by remember { mutableStateOf(false) }
    var score by remember { mutableStateOf(0) }
    var quizCompleted by remember { mutableStateOf(false) }

    // Reset state when quiz changes
    LaunchedEffect(quizState) {
        if (quizState is AIContentState.Success) {
            currentQuestionIndex = 0
            selectedAnswer = null
            showExplanation = false
            score = 0
            quizCompleted = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        when (val state = quizState) {
            is AIContentState.Idle -> {
                GenerateContentPrompt(
                    icon = Icons.Default.Quiz,
                    title = "Generate Quiz",
                    description = "Test your knowledge with AI-generated questions",
                    onGenerate = {
                        if (authToken != null) {
                            aiViewModel.generateQuiz(authToken, note.id, language = preferredLanguage)
                        }
                    }
                )
            }
            is AIContentState.Loading -> {
                LoadingContent("Generating quiz questions...")
            }
            is AIContentState.Success -> {
                val questions = state.content.questions?.quizQuestions
                    ?.filter { it.question.isNotBlank() && it.options.isNotEmpty() }

                if (questions.isNullOrEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("No questions generated", color = TextSecondary)
                    }
                } else if (quizCompleted) {
                    // Show results
                    QuizResultsView(
                        score = score,
                        total = questions.size,
                        onRestart = {
                            currentQuestionIndex = 0
                            selectedAnswer = null
                            showExplanation = false
                            score = 0
                            quizCompleted = false
                        },
                        onGenerateNew = {
                            // Reset state and generate new quiz
                            aiViewModel.resetState("quiz")
                            if (authToken != null) {
                                aiViewModel.generateQuiz(authToken, note.id, language = preferredLanguage)
                            }
                        }
                    )
                } else {
                    // Show current question with header
                    Column(modifier = Modifier.fillMaxSize()) {
                        // Header with generate more button
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "${questions.size} Questions",
                                fontSize = 14.sp,
                                color = TextSecondary
                            )
                            TextButton(
                                onClick = {
                                    aiViewModel.resetState("quiz")
                                    if (authToken != null) {
                                        aiViewModel.generateQuiz(authToken, note.id, language = preferredLanguage)
                                    }
                                }
                            ) {
                                Icon(
                                    Icons.Default.AutoAwesome,
                                    contentDescription = null,
                                    tint = Purple80,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.width(4.dp))
                                Text("Generate More", color = Purple80, fontSize = 14.sp)
                            }
                        }

                        val currentQuestion = questions[currentQuestionIndex]

                        InteractiveQuizQuestion(
                            question = currentQuestion,
                            questionNumber = currentQuestionIndex + 1,
                            totalQuestions = questions.size,
                            selectedAnswer = selectedAnswer,
                            showExplanation = showExplanation,
                            onAnswerSelected = { index ->
                                if (!showExplanation) {
                                    selectedAnswer = index
                                }
                            },
                            onCheckAnswer = {
                                showExplanation = true
                            },
                            onNext = {
                                // Check if answer was correct
                                if (selectedAnswer != null) {
                                    val correctIndex = getCorrectAnswerIndex(currentQuestion.correctAnswer, currentQuestion.options)
                                    if (selectedAnswer == correctIndex) {
                                        score++
                                    }
                                }

                                // Move to next question or complete
                                if (currentQuestionIndex < questions.size - 1) {
                                    currentQuestionIndex++
                                    selectedAnswer = null
                                    showExplanation = false
                                } else {
                                    quizCompleted = true
                                }
                            }
                        )
                    }
                }
            }
            is AIContentState.Error -> {
                ErrorContent(state.message) {
                    if (authToken != null) {
                        aiViewModel.generateQuiz(authToken, note.id, language = preferredLanguage)
                    }
                }
            }
        }
    }
}

/**
 * Parse the correct answer from various formats (e.g., "A", "A)", "0", etc.)
 */
private fun getCorrectAnswerIndex(correctAnswer: String, options: List<String>): Int {
    val trimmed = correctAnswer.trim().uppercase()

    // Try letter format: A, B, C, D
    return when {
        trimmed.startsWith("A") -> 0
        trimmed.startsWith("B") -> 1
        trimmed.startsWith("C") -> 2
        trimmed.startsWith("D") -> 3
        // Try numeric format
        trimmed.toIntOrNull()?.let { it in 0..3 } == true -> trimmed.toInt()
        // Try to find matching option text
        else -> options.indexOfFirst {
            it.contains(correctAnswer, ignoreCase = true)
        }.takeIf { it >= 0 } ?: 0
    }
}

@Composable
fun InteractiveQuizQuestion(
    question: com.kreativekoala.scribeai.data.models.QuizQuestion,
    questionNumber: Int,
    totalQuestions: Int,
    selectedAnswer: Int?,
    showExplanation: Boolean,
    onAnswerSelected: (Int) -> Unit,
    onCheckAnswer: () -> Unit,
    onNext: () -> Unit
) {
    val correctIndex = getCorrectAnswerIndex(question.correctAnswer, question.options)

    Column(modifier = Modifier.fillMaxSize()) {
        // Progress header
        Column(modifier = Modifier.padding(bottom = 16.dp)) {
            Text(
                "Question $questionNumber of $totalQuestions",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = TextSecondary
            )
            Spacer(Modifier.height(8.dp))

            // Progress bar
            LinearProgressIndicator(
                progress = { questionNumber.toFloat() / totalQuestions.toFloat() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp),
                color = Purple80,
                trackColor = DarkSurfaceVariant
            )
        }

        // Scrollable content
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
        ) {
            // Question text
            Text(
                question.question,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
                modifier = Modifier.padding(bottom = 24.dp)
            )

            // Answer options
            question.options.forEachIndexed { index, optionText ->
                QuizOptionButton(
                    text = optionText,
                    index = index,
                    isSelected = selectedAnswer == index,
                    isCorrect = if (showExplanation) index == correctIndex else null,
                    isUserAnswer = showExplanation && selectedAnswer == index,
                    onClick = { onAnswerSelected(index) },
                    enabled = !showExplanation
                )
                Spacer(Modifier.height(12.dp))
            }

            // Explanation
            if (showExplanation && question.explanation.isNotBlank()) {
                Spacer(Modifier.height(16.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = CardBackground),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Default.Lightbulb,
                                contentDescription = null,
                                tint = Purple80,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Explanation",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = TextPrimary
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            question.explanation,
                            fontSize = 14.sp,
                            color = TextSecondary,
                            lineHeight = 20.sp
                        )
                    }
                }
            }

            Spacer(Modifier.height(100.dp)) // Space for button
        }

        // Action button
        if (!showExplanation && selectedAnswer != null) {
            Button(
                onClick = onCheckAnswer,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    "Check Answer",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        } else if (showExplanation) {
            Button(
                onClick = onNext,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (questionNumber < totalQuestions) "Next Question" else "View Results",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.width(8.dp))
                    Icon(Icons.Default.ArrowForward, contentDescription = null)
                }
            }
        }
    }
}

@Composable
fun QuizOptionButton(
    text: String,
    index: Int,
    isSelected: Boolean,
    isCorrect: Boolean?,
    isUserAnswer: Boolean,
    onClick: () -> Unit,
    enabled: Boolean
) {
    val optionLabels = listOf("A", "B", "C", "D")

    val backgroundColor = when {
        isCorrect == true -> AccentGreen.copy(alpha = 0.2f)
        isUserAnswer && isCorrect == false -> AccentRed.copy(alpha = 0.2f)
        isSelected -> Purple80.copy(alpha = 0.2f)
        else -> CardBackground
    }

    val borderColor = when {
        isCorrect == true -> AccentGreen
        isUserAnswer && isCorrect == false -> AccentRed
        isSelected -> Purple80
        else -> DarkSurfaceVariant
    }

    Card(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = backgroundColor),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(2.dp, borderColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Option label (A, B, C, D)
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(DarkSurfaceVariant, RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    optionLabels.getOrElse(index) { "${index + 1}" },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextSecondary
                )
            }

            Spacer(Modifier.width(12.dp))

            // Option text
            Text(
                text,
                fontSize = 15.sp,
                color = TextPrimary,
                modifier = Modifier.weight(1f)
            )

            // Result icon
            if (isCorrect != null) {
                Icon(
                    imageVector = if (isCorrect) Icons.Default.CheckCircle else if (isUserAnswer) Icons.Default.Cancel else Icons.Default.RadioButtonUnchecked,
                    contentDescription = null,
                    tint = if (isCorrect) AccentGreen else if (isUserAnswer) AccentRed else DarkSurfaceVariant,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

@Composable
fun QuizResultsView(
    score: Int,
    total: Int,
    onRestart: () -> Unit,
    onGenerateNew: () -> Unit = {}
) {
    val percentage = if (total > 0) (score * 100) / total else 0

    val message = when {
        percentage >= 90 -> "Outstanding! 🎉"
        percentage >= 70 -> "Great job! 👏"
        percentage >= 50 -> "Good effort! 💪"
        else -> "Keep practicing! 📚"
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            message,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(32.dp))

        // Circular progress indicator
        Box(
            modifier = Modifier.size(150.dp),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(
                progress = { 1f },
                modifier = Modifier.fillMaxSize(),
                color = DarkSurfaceVariant,
                strokeWidth = 12.dp
            )
            CircularProgressIndicator(
                progress = { percentage / 100f },
                modifier = Modifier.fillMaxSize(),
                color = Purple80,
                strokeWidth = 12.dp
            )
            Text(
                "$percentage%",
                fontSize = 40.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
        }

        Spacer(Modifier.height(16.dp))

        Text(
            "$score out of $total correct",
            fontSize = 18.sp,
            color = TextSecondary
        )

        Spacer(Modifier.height(48.dp))

        // Restart same quiz
        Button(
            onClick = onRestart,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp)
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(
                    "Restart Quiz",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Generate new quiz
        OutlinedButton(
            onClick = onGenerateNew,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp)
                .height(56.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Purple80),
            border = androidx.compose.foundation.BorderStroke(2.dp, Purple80),
            shape = RoundedCornerShape(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.AutoAwesome, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(
                    "Generate New Quiz",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
fun FlashcardsTab(
    note: Note,
    aiViewModel: AIViewModel,
    authToken: String?,
    preferredLanguage: String
) {
    val flashcardsState by aiViewModel.flashcardsState.collectAsState()
    var timeElapsed by remember { mutableStateOf(0) }
    var selectedCount by remember { mutableStateOf(10) }

    // Flashcard count options
    val countOptions = listOf(5, 10, 15, 20)

    LaunchedEffect(flashcardsState) {
        if (flashcardsState is AIContentState.Loading) {
            while (true) {
                delay(1000)
                timeElapsed++
            }
        } else {
            timeElapsed = 0
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        when (val state = flashcardsState) {
            is AIContentState.Idle -> {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        Icons.Default.Style,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = Purple80
                    )
                    Spacer(Modifier.height(24.dp))
                    Text(
                        "Generate Flashcards",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Create flashcards for effective studying",
                        fontSize = 14.sp,
                        color = TextSecondary
                    )

                    Spacer(Modifier.height(24.dp))

                    // Count selector
                    Text(
                        "Number of Cards",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        countOptions.forEach { count ->
                            FilterChip(
                                selected = selectedCount == count,
                                onClick = { selectedCount = count },
                                label = { Text("$count") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Purple80,
                                    selectedLabelColor = DarkBackground
                                )
                            )
                        }
                    }

                    Spacer(Modifier.height(32.dp))

                    Button(
                        onClick = {
                            if (authToken != null) {
                                aiViewModel.generateFlashcards(
                                    authToken,
                                    note.id,
                                    numCards = selectedCount,
                                    language = preferredLanguage
                                )
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth(0.8f)
                            .height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Generate $selectedCount Flashcards", fontSize = 16.sp)
                    }
                }
            }
            is AIContentState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Purple80, modifier = Modifier.size(64.dp))
                        Spacer(Modifier.height(24.dp))
                        Text("Generating flashcards...", fontSize = 18.sp, color = TextPrimary)
                        Spacer(Modifier.height(8.dp))
                        Text("This may take 20-40 seconds", fontSize = 14.sp, color = TextSecondary)
                        Spacer(Modifier.height(16.dp))
                        Text("${timeElapsed}s elapsed", fontSize = 12.sp, color = TextTertiary)
                    }
                }
            }
            is AIContentState.Success -> {
                val flashcards = state.content.flashcards
                if (flashcards.isNullOrEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("No flashcards generated", color = TextSecondary)
                    }
                } else {
                    Column(modifier = Modifier.fillMaxSize()) {
                        // Flashcard count header
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "${flashcards.size} Flashcards",
                                fontSize = 14.sp,
                                color = TextSecondary
                            )
                            TextButton(
                                onClick = {
                                    aiViewModel.resetState("flashcards")
                                    if (authToken != null) {
                                        aiViewModel.generateFlashcards(authToken, note.id, language = preferredLanguage)
                                    }
                                }
                            ) {
                                Icon(
                                    Icons.Default.AutoAwesome,
                                    contentDescription = null,
                                    tint = Purple80,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.width(4.dp))
                                Text("Generate More", color = Purple80, fontSize = 14.sp)
                            }
                        }

                        // Scrollable flashcards
                        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                            flashcards.forEachIndexed { index, card ->
                                FlashcardItem(index + 1, card.front, card.back)
                                Spacer(Modifier.height(12.dp))
                            }
                        }
                    }
                }
            }
            is AIContentState.Error -> {
                ErrorContent(state.message) {
                    if (authToken != null) {
                        aiViewModel.generateFlashcards(authToken, note.id, language = preferredLanguage)
                    }
                }
            }
        }
    }
}

@Composable
fun GenerateContentPrompt(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    onGenerate: () -> Unit
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = Purple80
            )
            Spacer(Modifier.height(24.dp))
            Text(
                title,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )
            Spacer(Modifier.height(8.dp))
            Text(
                description,
                fontSize = 14.sp,
                color = TextSecondary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(Modifier.height(32.dp))
            Button(
                onClick = onGenerate,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Purple80
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.height(48.dp)
            ) {
                Icon(Icons.Default.AutoAwesome, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Generate", fontSize = 16.sp)
            }
        }
    }
}

@Composable
fun LoadingContent(message: String) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Purple80)
            Spacer(Modifier.height(16.dp))
            Text(message, color = TextSecondary)
        }
    }
}

@Composable
fun ErrorContent(message: String, onRetry: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.Error,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = AccentRed
            )
            Spacer(Modifier.height(16.dp))
            Text(message, color = TextSecondary)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry) {
                Text("Retry")
            }
        }
    }
}

// Duration option card for podcast
@Composable
private fun DurationOptionCard(
    option: DurationOption,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) Purple80.copy(alpha = 0.15f) else CardBackground
        ),
        shape = RoundedCornerShape(12.dp),
        border = if (isSelected) androidx.compose.foundation.BorderStroke(2.dp, Purple80) else null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                option.label,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (isSelected) Purple80 else TextPrimary
            )
            Spacer(Modifier.height(4.dp))
            Text(
                option.description,
                fontSize = 12.sp,
                color = TextSecondary
            )
        }
    }
}

// Voice option card for podcast
@Composable
private fun VoiceOptionCard(
    voice: PodcastVoice,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) Purple80.copy(alpha = 0.15f) else CardBackground
        ),
        shape = RoundedCornerShape(12.dp),
        border = if (isSelected) androidx.compose.foundation.BorderStroke(2.dp, Purple80) else null
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                voice.icon,
                contentDescription = null,
                tint = if (isSelected) Purple80 else TextSecondary,
                modifier = Modifier.size(20.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                voice.displayName,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (isSelected) Purple80 else TextPrimary
            )
        }
    }
}

@Composable
fun FlashcardItem(number: Int, front: String, back: String) {
    var flipped by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (flipped) Purple80.copy(alpha = 0.2f) else CardBackground
        ),
        shape = RoundedCornerShape(12.dp),
        onClick = { flipped = !flipped }
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (flipped) "Answer" else "Question",
                    fontSize = 12.sp,
                    color = if (flipped) Purple80 else TextTertiary
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    if (flipped) back else front,
                    fontSize = 16.sp,
                    color = TextPrimary,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
    }
}