package com.kreativekoala.scribeai.ui.screens

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.viewmodel.AuthState
import com.kreativekoala.scribeai.viewmodel.AuthViewModel
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    viewModel: AuthViewModel = androidx.lifecycle.viewmodel.compose.viewModel(),
    onNavigateToHome: () -> Unit,
    onNavigateToSignUp: () -> Unit = {}
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showForgotPasswordDialog by remember { mutableStateOf(false) }  // NEW
    var forgotPasswordEmail by remember { mutableStateOf("") }  // NEW
    var forgotPasswordSent by remember { mutableStateOf(false) }  // NEW

    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val coroutineScope = rememberCoroutineScope()
    val credentialManager = remember { CredentialManager.create(context) }

    // Observe auth state
    val authState by viewModel.authState.collectAsState()

    LaunchedEffect(authState) {
        when (authState) {
            is AuthState.Authenticated -> {
                // Navigate to home on successful login
                onNavigateToHome()
            }
            is AuthState.Error -> {
                isLoading = false
                val error = (authState as AuthState.Error).message
                // IMPROVED: Better error messages
                errorMessage = when {
                    error.contains("Invalid login credentials", ignoreCase = true) ->
                        context.getString(R.string.error_invalid_credentials)
                    error.contains("Email not confirmed", ignoreCase = true) ->
                        context.getString(R.string.error_email_not_confirmed)
                    error.contains("User not found", ignoreCase = true) ->
                        context.getString(R.string.error_user_not_found)
                    error.contains("network", ignoreCase = true) ||
                            error.contains("timeout", ignoreCase = true) ->
                        context.getString(R.string.error_network)
                    else -> error
                }
            }
            else -> {}
        }
    }

    Scaffold(
        containerColor = DarkBackground
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                // Logo/Icon
                Box(
                    modifier = Modifier
                        .size(100.dp)
                        .background(Purple80.copy(alpha = 0.2f), RoundedCornerShape(24.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Notes,
                        contentDescription = null,
                        modifier = Modifier.size(50.dp),
                        tint = Purple80
                    )
                }

                Spacer(Modifier.height(32.dp))

                // Title
                Text(
                    stringResource(R.string.welcome_back),
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                Text(
                    stringResource(R.string.sign_in_to_continue),
                    fontSize = 16.sp,
                    color = TextSecondary,
                    modifier = Modifier.padding(top = 8.dp)
                )

                Spacer(Modifier.height(48.dp))

                // IMPROVED: Google Sign In Button with better visibility
                OutlinedButton(
                    onClick = {
                        coroutineScope.launch {
                            try {
                                isLoading = true
                                errorMessage = null

                                val rawNonce = UUID.randomUUID().toString()
                                val nonce = rawNonce.sha256()

                                val googleIdOption = GetGoogleIdOption.Builder()
                                    .setFilterByAuthorizedAccounts(false)
                                    .setServerClientId(context.getString(R.string.web_client_id))
                                    .setNonce(nonce)
                                    .build()

                                val request = GetCredentialRequest.Builder()
                                    .addCredentialOption(googleIdOption)
                                    .build()

                                val result = credentialManager.getCredential(
                                    request = request,
                                    context = context
                                )

                                val credential = result.credential
                                val googleIdTokenCredential = GoogleIdTokenCredential
                                    .createFrom(credential.data)

                                val idToken = googleIdTokenCredential.idToken

                                // Sign in to Supabase via ViewModel
                                viewModel.signInWithGoogle(idToken, rawNonce)

                            } catch (e: Exception) {
                                isLoading = false
                                errorMessage = when {
                                    e.message?.contains("canceled", ignoreCase = true) == true -> null  // User cancelled
                                    e.message?.contains("no credentials", ignoreCase = true) == true ->
                                        context.getString(R.string.error_no_google_account)
                                    else -> e.message ?: context.getString(R.string.error_google_signin_failed)
                                }
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        containerColor = Color.White,
                        contentColor = Color.Black
                    ),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !isLoading,
                    border = ButtonDefaults.outlinedButtonBorder.copy(
                        width = 1.dp,
                        brush = androidx.compose.ui.graphics.SolidColor(Color.LightGray)
                    )
                ) {
                    Row(
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        // Google "G" colored icon simulation
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .background(Color.Transparent),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "G",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF4285F4)  // Google Blue
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(
                            stringResource(R.string.continue_with_google),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.Black
                        )
                    }
                }

                Spacer(Modifier.height(24.dp))

                // Divider
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    HorizontalDivider(
                        modifier = Modifier.weight(1f),
                        color = DarkSurfaceVariant
                    )
                    Text(
                        stringResource(R.string.or_divider),
                        fontSize = 14.sp,
                        color = TextSecondary
                    )
                    HorizontalDivider(
                        modifier = Modifier.weight(1f),
                        color = DarkSurfaceVariant
                    )
                }

                Spacer(Modifier.height(24.dp))

                // Email Field
                OutlinedTextField(
                    value = email,
                    onValueChange = {
                        email = it
                        errorMessage = null
                    },
                    label = { Text(stringResource(R.string.email)) },
                    placeholder = { Text(stringResource(R.string.email_placeholder)) },
                    leadingIcon = {
                        Icon(Icons.Default.Email, contentDescription = null)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Purple80,
                        unfocusedBorderColor = DarkSurfaceVariant,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Purple80,
                        focusedLabelColor = Purple80,
                        unfocusedLabelColor = TextSecondary,
                        errorBorderColor = AccentRed,
                        errorLabelColor = AccentRed
                    ),
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next
                    ),
                    keyboardActions = KeyboardActions(
                        onNext = { focusManager.moveFocus(FocusDirection.Down) }
                    ),
                    singleLine = true,
                    isError = errorMessage != null
                )

                Spacer(Modifier.height(16.dp))

                // Password Field
                OutlinedTextField(
                    value = password,
                    onValueChange = {
                        password = it
                        errorMessage = null
                    },
                    label = { Text(stringResource(R.string.password)) },
                    placeholder = { Text(stringResource(R.string.enter_password)) },
                    leadingIcon = {
                        Icon(Icons.Default.Lock, contentDescription = null)
                    },
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                if (passwordVisible) Icons.Default.Visibility
                                else Icons.Default.VisibilityOff,
                                contentDescription = if (passwordVisible) stringResource(R.string.hide_password) else stringResource(R.string.show_password)
                            )
                        }
                    },
                    visualTransformation = if (passwordVisible) VisualTransformation.None
                    else PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Purple80,
                        unfocusedBorderColor = DarkSurfaceVariant,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Purple80,
                        focusedLabelColor = Purple80,
                        unfocusedLabelColor = TextSecondary,
                        errorBorderColor = AccentRed,
                        errorLabelColor = AccentRed
                    ),
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = {
                            focusManager.clearFocus()
                            if (email.isNotBlank() && password.isNotBlank()) {
                                coroutineScope.launch {
                                    isLoading = true
                                    viewModel.signIn(email, password)
                                }
                            }
                        }
                    ),
                    singleLine = true,
                    isError = errorMessage != null
                )

                // Error Message
                if (errorMessage != null) {
                    Spacer(Modifier.height(12.dp))
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = AccentRed.copy(alpha = 0.1f)
                        ),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Error,
                                contentDescription = null,
                                tint = AccentRed,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                errorMessage!!,
                                color = AccentRed,
                                fontSize = 14.sp
                            )
                        }
                    }
                }

                Spacer(Modifier.height(24.dp))

                // Sign In Button
                Button(
                    onClick = {
                        errorMessage = null

                        // Validation
                        if (email.isBlank()) {
                            errorMessage = context.getString(R.string.error_email_required)
                            return@Button
                        }
                        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                            errorMessage = context.getString(R.string.error_invalid_email)
                            return@Button
                        }
                        if (password.isBlank()) {
                            errorMessage = context.getString(R.string.error_password_required)
                            return@Button
                        }
                        if (password.length < 6) {
                            errorMessage = context.getString(R.string.error_password_too_short)
                            return@Button
                        }

                        coroutineScope.launch {
                            isLoading = true
                            viewModel.signIn(email, password)
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Purple80
                    ),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !isLoading
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = Color.White,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text(
                            stringResource(R.string.sign_in),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                // FIXED: Forgot Password - Now opens dialog
                TextButton(onClick = {
                    forgotPasswordEmail = email  // Pre-fill with entered email
                    showForgotPasswordDialog = true
                }) {
                    Text(
                        stringResource(R.string.forgot_password),
                        fontSize = 14.sp,
                        color = Purple80
                    )
                }

                Spacer(Modifier.height(32.dp))

                // Sign Up Link
                Row(
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        stringResource(R.string.no_account),
                        fontSize = 14.sp,
                        color = TextSecondary
                    )
                    TextButton(onClick = onNavigateToSignUp) {
                        Text(
                            stringResource(R.string.sign_up),
                            fontSize = 14.sp,
                            color = Purple80,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }
    }

    // NEW: Forgot Password Dialog
    if (showForgotPasswordDialog) {
        AlertDialog(
            onDismissRequest = {
                showForgotPasswordDialog = false
                forgotPasswordSent = false
            },
            icon = {
                Icon(
                    if (forgotPasswordSent) Icons.Default.CheckCircle else Icons.Default.LockReset,
                    contentDescription = null,
                    tint = if (forgotPasswordSent) Color(0xFF4CAF50) else Purple80,
                    modifier = Modifier.size(48.dp)
                )
            },
            title = {
                Text(
                    if (forgotPasswordSent) stringResource(R.string.email_sent) else stringResource(R.string.reset_password),
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Column {
                    if (forgotPasswordSent) {
                        Text(
                            stringResource(R.string.reset_email_sent),
                            color = TextSecondary
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            forgotPasswordEmail,
                            fontWeight = FontWeight.Medium,
                            color = TextPrimary
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            stringResource(R.string.check_inbox),
                            color = TextSecondary,
                            fontSize = 13.sp
                        )
                    } else {
                        Text(
                            stringResource(R.string.reset_password_instruction),
                            color = TextSecondary
                        )
                        Spacer(Modifier.height(16.dp))
                        OutlinedTextField(
                            value = forgotPasswordEmail,
                            onValueChange = { forgotPasswordEmail = it },
                            label = { Text(stringResource(R.string.email)) },
                            placeholder = { Text(stringResource(R.string.email_placeholder)) },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email
                            ),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Purple80,
                                unfocusedBorderColor = DarkSurfaceVariant
                            ),
                            shape = RoundedCornerShape(8.dp)
                        )
                    }
                }
            },
            confirmButton = {
                if (forgotPasswordSent) {
                    Button(
                        onClick = {
                            showForgotPasswordDialog = false
                            forgotPasswordSent = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Purple80)
                    ) {
                        Text(stringResource(R.string.done))
                    }
                } else {
                    Button(
                        onClick = {
                            if (forgotPasswordEmail.isNotBlank() &&
                                android.util.Patterns.EMAIL_ADDRESS.matcher(forgotPasswordEmail).matches()) {
                                // Call password reset
                                coroutineScope.launch {
                                    viewModel.resetPassword(forgotPasswordEmail)
                                    forgotPasswordSent = true
                                }
                            } else {
                                Toast.makeText(context, context.getString(R.string.error_enter_valid_email), Toast.LENGTH_SHORT).show()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Purple80)
                    ) {
                        Text(stringResource(R.string.send_reset_link))
                    }
                }
            },
            dismissButton = {
                if (!forgotPasswordSent) {
                    TextButton(onClick = { showForgotPasswordDialog = false }) {
                        Text(stringResource(R.string.cancel))
                    }
                }
            }
        )
    }
}

// Helper function to hash nonce
private fun String.sha256(): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(this.toByteArray())
    return bytes.joinToString("") { "%02x".format(it) }
}