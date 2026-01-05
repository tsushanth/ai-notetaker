package com.kreativekoala.scribeai.data.api

import com.kreativekoala.scribeai.data.models.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    
    // Notes endpoints
    @GET("api/notes")
    suspend fun getNotes(
        @Header("Authorization") token: String,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20
    ): Response<NotesListResponse>
    
    @GET("api/notes/{id}")
    suspend fun getNote(
        @Header("Authorization") token: String,
        @Path("id") noteId: String
    ): Response<NoteResponse>
    
    @POST("api/notes")
    suspend fun createNote(
        @Header("Authorization") token: String,
        @Body request: CreateNoteRequest
    ): Response<NoteResponse>
    
    @DELETE("api/notes/{id}")
    suspend fun deleteNote(
        @Header("Authorization") token: String,
        @Path("id") noteId: String
    ): Response<NoteResponse>

    @PUT("api/notes/{id}")
    suspend fun updateNote(
        @Header("Authorization") token: String,
        @Path("id") noteId: String,
        @Body request: UpdateNoteRequest
    ): Response<NoteResponse>
    
    // Recording endpoints
    @Multipart
    @POST("api/recordings/upload")
    suspend fun uploadRecording(
        @Header("Authorization") token: String,
        @Part audio: MultipartBody.Part,
        @Part("note_id") noteId: RequestBody? = null,
        @Part("title") title: RequestBody? = null
    ): Response<RecordingResponse>
    
    @POST("api/recordings/transcribe")
    suspend fun transcribeRecording(
        @Header("Authorization") token: String,
        @Body request: Map<String, String>
    ): Response<TranscriptionResponse>
    
    // Video processing
    @POST("api/uploads/video-url")
    suspend fun processVideoUrl(
        @Header("Authorization") token: String,
        @Body request: ProcessVideoRequest
    ): Response<NoteResponse>
    
    // PDF upload
    @Multipart
    @POST("api/uploads/pdf")
    suspend fun uploadPDF(
        @Header("Authorization") token: String,
        @Part file: MultipartBody.Part,
        @Part("title") title: RequestBody? = null
    ): Response<NoteResponse>

    @Multipart
    @POST("api/uploads/scan")
    suspend fun uploadScannedDocument(
        @Header("Authorization") authToken: String,
        @Part file: MultipartBody.Part,
        @Part("extractedText") extractedText: RequestBody,
        @Part("title") title: RequestBody? = null
    ): Response<NoteResponse>
    
    // AI content generation
    @POST("api/ai/summary")
    suspend fun generateSummary(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>
    
    @POST("api/ai/quiz")
    suspend fun generateQuiz(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>
    
    @POST("api/ai/flashcards")
    suspend fun generateFlashcards(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>
    
    @POST("api/ai/podcast")
    suspend fun generatePodcast(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>
    
    @POST("api/ai/diagram")
    suspend fun generateDiagram(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>
    
    @GET("api/ai/note/{note_id}")
    suspend fun getAIContent(
        @Header("Authorization") token: String,
        @Path("note_id") noteId: String
    ): Response<AIContentResponse>

    @POST("api/ai/podcast")
    suspend fun startPodcastGeneration(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>

    @GET("api/ai/podcast/status/{note_id}")
    suspend fun getPodcastStatus(
        @Header("Authorization") token: String,
        @Path("note_id") noteId: String
    ): Response<PodcastStatusResponse>

    @GET("api/notes/{note_id}")
    suspend fun getNoteWithAIContent(
        @Header("Authorization") token: String,
        @Path("note_id") noteId: String
    ): Response<NoteDetailResponse>

    @GET("api/notes/{noteId}")
    suspend fun getNoteById(
        @Header("Authorization") token: String,
        @Path("noteId") noteId: String
    ): Response<NoteDetailResponse>

    @POST("api/ai/chat")
    suspend fun chatWithNote(
        @Header("Authorization") token: String,
        @Body request: ChatRequest
    ): Response<ChatApiResponse>

    // Subscription endpoints
    @POST("api/subscriptions/sync")
    suspend fun syncSubscription(
        @Header("Authorization") token: String,
        @Body request: SubscriptionSyncRequest
    ): Response<SubscriptionSyncResponse>

    @GET("api/subscriptions/status")
    suspend fun getSubscriptionStatus(
        @Header("Authorization") token: String
    ): Response<SubscriptionStatusResponse>

    @GET("api/subscriptions/access")
    suspend fun getAccessStatus(
        @Header("Authorization") token: String
    ): Response<AccessStatusResponse>

    @POST("api/subscriptions/event")
    suspend fun recordSubscriptionEvent(
        @Header("Authorization") token: String,
        @Body request: SubscriptionEventRequest
    ): Response<GenericResponse>

    @POST("api/subscriptions/trial/check")
    suspend fun checkTrialWithDevice(
        @Header("Authorization") token: String,
        @Body request: TrialCheckRequest
    ): Response<TrialCheckResponse>

    // Analytics endpoints
    @POST("api/analytics/batch")
    suspend fun sendAnalyticsBatch(
        @Header("Authorization") token: String,
        @Body request: AnalyticsBatchRequest
    ): Response<GenericResponse>

    // Error reporting endpoint
    @POST("api/errors/report")
    suspend fun reportError(
        @Header("Authorization") token: String,
        @Body request: ErrorReportRequest
    ): Response<GenericResponse>

    // Onboarding endpoints
    @POST("api/onboarding")
    suspend fun saveOnboardingPreferences(
        @Header("Authorization") token: String,
        @Body request: OnboardingPreferencesRequest
    ): Response<GenericResponse>

    // Promo code endpoints
    @POST("api/creators/validate-code")
    suspend fun validatePromoCode(
        @Body request: ValidatePromoCodeRequest
    ): Response<ValidatePromoCodeResponse>

    @POST("api/creators/apply-code")
    suspend fun applyPromoCode(
        @Header("Authorization") token: String,
        @Body request: ApplyPromoCodeRequest
    ): Response<GenericResponse>

    // Meeting bot endpoints
    @POST("api/meetings")
    suspend fun createMeeting(
        @Header("Authorization") token: String,
        @Body request: CreateMeetingRequest
    ): Response<CreateMeetingResponse>

    @GET("api/meetings")
    suspend fun getMeetings(
        @Header("Authorization") token: String,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20
    ): Response<MeetingsListResponse>

    @GET("api/meetings/{id}")
    suspend fun getMeetingStatus(
        @Header("Authorization") token: String,
        @Path("id") meetingId: String
    ): Response<MeetingResponse>

    @POST("api/meetings/{id}/cancel")
    suspend fun cancelMeeting(
        @Header("Authorization") token: String,
        @Path("id") meetingId: String
    ): Response<GenericResponse>

    @DELETE("api/meetings/{id}")
    suspend fun deleteMeeting(
        @Header("Authorization") token: String,
        @Path("id") meetingId: String
    ): Response<GenericResponse>

    @POST("api/meetings/validate-url")
    suspend fun validateMeetingUrl(
        @Header("Authorization") token: String,
        @Body request: ValidateMeetingUrlRequest
    ): Response<ValidateMeetingUrlResponse>
}
