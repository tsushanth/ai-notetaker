package com.kreativekoala.scribeai.ui.screens

import android.util.Log
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import android.content.Context
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.DeletionReason
import com.kreativekoala.scribeai.data.models.Note
import com.kreativekoala.scribeai.data.models.UserStats
import com.kreativekoala.scribeai.ui.components.DeleteAccountRetentionDialog
import com.kreativekoala.scribeai.ui.components.SignOutRetentionDialog
import com.kreativekoala.scribeai.ui.components.ThemeSelectionDialog
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.viewmodel.NoteUiState
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import java.text.SimpleDateFormat
import java.util.*
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallPreview
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
    onMeetings: () -> Unit = {},
    onPhone: () -> Unit = {},
    onDebugToken: () -> Unit = {},
    onSignOut: () -> Unit = {}
) {
    var showCreateSheet by remember { mutableStateOf(false) }
    var showPaywall by remember { mutableStateOf(false) }
    // Distinguishes the soft upsell (user tapped "Upgrade to Pro") from the
    // hard gate (user hit the free notebook limit). Hard-gate hides the close
    // button + blocks back so the user must convert or background the app.
    var paywallIsHardGate by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var showSignOutDialog by remember { mutableStateOf(false) }
    var showDeleteAccountDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var showThemeDialog by remember { mutableStateOf(false) }
    var tapCount by remember { mutableIntStateOf(0) }
    var showPaywallPreview by remember { mutableStateOf(false) }

    // Retention dialog state
    var userStats by remember { mutableStateOf<UserStats?>(null) }
    var isLoadingStats by remember { mutableStateOf(false) }
    var isDeletingAccount by remember { mutableStateOf(false) }


    val context = LocalContext.current  // NEW: For Toast
    val sharedPrefs = context.getSharedPreferences("scribe_prefs", Context.MODE_PRIVATE)
    var selectedLanguage by remember { mutableStateOf(sharedPrefs.getString("preferred_language", "english") ?: "english") }

    // Get auth token
    val authToken by authManager.authToken.collectAsState(initial = null)

    // Observe states
    val uiState by viewModel.uiState.collectAsState()
    val isRefreshing by viewModel.isRefreshing.collectAsState()
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

    // Load notes when screen appears - use getFreshToken for network calls
    LaunchedEffect(Unit) {
        Log.d("HomeScreen", "🔵 LaunchedEffect(Unit) triggered - loading notes")
        val token = authManager.getFreshToken()
        Log.d("HomeScreen", "🔵 Token retrieved: ${token?.take(20)}...")
        if (token != null) {
            viewModel.loadNotes(token, forceRefresh = true)
        } else {
            Log.e("HomeScreen", "❌ No token available for loading notes")
        }
    }

   // DEBUG: Track when authToken changes (but don't load notes here!)
    LaunchedEffect(authToken) {
        Log.d("HomeScreen", "🟡 authToken changed: ${authToken?.take(20)}...")
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

    if (showPaywallPreview) {
        PaywallPreview(
            appId = "scribeai",
            appName = "ScribeAI",
            features = listOf(
                PaywallFeature("\uD83D\uDCDD", "Unlimited Notes"),
                PaywallFeature("\uD83C\uDFA4", "Transcription"),
                PaywallFeature("\uD83E\uDD16", "AI Summaries"),
                PaywallFeature("\uD83D\uDCC1", "Organization"),
                PaywallFeature("☁\uFE0F", "Cloud Sync")
            ),
            theme = PaywallTheme(accent = Color(0xFF6C63FF), accent2 = Color(0xFF9C27B0)),
            onDone = { showPaywallPreview = false }
        )
        return
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
                            stringResource(R.string.app_title),
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                },
                actions = {
                    // Menu button with dropdown
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.menu))
                    }

                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        if (!isSubscribed) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.menu_upgrade_pro), color = Purple80, fontWeight = FontWeight.SemiBold) },
                                onClick = {
                                    showMenu = false
                                    paywallIsHardGate = false
                                    showPaywall = true
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Star, contentDescription = null, tint = Purple80)
                                }
                            )
                            HorizontalDivider()
                        } else {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.menu_manage_subscription)) },
                                onClick = {
                                    showMenu = false
                                    paywallIsHardGate = false
                                    showPaywall = true
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.WorkspacePremium, contentDescription = null, tint = Purple80)
                                }
                            )
                            HorizontalDivider()
                        }
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.menu_language)) },
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
                            text = { Text(stringResource(R.string.menu_appearance)) },
                            onClick = {
                                showMenu = false
                                showThemeDialog = true
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Palette, contentDescription = null, tint = Purple80)
                            }
                        )
                        HorizontalDivider()

                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.menu_sign_out)) },
                            onClick = {
                                showMenu = false
                                // Load stats and show retention dialog
                                coroutineScope.launch {
                                    loadUserStats(authToken) { stats ->
                                        userStats = stats
                                    }
                                }
                                showSignOutDialog = true
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Logout, contentDescription = null)
                            }
                        )
                        HorizontalDivider()

                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.menu_delete_account), color = AccentRed) },
                            onClick = {
                                showMenu = false
                                // Load stats and show retention dialog
                                coroutineScope.launch {
                                    loadUserStats(authToken) { stats ->
                                        userStats = stats
                                    }
                                }
                                showDeleteAccountDialog = true
                            },
                            leadingIcon = {
                                Icon(Icons.Default.DeleteForever, contentDescription = null, tint = AccentRed)
                            }
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("v1.0.0", color = Color.Gray) },
                            onClick = {
                                tapCount++
                                if (tapCount >= 5) {
                                    showMenu = false
                                    showPaywallPreview = true
                                }
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Info, contentDescription = null, tint = Color.Gray)
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
                            // Hard gate — user has hit the free notebook limit.
                            // Block dismissal so they must convert or background.
                            paywallIsHardGate = true
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
                    contentDescription = stringResource(R.string.add),
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
                        stringResource(R.string.home),
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

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
                                    stringResource(R.string.no_notes_yet),
                                    fontSize = 18.sp,
                                    color = TextSecondary
                                )
                                Text(
                                    stringResource(R.string.tap_to_create_first_note),
                                    fontSize = 14.sp,
                                    color = TextTertiary
                                )

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
                                            stringResource(R.string.notes_count_format, state.notes.size, state.totalNotes),
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
                                        },
                                        onEditTitle = { updatedNote ->
                                            if (authToken != null) {
                                                viewModel.updateNoteTitle(
                                                    token = authToken!!,
                                                    noteId = updatedNote.id,
                                                    newTitle = updatedNote.title,
                                                    onSuccess = {
                                                        Log.d("HomeScreen", "Note title updated")
                                                        viewModel.loadNotes(authToken!!)
                                                    },
                                                    onError = { error ->
                                                        Log.e("HomeScreen", "Update failed: $error")
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
                                                    Text(stringResource(R.string.load_more_notes))
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
                                stringResource(R.string.error_loading_notes),
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
                                Text(stringResource(R.string.retry))
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
            },
            onMeetings = {
                showCreateSheet = false
                onMeetings()
            },
            onPhone = {
                showCreateSheet = false
                onPhone()
            }
        )
    }

    if (showPaywall) {
        PaywallScreen(
            subscriptionManager = subscriptionManager,
            onDismiss = {
                // Only honor dismiss for soft upsells. Hard-gate dismiss is a no-op
                // (the BackHandler inside PaywallScreen swallows back too).
                if (!paywallIsHardGate) showPaywall = false
            },
            onSubscribe = {
                showPaywall = false
                paywallIsHardGate = false
            },
            dismissable = !paywallIsHardGate
        )
    }

    // Sign Out Retention Dialog
    if (showSignOutDialog) {
        SignOutRetentionDialog(
            stats = userStats,
            isLoading = isLoadingStats,
            onDismiss = { showSignOutDialog = false },
            onStaySignedIn = { showSignOutDialog = false },
            onSignOut = {
                showSignOutDialog = false
                onSignOut()
            }
        )
    }

    // Delete Account Retention Dialog
    if (showDeleteAccountDialog) {
        DeleteAccountRetentionDialog(
            stats = userStats,
            isLoading = isLoadingStats,
            isDeleting = isDeletingAccount,
            onDismiss = { showDeleteAccountDialog = false },
            onKeepAccount = { showDeleteAccountDialog = false },
            onDelete = { reason ->
                isDeletingAccount = true
                coroutineScope.launch {
                    try {
                        // TODO: Call delete account API when backend supports it
                        // For now, just sign out after collecting reason
                        Log.d("HomeScreen", "Delete account reason: ${reason.name}")
                        isDeletingAccount = false
                        showDeleteAccountDialog = false
                        Toast.makeText(context, context.getString(R.string.account_deletion_requested), Toast.LENGTH_LONG).show()
                        onSignOut()
                    } catch (e: Exception) {
                        Log.e("HomeScreen", "Delete account failed", e)
                        isDeletingAccount = false
                        Toast.makeText(context, context.getString(R.string.error_delete_account, e.message ?: ""), Toast.LENGTH_SHORT).show()
                    }
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
                Text(stringResource(R.string.select_language))
            },
            text = {
                Column(modifier = Modifier.heightIn(max = 400.dp)) {
                    Text(
                        stringResource(R.string.language_subtitle),
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
                    Text(stringResource(R.string.ok))
                }
            },
            dismissButton = {
                TextButton(onClick = { showLanguageDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    // Theme Selection Dialog
    if (showThemeDialog) {
        ThemeSelectionDialog(
            onDismiss = { showThemeDialog = false }
        )
    }
}

@Composable
fun NoteCard(
    note: Note,
    onClick: () -> Unit,
    onDelete: (Note) -> Unit = {},
    onEditTitle: (Note) -> Unit = {}
) {
    var showMenu by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showEditTitleDialog by remember { mutableStateOf(false) }
    var editedTitle by remember { mutableStateOf(note.title) }

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
                        contentDescription = stringResource(R.string.more),
                        tint = TextSecondary
                    )
                }

                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.edit_title)) },
                        onClick = {
                            showMenu = false
                            editedTitle = note.title
                            showEditTitleDialog = true
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Edit,
                                contentDescription = null,
                                tint = TextSecondary
                            )
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.delete)) },
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
                Text(stringResource(R.string.delete_note))
            },
            text = {
                Text(stringResource(R.string.delete_note_message, note.title))
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
                    Text(stringResource(R.string.delete))
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    // Edit title dialog
    if (showEditTitleDialog) {
        AlertDialog(
            onDismissRequest = { showEditTitleDialog = false },
            icon = {
                Icon(
                    Icons.Default.Edit,
                    contentDescription = null,
                    tint = Purple80
                )
            },
            title = {
                Text(stringResource(R.string.edit_title))
            },
            text = {
                OutlinedTextField(
                    value = editedTitle,
                    onValueChange = { editedTitle = it },
                    label = { Text(stringResource(R.string.label_title)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showEditTitleDialog = false
                        onEditTitle(note.copy(title = editedTitle))
                    },
                    enabled = editedTitle.isNotBlank() && editedTitle != note.title
                ) {
                    Text(stringResource(R.string.save))
                }
            },
            dismissButton = {
                TextButton(onClick = { showEditTitleDialog = false }) {
                    Text(stringResource(R.string.cancel))
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
    onScanDocument: () -> Unit,
    onMeetings: () -> Unit = {},
    onPhone: () -> Unit = {}
) {
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = DarkSurface,
        contentColor = TextPrimary
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 16.dp)
        ) {
            CreateOption(
                icon = Icons.Default.Mic,
                title = stringResource(R.string.record_or_upload),
                onClick = onRecordAudio
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.VideoLibrary,
                title = stringResource(R.string.youtube_video),
                onClick = onYouTube
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.Description,
                title = stringResource(R.string.upload_document),
                subtitle = stringResource(R.string.upload_document_subtitle),
                onClick = onUploadDocument
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.CameraAlt,
                title = stringResource(R.string.scan_text),
                subtitle = stringResource(R.string.scan_text_subtitle),
                onClick = onScanDocument
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.Videocam,
                title = stringResource(R.string.join_meeting),
                subtitle = stringResource(R.string.join_meeting_subtitle),
                onClick = onMeetings
            )
            Spacer(Modifier.height(12.dp))
            CreateOption(
                icon = Icons.Default.Phone,
                title = "Phone Call",
                subtitle = "Place a recorded call, transcript saved to your notes",
                onClick = onPhone
            )
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
                            Icons.Default.CameraAlt -> Color(0xFF4CAF50).copy(alpha = 0.2f)
                            Icons.Default.Videocam -> Color(0xFF2196F3).copy(alpha = 0.2f)
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
                        Icons.Default.CameraAlt -> Color(0xFF4CAF50)
                        Icons.Default.Videocam -> Color(0xFF2196F3)
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

/**
 * Load user stats for retention dialogs
 */
private suspend fun loadUserStats(token: String?, onResult: (UserStats?) -> Unit) {
    if (token == null) {
        onResult(null)
        return
    }

    try {
        val response = RetrofitClient.apiService.getUserStats("Bearer $token")
        if (response.isSuccessful && response.body()?.success == true) {
            onResult(response.body()?.data)
        } else {
            Log.e("HomeScreen", "Failed to load user stats: ${response.errorBody()?.string()}")
            onResult(null)
        }
    } catch (e: Exception) {
        Log.e("HomeScreen", "Error loading user stats", e)
        onResult(null)
    }
}

