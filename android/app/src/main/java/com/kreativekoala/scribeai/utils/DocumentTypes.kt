package com.kreativekoala.scribeai.utils

/**
 * The document types the server can read (ai-notetaker-backend/src/routes/uploads.js, ALLOWED_MIME_TYPES). The picker
 * offers only these; a backend test keeps the two lists equal.
 */
object DocumentTypes {
    val ACCEPTED: Array<String> = arrayOf(
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
    )
}
