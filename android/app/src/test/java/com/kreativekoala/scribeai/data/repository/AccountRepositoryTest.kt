package com.kreativekoala.scribeai.data.repository

import com.kreativekoala.scribeai.data.api.ApiService
import com.kreativekoala.scribeai.data.models.DeleteAccountRequest
import com.kreativekoala.scribeai.data.models.DeletionReason
import com.kreativekoala.scribeai.data.models.GenericResponse
import kotlinx.coroutines.runBlocking
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.Timeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.lang.reflect.Proxy

/**
 * Account deletion must really reach the backend: DELETE /api/user/delete-account with the reason in the body.
 * (The old code never called the API, and the declared path /api/users/account did not exist.)
 */
class AccountRepositoryTest {

    // ---- a real Retrofit service whose HTTP layer is replaced by a recorder -------------------------------

    private class FakeCall(private val req: Request, private val resp: Response) : Call {
        override fun request() = req
        override fun execute() = resp
        override fun enqueue(responseCallback: Callback) = responseCallback.onResponse(this, resp)
        override fun cancel() {}
        override fun isExecuted() = true
        override fun isCanceled() = false
        override fun timeout() = Timeout.NONE
        override fun clone(): Call = FakeCall(req, resp)
    }

    private class RecordingFactory(private val status: Int, private val body: String) : Call.Factory {
        var captured: Request? = null
        override fun newCall(request: Request): Call {
            captured = request
            val response = Response.Builder()
                .request(request).protocol(Protocol.HTTP_1_1).code(status).message("")
                .body(body.toResponseBody("application/json".toMediaType()))
                .build()
            return FakeCall(request, response)
        }
    }

    private fun serviceWith(factory: Call.Factory): ApiService =
        Retrofit.Builder()
            .baseUrl("https://api.example.test/")
            .callFactory(factory)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)

    @Test
    fun deleteAccountSendsDeleteToTheRealRouteWithBearerTokenAndReason() = runBlocking {
        val factory = RecordingFactory(200, """{"success":true,"message":"Account and all associated data have been permanently deleted."}""")
        val result = AccountRepository(serviceWith(factory)).deleteAccount("tok123", DeletionReason.TOO_EXPENSIVE)

        assertTrue(result.isSuccess)
        val req = factory.captured
        assertNotNull(req)
        assertEquals("DELETE", req!!.method)
        assertEquals("/api/user/delete-account", req.url.encodedPath)
        assertEquals("Bearer tok123", req.header("Authorization"))
        val sent = Buffer().also { req.body!!.writeTo(it) }.readUtf8()
        assertEquals("""{"reason":"TOO_EXPENSIVE"}""", sent)
    }

    // ---- result mapping, with ApiService faked by a proxy that only answers deleteAccount ------------------

    private fun fakeApi(answer: () -> retrofit2.Response<GenericResponse>): ApiService =
        Proxy.newProxyInstance(ApiService::class.java.classLoader, arrayOf(ApiService::class.java)) { _, method, _ ->
            if (method.name == "deleteAccount") answer() else throw UnsupportedOperationException(method.name)
        } as ApiService

    private fun errorBody(json: String) = json.toResponseBody("application/json".toMediaType())

    @Test
    fun successfulDeletionIsASuccess() = runBlocking {
        val repo = AccountRepository(fakeApi { retrofit2.Response.success(GenericResponse(success = true)) })
        assertTrue(repo.deleteAccount("t", DeletionReason.OTHER).isSuccess)
    }

    @Test
    fun a200WithSuccessFalseIsNotReportedAsDeleted() = runBlocking {
        val repo = AccountRepository(fakeApi { retrofit2.Response.success(GenericResponse(success = false, error = "nope")) })
        val result = repo.deleteAccount("t", DeletionReason.OTHER)
        assertTrue(result.isFailure)
        assertEquals("nope", result.exceptionOrNull()!!.message)
    }

    @Test
    fun serverErrorMessageIsShownAsIs() = runBlocking {
        val repo = AccountRepository(fakeApi {
            retrofit2.Response.error(500, errorBody("""{"success":false,"error":"Failed to delete account. Please try again or contact support."}"""))
        })
        val result = repo.deleteAccount("t", DeletionReason.OTHER)
        assertTrue(result.isFailure)
        assertEquals("Failed to delete account. Please try again or contact support.", result.exceptionOrNull()!!.message)
    }

    @Test
    fun expiredSessionAsksToLogInAgain() = runBlocking {
        val repo = AccountRepository(fakeApi { retrofit2.Response.error(401, errorBody("""{"error":"Invalid token"}""")) })
        val result = repo.deleteAccount("t", DeletionReason.OTHER)
        assertTrue(result.isFailure)
        assertEquals("Session expired. Please log in again.", result.exceptionOrNull()!!.message)
    }

    @Test
    fun unreadableErrorBodyFallsBackToAGenericMessageWithTheStatus() = runBlocking {
        val repo = AccountRepository(fakeApi { retrofit2.Response.error(502, errorBody("<html>bad gateway</html>")) })
        val result = repo.deleteAccount("t", DeletionReason.OTHER)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()!!.message!!.contains("502"))
    }

    @Test
    fun anExceptionFromTheNetworkIsAFailureNotACrash() = runBlocking {
        val api = Proxy.newProxyInstance(ApiService::class.java.classLoader, arrayOf(ApiService::class.java)) { _, _, _ ->
            throw IllegalStateException("offline")
        } as ApiService
        val result = AccountRepository(api).deleteAccount("t", DeletionReason.OTHER)
        assertFalse(result.isSuccess)
        assertEquals("offline", result.exceptionOrNull()!!.message)
    }
}
