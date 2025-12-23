package com.kreativekoala.scribeai.ui.screens

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.kreativekoala.scribeai.ui.theme.AccentRed
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

data class ScannedPage(
    val bitmap: Bitmap,
    val text: String,
    val pageNumber: Int
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanDocumentScreen(
    viewModel: NoteViewModel,
    authManager: AuthManager,
    subscriptionManager: SubscriptionManager,
    onNavigateBack: () -> Unit,
    onNavigateToLogin: () -> Unit,
    onSuccess: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    var hasCameraPermission by remember { mutableStateOf(false) }
    var isProcessing by remember { mutableStateOf(false) }
    var showPreview by remember { mutableStateOf(false) }
    var scannedPages by remember { mutableStateOf<List<ScannedPage>>(emptyList()) }
    var currentImageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Get token from AuthManager
    val authToken by authManager.authToken.collectAsState(initial = null)

    // Check authentication on screen load
    LaunchedEffect(authToken) {
        if (authToken == null) {
            errorMessage = "Please log in to continue"
            kotlinx.coroutines.delay(2000)
            onNavigateToLogin()
        } else if (authManager.isTokenExpired(authToken!!)) {
            authManager.clearAuth()
            errorMessage = "Session expired. Please log in again."
            kotlinx.coroutines.delay(2000)
            onNavigateToLogin()
        }
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        hasCameraPermission = isGranted
    }

    // Photo picker for selecting multiple images from gallery
    val photoPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(maxItems = 10)
    ) { uris ->
        if (uris.isNotEmpty()) {
            scope.launch {
                isProcessing = true
                try {
                    val remainingSlots = 10 - scannedPages.size
                    val urisToProcess = uris.take(remainingSlots)

                    for (uri in urisToProcess) {
                        val bitmap = loadBitmapFromUri(context, uri)
                        if (bitmap != null) {
                            val text = extractTextFromImage(context, bitmap)
                            scannedPages = scannedPages + ScannedPage(
                                bitmap = bitmap,
                                text = text,
                                pageNumber = scannedPages.size + 1
                            )
                        }
                    }

                    if (uris.size > remainingSlots) {
                        errorMessage = "Only added $remainingSlots images (max 10 pages)"
                    }
                } catch (e: Exception) {
                    errorMessage = "Failed to load images: ${e.message}"
                } finally {
                    isProcessing = false
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scan Document") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (scannedPages.isNotEmpty()) {
                        TextButton(
                            onClick = {
                                // Validate token before upload
                                if (authToken == null) {
                                    errorMessage = "Session expired. Please log in again."
                                    scope.launch {
                                        kotlinx.coroutines.delay(1000)
                                        onNavigateToLogin()
                                    }
                                    return@TextButton
                                }

                                if (authManager.isTokenExpired(authToken!!)) {
                                    errorMessage = "Session expired. Please log in again."
                                    scope.launch {
                                        authManager.clearAuth()
                                        kotlinx.coroutines.delay(1000)
                                        onNavigateToLogin()
                                    }
                                    return@TextButton
                                }

                                scope.launch {
                                    isProcessing = true
                                    errorMessage = null

                                    try {
                                        // Generate PDF from scanned pages
                                        val pdfFile = withContext(Dispatchers.IO) {
                                            generatePdfFromPages(context, scannedPages)
                                        }

                                        // Check actual PDF file size
                                        val pdfSizeMB = pdfFile.length() / (1024.0 * 1024.0)
                                        Log.d("ScanDebug", "PDF size: ${pdfSizeMB}MB")

                                        if (pdfSizeMB > 25) {
                                            errorMessage = "PDF too large (${String.format("%.1f", pdfSizeMB)}MB). Try fewer pages."
                                            isProcessing = false
                                            pdfFile.delete()
                                            return@launch
                                        }

                                        // Upload PDF to backend
                                        viewModel.uploadScannedDocument(
                                            pdfFile = pdfFile,
                                            extractedText = scannedPages.joinToString("\n\n") { it.text },
                                            authToken = authToken!!,
                                            onSuccess = { note ->
                                                isProcessing = false
                                                pdfFile.delete()
                                                // Increment lifetime notebooks on successful creation
                                                subscriptionManager.incrementLifetimeNotebooks()
                                                onSuccess()
                                            },
                                            onError = { error ->
                                                isProcessing = false
                                                pdfFile.delete()

                                                if (error.contains("413") || error.contains("too large")) {
                                                    errorMessage = "Document too large. Try reducing pages or quality."
                                                } else if (error.contains("401") || error.contains("Unauthorized")) {
                                                    errorMessage = "Session expired. Please log in again."
                                                    scope.launch {
                                                        authManager.clearAuth()
                                                        kotlinx.coroutines.delay(1000)
                                                        onNavigateToLogin()
                                                    }
                                                } else {
                                                    errorMessage = error
                                                }
                                            }
                                        )
                                    } catch (e: Exception) {
                                        errorMessage = "Failed to process document: ${e.message}"
                                        isProcessing = false
                                    }
                                }
                            },
                            enabled = !isProcessing && authToken != null
                        ) {
                            if (isProcessing) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(16.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.onPrimary
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Uploading...")
                                }
                            } else {
                                Text("Save (${scannedPages.size})")
                            }
                        }
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (!hasCameraPermission) {
                // Permission denied state
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.CameraAlt,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Camera Permission Required",
                        style = MaterialTheme.typography.titleLarge
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Please grant camera permission to scan documents",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = { cameraPermissionLauncher.launch(Manifest.permission.CAMERA) }) {
                        Text("Grant Permission")
                    }
                }
            } else if (showPreview && scannedPages.isNotEmpty()) {
                // Preview scanned pages
                PreviewScannedPages(
                    scannedPages = scannedPages,
                    onContinueScanning = { showPreview = false },
                    onDeletePage = { index ->
                        scannedPages = scannedPages.filterIndexed { i, _ -> i != index }
                            .mapIndexed { i, page -> page.copy(pageNumber = i + 1) }
                        if (scannedPages.isEmpty()) {
                            showPreview = false
                        }
                    }
                )
            } else {
                // Camera preview
                Column(modifier = Modifier.fillMaxSize()) {
                    // Camera preview area
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    ) {
                        CameraPreview(
                            modifier = Modifier.fillMaxSize(),
                            onImageCaptureReady = { imageCapture ->
                                currentImageCapture = imageCapture
                            }
                        )

                        // Scanning guide overlay
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val canvasWidth = size.width
                            val canvasHeight = size.height
                            val rectWidth = canvasWidth * 0.8f
                            val rectHeight = canvasHeight * 0.6f
                            val left = (canvasWidth - rectWidth) / 2
                            val top = (canvasHeight - rectHeight) / 2

                            // Corner markers
                            val cornerLength = 40f
                            val strokeWidth = 4f

                            drawLine(
                                color = Color.White,
                                start = Offset(left, top),
                                end = Offset(left + cornerLength, top),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = Color.White,
                                start = Offset(left, top),
                                end = Offset(left, top + cornerLength),
                                strokeWidth = strokeWidth
                            )

                            drawLine(
                                color = Color.White,
                                start = Offset(left + rectWidth, top),
                                end = Offset(left + rectWidth - cornerLength, top),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = Color.White,
                                start = Offset(left + rectWidth, top),
                                end = Offset(left + rectWidth, top + cornerLength),
                                strokeWidth = strokeWidth
                            )

                            drawLine(
                                color = Color.White,
                                start = Offset(left, top + rectHeight),
                                end = Offset(left + cornerLength, top + rectHeight),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = Color.White,
                                start = Offset(left, top + rectHeight),
                                end = Offset(left, top + rectHeight - cornerLength),
                                strokeWidth = strokeWidth
                            )

                            drawLine(
                                color = Color.White,
                                start = Offset(left + rectWidth, top + rectHeight),
                                end = Offset(left + rectWidth - cornerLength, top + rectHeight),
                                strokeWidth = strokeWidth
                            )
                            drawLine(
                                color = Color.White,
                                start = Offset(left + rectWidth, top + rectHeight),
                                end = Offset(left + rectWidth, top + rectHeight - cornerLength),
                                strokeWidth = strokeWidth
                            )
                        }

                        // Instructions
                        if (scannedPages.isEmpty()) {
                            Text(
                                text = "Position document within frame",
                                modifier = Modifier
                                    .align(Alignment.TopCenter)
                                    .padding(top = 32.dp)
                                    .background(
                                        Color.Black.copy(alpha = 0.6f),
                                        RoundedCornerShape(16.dp)
                                    )
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                color = Color.White,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }

                    // Bottom controls
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.surface,
                        shadowElevation = 8.dp
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            if (scannedPages.isNotEmpty()) {
                                Text(
                                    text = "${scannedPages.size} page${if (scannedPages.size > 1) "s" else ""} scanned",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceEvenly,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Gallery button - pick from camera roll
                                IconButton(
                                    onClick = {
                                        if (scannedPages.size >= 10) {
                                            errorMessage = "Maximum 10 pages allowed"
                                            return@IconButton
                                        }
                                        photoPickerLauncher.launch(
                                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                        )
                                    },
                                    modifier = Modifier
                                        .size(56.dp)
                                        .border(2.dp, MaterialTheme.colorScheme.outline, CircleShape),
                                    enabled = !isProcessing
                                ) {
                                    Icon(
                                        Icons.Default.PhotoLibrary,
                                        contentDescription = "Choose from gallery",
                                        tint = if (isProcessing)
                                            MaterialTheme.colorScheme.outline
                                        else
                                            MaterialTheme.colorScheme.primary
                                    )
                                }

                                // Capture button
                                FloatingActionButton(
                                    onClick = {
                                        if (scannedPages.size >= 10) {
                                            errorMessage = "Maximum 10 pages allowed"
                                            return@FloatingActionButton
                                        }
                                        currentImageCapture?.let { imageCapture ->
                                            scope.launch {
                                                isProcessing = true
                                                try {
                                                    val photo = takePhoto(context, imageCapture)

                                                    // Debug: Log bitmap size
                                                    val sizeKB = photo.byteCount / 1024
                                                    val sizeMB = sizeKB / 1024.0
                                                    Log.d("ScanDebug", "Captured image size: ${sizeMB}MB (${photo.width}x${photo.height})")

                                                    val text = extractTextFromImage(context, photo)
                                                    scannedPages = scannedPages + ScannedPage(
                                                        bitmap = photo,
                                                        text = text,
                                                        pageNumber = scannedPages.size + 1
                                                    )

                                                    // Debug: Log total size
                                                    val totalSizeMB = scannedPages.sumOf { it.bitmap.byteCount } / (1024.0 * 1024.0)
                                                    Log.d("ScanDebug", "Total document size: ${totalSizeMB}MB")

                                                } catch (e: Exception) {
                                                    errorMessage = "Failed to capture: ${e.message}"
                                                } finally {
                                                    isProcessing = false
                                                }
                                            }
                                        }
                                    },
                                    modifier = Modifier.size(72.dp),
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    elevation = FloatingActionButtonDefaults.elevation(8.dp)
                                ) {
                                    if (isProcessing) {
                                        CircularProgressIndicator(
                                            color = MaterialTheme.colorScheme.onPrimary,
                                            modifier = Modifier.size(32.dp)
                                        )
                                    } else {
                                        Icon(
                                            Icons.Default.CameraAlt,
                                            contentDescription = "Capture",
                                            modifier = Modifier.size(32.dp)
                                        )
                                    }
                                }

                                // Preview button (when pages exist) or placeholder
                                if (scannedPages.isNotEmpty()) {
                                    IconButton(
                                        onClick = { showPreview = true },
                                        modifier = Modifier
                                            .size(56.dp)
                                            .border(2.dp, MaterialTheme.colorScheme.outline, CircleShape)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(
                                                Icons.Default.GridView,
                                                contentDescription = "Preview pages"
                                            )
                                            // Badge showing count
                                            Box(
                                                modifier = Modifier
                                                    .align(Alignment.TopEnd)
                                                    .offset(x = 4.dp, y = (-4).dp)
                                                    .size(20.dp)
                                                    .background(
                                                        MaterialTheme.colorScheme.primary,
                                                        CircleShape
                                                    ),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Text(
                                                    text = "${scannedPages.size}",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.onPrimary
                                                )
                                            }
                                        }
                                    }
                                } else {
                                    // Placeholder to keep layout balanced
                                    Spacer(modifier = Modifier.size(56.dp))
                                }
                            }
                        }
                    }
                }
            }

            // Error message
            errorMessage?.let { message ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        TextButton(onClick = { errorMessage = null }) {
                            Text("Dismiss")
                        }
                    }
                ) {
                    Text(message)
                }
            }
        }
    }
}

