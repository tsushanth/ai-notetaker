package com.kreativekoala.scribeai.data.api

import com.kreativekoala.scribeai.data.models.*
import com.kreativekoala.scribeai.phone.CheckVerificationRequest
import com.kreativekoala.scribeai.phone.CheckVerificationResponse
import com.kreativekoala.scribeai.phone.CreateCallResponse
import com.kreativekoala.scribeai.phone.HangupResponse
import com.kreativekoala.scribeai.phone.InitiateCallRequest
import com.kreativekoala.scribeai.phone.ListPhoneCallsResponse
import com.kreativekoala.scribeai.phone.PhoneCallResponse
import com.kreativekoala.scribeai.phone.RecordingControlResponse
import com.kreativekoala.scribeai.phone.SendVerificationRequest
import com.kreativekoala.scribeai.phone.SendVerificationResponse
import com.kreativekoala.scribeai.phone.VerifiedPhonesResponse
import com.kreativekoala.scribeai.phone.VoipTokenResponse
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

    /** Script-only generation for on-device synthesis (system TTS on Android). */
    @POST("api/ai/podcast/script")
    suspend fun generatePodcastScript(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<PodcastScriptResponse>
    
    @POST("api/ai/diagram")
    suspend fun generateDiagram(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<AIContentResponse>

    @POST("api/ai/infographic")
    suspend fun generateInfographic(
        @Header("Authorization") token: String,
        @Body request: GenerateAIRequest
    ): Response<InfographicGenerateResponse>

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

    // Mind Map endpoint
    @POST("api/ai/mindmap")
    suspend fun generateMindMap(
        @Header("Authorization") token: String,
        @Body request: MindMapGenerateRequest
    ): Response<MindMapResponse>

    // TTS endpoints
    @POST("api/tts/generate")
    suspend fun generateTTS(
        @Header("Authorization") token: String,
        @Body request: TTSGenerateRequest
    ): Response<TTSResponse>

    @GET("api/tts/note/{noteId}")
    suspend fun getTTSForNote(
        @Header("Authorization") token: String,
        @Path("noteId") noteId: String
    ): Response<TTSResponse>

    // Export endpoints
    @GET("api/notes/{noteId}/export/pdf")
    @Streaming
    suspend fun exportNotePdf(
        @Header("Authorization") token: String,
        @Path("noteId") noteId: String
    ): Response<okhttp3.ResponseBody>

    @GET("api/notes/{noteId}/export/docx")
    @Streaming
    suspend fun exportNoteDocx(
        @Header("Authorization") token: String,
        @Path("noteId") noteId: String
    ): Response<okhttp3.ResponseBody>

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

    // User stats endpoint (for retention screens)
    @GET("api/onboarding/stats")
    suspend fun getUserStats(
        @Header("Authorization") token: String
    ): Response<UserStatsResponse>

    // Custom content creation (Create tab)
    @POST("api/create/{noteId}")
    suspend fun createCustomContent(
        @Header("Authorization") token: String,
        @Path("noteId") noteId: String,
        @Body request: Map<String, String>
    ): Response<CreateContentResponse>

    // Delete account endpoint
    @DELETE("api/users/account")
    suspend fun deleteAccount(
        @Header("Authorization") token: String,
        @Body request: DeleteAccountRequest
    ): Response<GenericResponse>

    // Phone verification (in-app phone calls)
    @POST("api/phone/verify/send")
    suspend fun sendPhoneVerificationCode(
        @Header("Authorization") token: String,
        @Body request: SendVerificationRequest
    ): Response<SendVerificationResponse>

    @POST("api/phone/verify/check")
    suspend fun checkPhoneVerificationCode(
        @Header("Authorization") token: String,
        @Body request: CheckVerificationRequest
    ): Response<CheckVerificationResponse>

    @GET("api/phone/verified")
    suspend fun getVerifiedPhones(
        @Header("Authorization") token: String
    ): Response<VerifiedPhonesResponse>

    @DELETE("api/phone/verified/{id}")
    suspend fun deleteVerifiedPhone(
        @Header("Authorization") token: String,
        @Path("id") id: String
    ): Response<Unit>

    // VoIP token (Twilio Voice SDK)
    @GET("api/phone/voip/token")
    suspend fun getVoipToken(
        @Header("Authorization") token: String
    ): Response<VoipTokenResponse>

    // Phone calls
    @POST("api/phone/calls")
    suspend fun createPhoneCall(
        @Header("Authorization") token: String,
        @Body request: InitiateCallRequest
    ): Response<CreateCallResponse>

    @GET("api/phone/calls")
    suspend fun getPhoneCalls(
        @Header("Authorization") token: String,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): Response<ListPhoneCallsResponse>

    @GET("api/phone/calls/{id}")
    suspend fun getPhoneCall(
        @Header("Authorization") token: String,
        @Path("id") id: String
    ): Response<PhoneCallResponse>

    @POST("api/phone/calls/{id}/record")
    suspend fun startPhoneCallRecording(
        @Header("Authorization") token: String,
        @Path("id") callId: String
    ): Response<RecordingControlResponse>

    @DELETE("api/phone/calls/{id}/record")
    suspend fun stopPhoneCallRecording(
        @Header("Authorization") token: String,
        @Path("id") callId: String
    ): Response<RecordingControlResponse>

    @POST("api/phone/calls/{id}/hangup")
    suspend fun hangupPhoneCall(
        @Header("Authorization") token: String,
        @Path("id") callId: String
    ): Response<HangupResponse>
}
