package com.kreativekoala.scribeai.ui.screens

import android.util.Log
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import android.content.Context
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.data.models.Note
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.viewmodel.NoteUiState
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import java.text.SimpleDateFormat
import java.util.*
import com.kreativekoala.scribeai.utils.SubscriptionManager
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: NoteViewModel,
    authManager: AuthManager,
    subscriptionManager: SubscriptionManager,
    onNoteClick: (Note) -> Unit,
    onRecordAudio: () -> Unit,
    onYouTube: () -> Unit,
    onUploadDocument: () -> Unit,
    onScanDocument: () -> Unit,
    onDebugToken: () -> Unit = {},
    onSignOut: () -> Unit = {}
) {
    var showCreateSheet by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var showPaywall by remember { mutableStateOf(false) }
    var showSignOutDialog by remember { mutableStateOf(false) }  // NEW: Sign out confirmation
    var showLanguageDialog by remember { mutableStateOf(false) }


    val context = LocalContext.current  // NEW: For Toast
    val sharedPrefs = context.getSharedPreferences("scribe_prefs", Context.MODE_PRIVATE)
    var selectedLanguage by remember { mutableStateOf(sharedPrefs.getString("preferred_language", "english") ?: "english") }

    // Get auth token
    val authToken by authManager.authToken.collectAsState(initial = null)

    // Observe states
    val uiState by viewModel.uiState.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val shouldShowPaywall by viewModel.shouldShowPaywall.collectAsState()
    val subscriptionState by subscriptionManager.subscriptionState.collectAsState()

    val coroutineScope = rememberCoroutineScope()

    // Get lifetime notebook count and subscription status
    var lifetimeNotebooks by remember { mutableStateOf(subscriptionManager.getLifetimeNotebooksCreated()) }
    var isSubscribed by remember { mutableStateOf(false) }

    // Refresh lifetime count when returning to this screen
    LaunchedEffect(Unit) {
        lifetimeNotebooks = subscriptionManager.getLifetimeNotebooksCreated()
    }

    LaunchedEffect(subscriptionState) {
        isSubscribed = subscriptionState is SubscriptionManager.SubscriptionState.Subscribed
    }

    LaunchedEffect(Unit) {
        Log.d("HomeScreen", "🔵 LaunchedEffect(Unit) triggered - loading notes")
        val token = authManager.getCurrentToken()
        Log.d("HomeScreen", "🔵 Token retrieved: ${token?.take(20)}...")
        if (token != null) {
            viewModel.loadNotes(token, forceRefresh = true)
        }
    }

   // DEBUG: Track when authToken changes (but don't load notes here!)
    LaunchedEffect(authToken) {
        Log.d("HomeScreen", "🟡 authToken changed: ${authToken?.take(20)}...")
    }

    // Show paywall when triggered by ViewModel
    LaunchedEffect(shouldShowPaywall) {
        showPaywall = shouldShowPaywall
    }

    LaunchedEffect(Unit) {
        try {
            Log.d("HomeScreen", "=== HomeScreen Starting ===")
            Log.d("HomeScreen", "AuthManager OK: ${authManager != null}")
            Log.d("HomeScreen", "SubscriptionManager OK: ${subscriptionManager != null}")
            Log.d("HomeScreen", "ViewModel OK: ${viewModel != null}")

            val token = authManager.authToken.value
            Log.d("HomeScreen", "Token exists: ${token != null}")

            val subState = subscriptionManager.subscriptionState.value
            Log.d("HomeScreen", "Subscription state: $subState")
            Log.d("HomeScreen", "Lifetime notebooks: $lifetimeNotebooks")
            Log.d("HomeScreen", "Can create: ${subscriptionManager.canCreateNotebook()}")

            Log.d("HomeScreen", "=== All checks passed ===")
        } catch (e: Exception) {
            Log.e("HomeScreen", "CRASH CAUGHT IN DIAGNOSTIC", e)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = null,
                            modifier = Modifier.size(24.dp),
                            tint = Purple80
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            "SCRIBE AI",  // FIXED: Capitalized
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                },
                actions = {
                    // Subscription badge
                    if (isSubscribed) {
                        Surface(
                            color = Purple80,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.padding(end = 8.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.Default.Star,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = Color.White
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "PRO",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }
                        }
                    }

                    // Menu button with dropdown
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "Menu")
                    }

                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        if (!isSubscribed) {
                            DropdownMenuItem(
                                text = { Text("Upgrade to Pro") },
                                onClick = {
                                    showMenu = false
                                    showPaywall = true
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Star, contentDescription = null, tint = Purple80)
                                }
                            )
                            HorizontalDivider()
                        }

                        DropdownMenuItem(
                            text = { Text("Language") },
                            onClick = {
                                showMenu = false
                                showLanguageDialog = true
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Language, contentDescription = null, tint = Purple80)
                            }
                        )
                        HorizontalDivider()

                        DropdownMenuItem(
                            text = { Text("Sign Out") },
                            onClick = {
                                showMenu = false
                                showSignOutDialog = true  // FIXED: Show confirmation instead of direct sign out
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Logout, contentDescription = null)
                            }
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkBackground,
                    titleContentColor = TextPrimary
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    if (authToken != null) {
                        if (subscriptionManager.canCreateNotebook()) {
                            showCreateSheet = true
                        } else {
                            showPaywall = true
                        }
                    }
                },
                containerColor = Purple80,
                contentColor = Color.White,
                shape = CircleShape,
                modifier = Modifier.size(64.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "Add",
                    modifier = Modifier.size(32.dp)
                )
            }
        },
        containerColor = DarkBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Header with usage info
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        "Home",
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

                    // Show usage for free users (based on lifetime count)
                    if (!isSubscribed) {
                        Spacer(Modifier.height(4.dp))
                        val remaining = subscriptionManager.getRemainingFreeNotebooks()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "$lifetimeNotebooks / ${SubscriptionManager.FREE_NOTEBOOK_LIMIT} free notebooks used",
                                fontSize = 13.sp,
                                color = if (remaining == 0) AccentRed else TextSecondary
                            )
                            if (remaining == 0) {
                                Spacer(Modifier.width(8.dp))
                                TextButton(
                                    onClick = { showPaywall = true },
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                                ) {
                                    Text(
                                        "Upgrade",
                                        fontSize = 12.sp,
                                        color = Purple80
                                    )
                                }
                            }
                        }
                    }
                }

                // FIXED: New Folder button now shows "Coming Soon" toast
                OutlinedButton(
                    onClick = {
                        Toast.makeText(context, "Folders coming soon!", Toast.LENGTH_SHORT).show()
                    },
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Purple80
                    )
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("New Folder")
                }
            }

            // Notes List
            when (val state = uiState) {
                is NoteUiState.Loading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = Purple80)
                    }
                }

                is NoteUiState.Success -> {
                    if (state.notes.isEmpty()) {
                        // Empty state
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                                modifier = Modifier.padding(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Note,
                                    contentDescription = null,
                                    modifier = Modifier.size(64.dp),
                                    tint = TextTertiary
                                )
                                Spacer(Modifier.height(16.dp))
                                Text(
                                    "No notes yet",
                                    fontSize = 18.sp,
                                    color = TextSecondary
                                )
                                Text(
                                    "Tap + to create your first note",
                                    fontSize = 14.sp,
                                    color = TextTertiary
                                )

                                if (!isSubscribed) {
                                    Spacer(Modifier.height(24.dp))
                                    val remaining = subscriptionManager.getRemainingFreeNotebooks()
                                    Card(
                                        colors = CardDefaults.cardColors(
                                            containerColor = Purple80.copy(alpha = 0.1f)
                                        )
                                    ) {
                                        Column(
                                            modifier = Modifier.padding(16.dp),
                                            horizontalAlignment = Alignment.CenterHorizontally
                                        ) {
                                            Icon(
                                                Icons.Default.Info,
                                                contentDescription = null,
                                                tint = Purple80,
                                                modifier = Modifier.size(20.dp)
                                            )
                                            Spacer(Modifier.height(8.dp))
                                            Text(
                                                if (remaining > 0)
                                                    "You can create $remaining free notebook${if (remaining > 1) "s" else ""}"
                                                else
                                                    "Upgrade to create unlimited notebooks",
                                                fontSize = 13.sp,
                                                color = TextSecondary,
                                                textAlign = TextAlign.Center
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // Pull to refresh
                        val pullRefreshState = rememberPullToRefreshState()
                        val isLoadingMore by viewModel.isLoadingMore.collectAsState()

                        Box(modifier = Modifier.fillMaxSize()) {
                            LazyColumn(
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                // Notes count header
                                if (state.totalNotes > 0) {
                                    item {
                                        Text(
                                            "${state.notes.size} of ${state.totalNotes} notes",
                                            fontSize = 13.sp,
                                            color = TextSecondary,
                                            modifier = Modifier.padding(bottom = 4.dp)
                                        )
                                    }
                                }

                                items(state.notes) { note ->
                                    NoteCard(
                                        note = note,
                                        onClick = { onNoteClick(note) },
                                        onDelete = { noteToDelete ->
                                            if (authToken != null) {
                                                viewModel.deleteNote(
                                                    token = authToken!!,
                                                    noteId = noteToDelete.id,
                                                    onSuccess = {
                                                        Log.d("HomeScreen", "Note deleted")
                                                    },
                                                    onError = { error ->
                                                        Log.e("HomeScreen", "Delete failed: $error")
                                                    }
                                                )
                                            }
                                        }
                                    )
                                }

                                // Load More button
                                if (state.hasMoreNotes) {
                                    item {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(vertical = 16.dp),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            if (isLoadingMore) {
                                                CircularProgressIndicator(
                                                    modifier = Modifier.size(32.dp),
                                                    color = Purple80,
                                                    strokeWidth = 2.dp
                                                )
                                            } else {
                                                OutlinedButton(
                                                    onClick = {
                                                        if (authToken != null) {
                                                            viewModel.loadMoreNotes(authToken!!)
                                                        }
                                                    },
                                                    colors = ButtonDefaults.outlinedButtonColors(
                                                        contentColor = Purple80
                                                    )
                                                ) {
                                                    Icon(
                                                        Icons.Default.KeyboardArrowDown,
                                                        contentDescription = null,
                                                        modifier = Modifier.size(18.dp)
                                                    )
                                                    Spacer(Modifier.width(8.dp))
                                                    Text("Load More Notes")
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Pull to refresh indicator
                            if (isRefreshing) {
                                LinearProgressIndicator(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .align(Alignment.TopCenter),
                                    color = Purple80
                                )
                            }
                        }
                    }
                }

                is NoteUiState.Error -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(16.dp)
                        ) {
                            Icon(
                                Icons.Default.Error,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = AccentRed
                            )
                            Spacer(Modifier.height(16.dp))
                            Text(
                                "Error loading notes",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Medium,
                                color = TextPrimary
                            )
                            Text(
                                state.message,
                                fontSize = 14.sp,
                                color = TextSecondary,
                                modifier = Modifier.padding(top = 8.dp)
                            )
                            Spacer(Modifier.height(16.dp))
                            Button(
                                onClick = {
                                    if (authToken != null) {
                                        viewModel.loadNotes(authToken!!)
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
        }
    }

    // FIXED: Create Options Bottom Sheet - NO premature increment
    if (showCreateSheet) {
        CreateOptionsBottomSheet(
            onDismiss = { showCreateSheet = false },
            onRecordAudio = {
                showCreateSheet = false
                onRecordAudio()
            },
            onYouTube = {
                showCreateSheet = false
                onYouTube()
            },
            onUploadDocument = {
                showCreateSheet = false
                onUploadDocument()
            },
            onScanDocument = {
                showCreateSheet = false
                onScanDocument()
            }
        )
    }

    // Paywall
    if (showPaywall) {
        PaywallScreen(
            subscriptionManager = subscriptionManager,
            onDismiss = {
                showPaywall = false
                viewModel.dismissPaywall()
            },
            onSubscribe = {
                showPaywall = false
                viewModel.dismissPaywall()
                // Reload subscription state
                subscriptionManager.checkExistingSubscriptions()
            }
        )
    }

    // NEW: Sign Out Confirmation Dialog
    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            icon = {
                Icon(
                    Icons.Default.Logout,
                    contentDescription = null,
                    tint = AccentRed
                )
            },
            title = {
                Text("Sign Out?")
            },
            text = {
                Text("Are you sure you want to sign out of your account?")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showSignOutDialog = false
                        onSignOut()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AccentRed
                    )
                ) {
                    Text("Sign Out")
                }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Language Selection Dialog
    if (showLanguageDialog) {
        val languages = listOf(
            // Major World Languages
            "english" to "English",
            "spanish" to "Spanish",
            "french" to "French",
            "german" to "German",
            "portuguese" to "Portuguese",
            "italian" to "Italian",
            "chinese" to "Chinese (Simplified)",
            "chinese_traditional" to "Chinese (Traditional)",
            "japanese" to "Japanese",
            "korean" to "Korean",
            // South Asian Languages
            "hindi" to "Hindi",
            "bengali" to "Bengali",
            "tamil" to "Tamil",
            "telugu" to "Telugu",
            "urdu" to "Urdu",
            "marathi" to "Marathi",
            "gujarati" to "Gujarati",
            "punjabi" to "Punjabi",
            // European Languages
            "dutch" to "Dutch",
            "polish" to "Polish",
            "russian" to "Russian",
            "ukrainian" to "Ukrainian",
            "swedish" to "Swedish",
            "norwegian" to "Norwegian",
            "danish" to "Danish",
            "finnish" to "Finnish",
            "greek" to "Greek",
            "czech" to "Czech",
            "romanian" to "Romanian",
            "hungarian" to "Hungarian",
            // Middle Eastern & African Languages
            "arabic" to "Arabic",
            "hebrew" to "Hebrew",
            "turkish" to "Turkish",
            "persian" to "Persian (Farsi)",
            "swahili" to "Swahili",
            // Southeast Asian Languages
            "thai" to "Thai",
            "vietnamese" to "Vietnamese",
            "indonesian" to "Indonesian",
            "malay" to "Malay",
            "tagalog" to "Filipino (Tagalog)"
        )
        var tempLanguage by remember { mutableStateOf(selectedLanguage) }

        AlertDialog(
            onDismissRequest = { showLanguageDialog = false },
            icon = {
                Icon(
                    Icons.Default.Language,
                    contentDescription = null,
                    tint = Purple80
                )
            },
            title = {
                Text("Select Language")
            },
            text = {
                Column(modifier = Modifier.heightIn(max = 400.dp)) {
                    Text(
                        "AI-generated content will be in this language",
                        fontSize = 14.sp,
                        color = TextSecondary,
                        modifier = Modifier.padding(bottom = 16.dp)
                    )
                    LazyColumn {
                        items(languages) { (code, name) ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(
                                    selected = tempLanguage == code,
                                    onClick = { tempLanguage = code },
                                    colors = RadioButtonDefaults.colors(
                                        selectedColor = Purple80
                                    )
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    name,
                                    fontSize = 16.sp,
                                    color = TextPrimary
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        selectedLanguage = tempLanguage
                        sharedPrefs.edit().putString("preferred_language", tempLanguage).apply()
                        showLanguageDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Purple80)
                ) {
                    Text("OK")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLanguageDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
fun NoteCard(
    note: Note,
    onClick: () -> Unit,
    onDelete: (Note) -> Unit = {}
) {
    var showMenu by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = CardBackground
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Icon
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Purple80.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = when(note.sourceType) {
                        "recording" -> Icons.Default.Mic
                        "video" -> Icons.Default.VideoLibrary
                        "pdf" -> Icons.Default.Description
                        "scan" -> Icons.Default.CameraAlt
                        else -> Icons.Default.Note
                    },
                    contentDescription = null,
                    tint = Purple80,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(Modifier.width(12.dp))

            // Content
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    note.title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    formatDate(note.createdAt),
                    fontSize = 12.sp,
                    color = TextSecondary
                )
            }

            // More options with dropdown menu
            Box {
                IconButton(
                    onClick = { showMenu = true }
                ) {
                    Icon(
                        Icons.Default.MoreVert,
                        contentDescription = "More",
                        tint = TextSecondary
                    )
                }

                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        onClick = {
                            showMenu = false
                            showDeleteDialog = true
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = null,
                                tint = AccentRed
                            )
                        },
                        colors = MenuDefaults.itemColors(
                            textColor = AccentRed
                        )
                    )
                }
            }
        }
    }

    // Delete confirmation dialog
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            icon = {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = null,
                    tint = AccentRed
                )
            },
            title = {
                Text("Delete Note?")
            },
            text = {
                Text("Are you sure you want to delete \"${note.title}\"? This action cannot be undone.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteDialog = false
                        onDelete(note)
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AccentRed
                    )
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateOptionsBottomSheet(
    onDismiss: () -> Unit,
    onRecordAudio: () -> Unit,
    onYouTube: () -> Unit,
    onUploadDocument: () -> Unit,
    onScanDocument: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        contentColor = TextPrimary
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            CreateOption(
                icon = Icons.Default.Mic,
                title = "Record or upload audio",
                onClick = onRecordAudio
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.VideoLibrary,
                title = "YouTube video",
                onClick = onYouTube
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.Description,
                title = "Upload document",
                subtitle = "Any PDF, DOCX, PPT, TXT, etc!",
                onClick = onUploadDocument
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.CameraAlt,  // FIXED: Changed from Description to CameraAlt
                title = "Scan Text",  // FIXED: Capitalized properly
                subtitle = "Any image with text",
                onClick = onScanDocument
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun CreateOption(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = DarkSurfaceVariant
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        when(icon) {
                            Icons.Default.Mic -> Purple80.copy(alpha = 0.2f)
                            Icons.Default.VideoLibrary -> AccentRed.copy(alpha = 0.2f)
                            Icons.Default.CameraAlt -> Color(0xFF4CAF50).copy(alpha = 0.2f)  // Green for scan
                            else -> AccentBlue.copy(alpha = 0.2f)
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = when(icon) {
                        Icons.Default.Mic -> Purple80
                        Icons.Default.VideoLibrary -> AccentRed
                        Icons.Default.CameraAlt -> Color(0xFF4CAF50)  // Green for scan
                        else -> AccentBlue
                    },
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium,
                    color = TextPrimary
                )
                if (subtitle != null) {
                    Text(
                        subtitle,
                        fontSize = 12.sp,
                        color = TextSecondary
                    )
                }
            }

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = TextTertiary
            )
        }
    }
}

fun formatDate(dateString: String): String {
    return try {
        val inputFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val outputFormat = SimpleDateFormat("MMM d", Locale.getDefault())
        val date = inputFormat.parse(dateString)
        outputFormat.format(date ?: Date())
    } catch (e: Exception) {
        dateString
    }
}