@Composable
fun CameraPreview(
    modifier: Modifier = Modifier,
    onImageCaptureReady: (ImageCapture) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }

    DisposableEffect(Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)

        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .build()

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageCapture
                )

                onImageCaptureReady(imageCapture)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            cameraProviderFuture.get().unbindAll()
        }
    }

    AndroidView(
        factory = { previewView },
        modifier = modifier
    )
}

@Composable
fun PreviewScannedPages(
    scannedPages: List<ScannedPage>,
    onContinueScanning: () -> Unit,
    onDeletePage: (Int) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            itemsIndexed(scannedPages) { index, page ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    elevation = CardDefaults.cardElevation(4.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Page ${page.pageNumber}",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            IconButton(onClick = { onDeletePage(index) }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = "Delete page",
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Image(
                            bitmap = page.bitmap.asImageBitmap(),
                            contentDescription = "Scanned page ${page.pageNumber}",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp)
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Text(
                            text = "Extracted text preview:",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        Text(
                            text = page.text.take(200) + if (page.text.length > 200) "..." else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        }

        Button(
            onClick = onContinueScanning,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Icon(Icons.Default.Add, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Scan Another Page")
        }
    }
}

// Better compression that also resizes the image
fun compressAndResizeBitmap(bitmap: Bitmap, maxWidth: Int = 1200, maxQuality: Int = 85): Bitmap {
    // Calculate scaling
    val ratio = maxWidth.toFloat() / bitmap.width
    val newHeight = (bitmap.height * ratio).toInt()

    // Resize if needed
    val resizedBitmap = if (bitmap.width > maxWidth) {
        Bitmap.createScaledBitmap(bitmap, maxWidth, newHeight, true)
    } else {
        bitmap
    }

    // Compress to JPEG
    val outputStream = ByteArrayOutputStream()
    resizedBitmap.compress(Bitmap.CompressFormat.JPEG, maxQuality, outputStream)

    // Convert back to bitmap
    val byteArray = outputStream.toByteArray()
    val compressedBitmap = BitmapFactory.decodeByteArray(byteArray, 0, byteArray.size)

    // Log the size
    val sizeKB = byteArray.size / 1024
    Log.d("ScanDebug", "Compressed image size: ${sizeKB}KB")

    return compressedBitmap
}

suspend fun takePhoto(context: Context, imageCapture: ImageCapture): Bitmap {
    return suspendCoroutine { continuation ->
        val photoFile = File(
            context.cacheDir,
            "scan_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.jpg"
        )

        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

        imageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    try {
                        var bitmap = BitmapFactory.decodeFile(photoFile.absolutePath)

                        Log.d("ScanDebug", "Original image: ${bitmap.width}x${bitmap.height}, ${bitmap.byteCount / 1024}KB")

                        // Rotate if needed
                        bitmap = rotateBitmapIfNeeded(bitmap, photoFile.absolutePath)

                        // Compress and resize the image
                        bitmap = compressAndResizeBitmap(bitmap, maxWidth = 1200, maxQuality = 75)

                        photoFile.delete()
                        continuation.resume(bitmap)
                    } catch (e: Exception) {
                        Log.e("ScanDebug", "Error processing image", e)
                        photoFile.delete()
                        continuation.resume(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e("ScanDebug", "Camera error", exception)
                    continuation.resume(Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888))
                }
            }
        )
    }
}

fun rotateBitmapIfNeeded(bitmap: Bitmap, imagePath: String): Bitmap {
    return try {
        val exif = androidx.exifinterface.media.ExifInterface(imagePath)
        val orientation = exif.getAttributeInt(
            androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION,
            androidx.exifinterface.media.ExifInterface.ORIENTATION_NORMAL
        )

        val matrix = Matrix()
        when (orientation) {
            androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        }

        Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    } catch (e: Exception) {
        bitmap
    }
}

suspend fun extractTextFromImage(context: Context, bitmap: Bitmap): String {
    return suspendCoroutine { continuation ->
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val image = InputImage.fromBitmap(bitmap, 0)

        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                continuation.resume(visionText.text)
            }
            .addOnFailureListener { e ->
                continuation.resume("")
            }
    }
}

