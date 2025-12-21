package com.kreativekoala.scribeai.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.kreativekoala.scribeai.utils.AuthManager

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DebugTokenScreen(
    authManager: AuthManager,
    onNavigateBack: () -> Unit = {}
) {
    val authToken by authManager.authToken.collectAsState(initial = null)
    val userId by authManager.userId.collectAsState(initial = null)
    val context = LocalContext.current

    fun isValidJWT(token: String?): Boolean {
        if (token == null) return false
        val parts = token.split(".")
        return parts.size == 3 && parts.all { it.isNotEmpty() }
    }

    val tokenParts = authToken?.split(".") ?: emptyList()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Debug Token") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Token Debug Information", style = MaterialTheme.typography.headlineSmall)

            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Has Token: ${authToken != null}", style = MaterialTheme.typography.bodyMedium)
                    Text("Token Length: ${authToken?.length ?: 0}", style = MaterialTheme.typography.bodyMedium)
                    Text("Token Parts: ${tokenParts.size}", style = MaterialTheme.typography.bodyMedium)
                    Text("Is Valid JWT: ${isValidJWT(authToken)}", style = MaterialTheme.typography.bodyMedium)

                    if (tokenParts.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text("Part 1 Length: ${tokenParts.getOrNull(0)?.length ?: 0}", style = MaterialTheme.typography.bodySmall)
                        Text("Part 2 Length: ${tokenParts.getOrNull(1)?.length ?: 0}", style = MaterialTheme.typography.bodySmall)
                        Text("Part 3 Length: ${tokenParts.getOrNull(2)?.length ?: 0}", style = MaterialTheme.typography.bodySmall)
                    }

                    Spacer(Modifier.height(8.dp))
                    Text("User ID: ${userId ?: "None"}", style = MaterialTheme.typography.bodyMedium)
                }
            }

            if (authToken != null) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Token Preview (first 100 chars):", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            authToken!!.take(100) + "...",
                            style = MaterialTheme.typography.bodySmall
                        )

                        Spacer(Modifier.height(8.dp))
                        Text("Bearer Header:", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            authManager.getAuthHeader(authToken!!).take(100) + "...",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                if (tokenParts.size == 3) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer
                        )
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                "✅ Token is valid JWT format!",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                            Text(
                                "This token should work with the backend.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                } else {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                "❌ Token is NOT valid JWT format!",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                            Text(
                                "JWT must have 3 parts separated by dots. Current parts: ${tokenParts.size}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                            Text(
                                "Please check your login/signup code.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                        }
                    }
                }
            } else {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "⚠️ No token found",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            "Please log in first.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
            }

            Button(
                onClick = {
                    // Copy token to clipboard for testing
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val clip = ClipData.newPlainText("token", authToken)
                    clipboard.setPrimaryClip(clip)
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = authToken != null
            ) {
                Text("Copy Token to Clipboard")
            }
        }
    }
}