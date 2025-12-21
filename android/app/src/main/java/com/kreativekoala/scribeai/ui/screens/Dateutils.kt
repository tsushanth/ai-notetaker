package com.kreativekoala.scribeai.ui.screens

import java.text.SimpleDateFormat
import java.util.*

fun formatDate(timestamp: Any): String {
    return try {
        when (timestamp) {
            is String -> {
                // Try ISO format first
                try {
                    val inputFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                    val outputFormat = SimpleDateFormat("MMM d", Locale.getDefault())
                    val date = inputFormat.parse(timestamp)
                    outputFormat.format(date ?: Date())
                } catch (e: Exception) {
                    // Try simple date format
                    try {
                        val inputFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                        val outputFormat = SimpleDateFormat("MMM d", Locale.getDefault())
                        val date = inputFormat.parse(timestamp)
                        outputFormat.format(date ?: Date())
                    } catch (e: Exception) {
                        timestamp
                    }
                }
            }
            is Long -> {
                val outputFormat = SimpleDateFormat("MMM d", Locale.getDefault())
                outputFormat.format(Date(timestamp))
            }
            else -> timestamp.toString()
        }
    } catch (e: Exception) {
        timestamp.toString()
    }
}