/**
 * Load a bitmap from a content URI (e.g., from photo picker)
 */
suspend fun loadBitmapFromUri(context: Context, uri: Uri): Bitmap? {
    return withContext(Dispatchers.IO) {
        try {
            val inputStream = context.contentResolver.openInputStream(uri)
            val originalBitmap = BitmapFactory.decodeStream(inputStream)
            inputStream?.close()

            if (originalBitmap != null) {
                // Compress and resize the image similar to camera capture
                compressAndResizeBitmap(originalBitmap, maxWidth = 1200, maxQuality = 75)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e("ScanDebug", "Error loading bitmap from URI: ${uri}", e)
            null
        }
    }
}

fun generatePdfFromPages(context: Context, scannedPages: List<ScannedPage>): File {
    val pdfFile = File(
        context.cacheDir,
        "scanned_document_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.pdf"
    )

    try {
        val pdfDocument = android.graphics.pdf.PdfDocument()

        scannedPages.forEachIndexed { index, page ->
            // Use bitmap dimensions for PDF page
            val pageInfo = android.graphics.pdf.PdfDocument.PageInfo.Builder(
                page.bitmap.width,
                page.bitmap.height,
                index + 1
            ).create()

            val pdfPage = pdfDocument.startPage(pageInfo)
            val canvas = pdfPage.canvas

            // Draw bitmap directly (already compressed)
            canvas.drawBitmap(page.bitmap, 0f, 0f, null)

            pdfDocument.finishPage(pdfPage)
        }

        FileOutputStream(pdfFile).use { outputStream ->
            pdfDocument.writeTo(outputStream)
        }
        pdfDocument.close()

        // Log final PDF size
        val sizeMB = pdfFile.length() / (1024.0 * 1024.0)
        Log.d("ScanDebug", "Generated PDF: ${sizeMB}MB")

    } catch (e: Exception) {
        Log.e("ScanDebug", "Error generating PDF", e)
        e.printStackTrace()
    }

    return pdfFile
}