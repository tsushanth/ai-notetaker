package com.kreativekoala.scribeai.utils

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import java.io.File
import java.io.IOException

class AudioRecorder(private val context: Context) {
    private var mediaRecorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var isRecording = false

    fun startRecording(): File? {
        try {
            // Create output file with proper extension
            val timestamp = System.currentTimeMillis()
            outputFile = File(context.cacheDir, "recording_$timestamp.m4a")  // ✅ m4a extension

            Log.d("AudioRecorder", "Starting recording to: ${outputFile?.absolutePath}")

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128000)
                setAudioSamplingRate(44100)
                setOutputFile(outputFile?.absolutePath)

                try {
                    prepare()
                    start()
                    isRecording = true
                    Log.d("AudioRecorder", "Recording started successfully")
                } catch (e: IOException) {
                    Log.e("AudioRecorder", "prepare() failed", e)
                    release()
                    return null
                }
            }

            return outputFile
        } catch (e: Exception) {
            Log.e("AudioRecorder", "Error starting recording", e)
            return null
        }
    }

    fun stopRecording(): File? {
        if (!isRecording) {
            Log.w("AudioRecorder", "Not currently recording")
            return null
        }

        return try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null
            isRecording = false

            Log.d("AudioRecorder", "Recording stopped. File size: ${outputFile?.length()} bytes")

            outputFile
        } catch (e: Exception) {
            Log.e("AudioRecorder", "Error stopping recording", e)
            release()
            null
        }
    }

    fun release() {
        try {
            mediaRecorder?.release()
            mediaRecorder = null
            isRecording = false
        } catch (e: Exception) {
            Log.e("AudioRecorder", "Error releasing recorder", e)
        }
    }

    fun isCurrentlyRecording(): Boolean = isRecording

    fun getOutputFile(): File? = outputFile
}