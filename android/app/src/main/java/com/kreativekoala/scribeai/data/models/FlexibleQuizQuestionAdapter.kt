package com.kreativekoala.scribeai.data.models

import android.util.Log
import com.google.gson.*
import java.lang.reflect.Type

/**
 * Flexible JSON adapter for quiz questions that handles multiple formats:
 * 1. Direct array: [{ question: "...", options: [...] }, ...]
 * 2. Wrapped object: { "quiz_questions": [...] }
 * 3. Questions key: { "questions": [...] } (from backend response)
 */
class FlexibleQuizQuestionAdapter : JsonDeserializer<QuizQuestionsWrapper> {

    companion object {
        private const val TAG = "QuizQuestionAdapter"
    }

    override fun deserialize(
        json: JsonElement?,
        typeOfT: Type,
        context: JsonDeserializationContext
    ): QuizQuestionsWrapper {
        if (json == null || json.isJsonNull) {
            Log.d(TAG, "Quiz JSON is null")
            return QuizQuestionsWrapper(null)
        }

        return try {
            when {
                json.isJsonArray -> {
                    // Format: [...] - direct array of questions
                    Log.d(TAG, "Parsing quiz as direct array")
                    val questions = parseQuestionsArray(json.asJsonArray, context)
                    QuizQuestionsWrapper(questions)
                }
                json.isJsonObject -> {
                    val jsonObject = json.asJsonObject

                    // Try different possible keys for questions array
                    val questionsArray = when {
                        jsonObject.has("quiz_questions") -> {
                            Log.d(TAG, "Parsing quiz from 'quiz_questions' key")
                            jsonObject.get("quiz_questions")
                        }
                        jsonObject.has("questions") -> {
                            Log.d(TAG, "Parsing quiz from 'questions' key")
                            jsonObject.get("questions")
                        }
                        else -> {
                            Log.w(TAG, "Quiz object has no recognized questions key: ${jsonObject.keySet()}")
                            null
                        }
                    }

                    when {
                        questionsArray == null || questionsArray.isJsonNull -> {
                            QuizQuestionsWrapper(null)
                        }
                        questionsArray.isJsonArray -> {
                            val questions = parseQuestionsArray(questionsArray.asJsonArray, context)
                            QuizQuestionsWrapper(questions)
                        }
                        else -> {
                            Log.w(TAG, "Questions field is not an array: ${questionsArray.javaClass}")
                            QuizQuestionsWrapper(null)
                        }
                    }
                }
                else -> {
                    Log.w(TAG, "Unexpected quiz JSON type: ${json.javaClass}")
                    QuizQuestionsWrapper(null)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing quiz questions", e)
            QuizQuestionsWrapper(null)
        }
    }

    private fun parseQuestionsArray(
        array: JsonArray,
        context: JsonDeserializationContext
    ): List<QuizQuestion> {
        return try {
            array.mapNotNull { element ->
                try {
                    context.deserialize<QuizQuestion>(element, QuizQuestion::class.java)
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing individual question", e)
                    null
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing questions array", e)
            emptyList()
        }
    }
}