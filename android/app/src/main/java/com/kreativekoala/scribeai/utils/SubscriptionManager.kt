package com.kreativekoala.scribeai.utils

import android.annotation.SuppressLint
import android.app.Activity
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import android.content.Context
import android.provider.Settings
import android.util.Log
import com.android.billingclient.api.*
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.AccessStatusData
import com.kreativekoala.scribeai.data.models.SubscriptionEventRequest
import com.kreativekoala.scribeai.data.models.SubscriptionSyncRequest
import com.kreativekoala.scribeai.data.models.TrialCheckRequest
import com.kreativekoala.scribeai.service.FacebookSDKHelper
import com.kreativekoala.scribeai.service.TikTokHelper
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.*

class SubscriptionManager(private val context: Context) {

    companion object {
        private const val TAG = "SubscriptionManager"

        const val MONTHLY_SUB_ID = "scribe_ai_monthly"
        const val YEARLY_SUB_ID = "scribe_ai_yearly"

        const val FREE_NOTEBOOK_LIMIT = 3
        const val FREE_OPEN_LIMIT = 3

        private const val PREFS_NAME = "scribe_ai_prefs"
        private const val KEY_LIFETIME_NOTEBOOKS = "lifetime_notebooks_created"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_IS_SUBSCRIBED = "is_subscribed"
        // Set true whenever the server confirms ANY active access (subscription,
        // trial, server-granted). Used by the Retrofit interceptor to decide
        // whether to send the rate-limit bypass header.
        private const val KEY_HAS_ACCESS = "has_access"
        private const val KEY_APP_OPEN_COUNT = "app_open_count"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var authManager: AuthManager? = null

    private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    // ── Public state ──────────────────────────────────────────────────────────

    private val _subscriptionState = MutableStateFlow<SubscriptionState>(SubscriptionState.Unknown)
    val subscriptionState: StateFlow<SubscriptionState> = _subscriptionState.asStateFlow()

    /** ProductDetails for each subscription (replaces RC Package list) */
    private val _products = MutableStateFlow<List<ProductDetails>>(emptyList())
    val products: StateFlow<List<ProductDetails>> = _products.asStateFlow()

    private val _serverAccessStatus = MutableStateFlow<AccessStatusData?>(null)
    val serverAccessStatus: StateFlow<AccessStatusData?> = _serverAccessStatus.asStateFlow()

    private val _deviceTrialExpired = MutableStateFlow(false)
    val deviceTrialExpired: StateFlow<Boolean> = _deviceTrialExpired.asStateFlow()

    // ── Sealed states ─────────────────────────────────────────────────────────

    sealed class SubscriptionState {
        object Unknown : SubscriptionState()
        object Free : SubscriptionState()
        data class Subscribed(val type: SubscriptionType, val expiryDate: Long?) : SubscriptionState()
        object Loading : SubscriptionState()
    }

    enum class SubscriptionType { MONTHLY, YEARLY }

    // ── Device ID ─────────────────────────────────────────────────────────────

    @get:SuppressLint("HardwareIds")
    val deviceId: String by lazy {
        prefs.getString(KEY_DEVICE_ID, null) ?: run {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            val id = if (androidId != null && androidId != "9774d56d682e549c") "android_$androidId"
            else "uuid_${UUID.randomUUID()}"
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
            id
        }
    }

    // ── BillingClient ─────────────────────────────────────────────────────────

    private val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            scope.launch {
                for (purchase in purchases) {
                    handlePurchase(purchase)
                }
            }
        } else if (billingResult.responseCode != BillingClient.BillingResponseCode.USER_CANCELED) {
            Log.e(TAG, "Purchase failed: ${billingResult.debugMessage}")
        }
    }

    private val billingClient: BillingClient = BillingClient.newBuilder(context)
        .setListener(purchasesUpdatedListener)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    // ── Init ──────────────────────────────────────────────────────────────────

    fun setAuthManager(am: AuthManager) { authManager = am }

    fun initialize(onReady: () -> Unit = {}) {
        if (prefs.getBoolean(KEY_IS_SUBSCRIBED, false)) {
            _subscriptionState.value = SubscriptionState.Subscribed(SubscriptionType.MONTHLY, null)
        } else {
            _subscriptionState.value = SubscriptionState.Loading
        }

        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    scope.launch {
                        queryProducts()
                        checkExistingSubscriptions()
                        withContext(Dispatchers.Main) { onReady() }
                    }
                } else {
                    Log.e(TAG, "Billing setup failed: ${result.debugMessage}")
                    withContext(scope, Dispatchers.Main) { onReady() }
                }
            }
            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected")
            }
        })
    }

    private fun withContext(scope: CoroutineScope, dispatcher: CoroutineDispatcher, block: () -> Unit) {
        scope.launch(dispatcher) { block() }
    }

    private suspend fun queryProducts() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(MONTHLY_SUB_ID, YEARLY_SUB_ID).map { id ->
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                }
            ).build()

        val result = billingClient.queryProductDetails(params)
        if (result.billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
            _products.value = result.productDetailsList ?: emptyList()
            Log.d(TAG, "Products loaded: ${_products.value.size}")
        } else {
            Log.e(TAG, "queryProductDetails failed: ${result.billingResult.debugMessage}")
        }
    }

    fun checkExistingSubscriptions() {
        scope.launch {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
            val result = billingClient.queryPurchasesAsync(params)
            val activePurchases = result.purchasesList.filter {
                it.purchaseState == Purchase.PurchaseState.PURCHASED
            }
            if (activePurchases.isNotEmpty()) {
                val purchase = activePurchases.first()
                val productId = purchase.products.firstOrNull() ?: ""
                updateSubscriptionState(productId, purchase.purchaseTime)
                acknowledgePurchaseIfNeeded(purchase)
            } else {
                _subscriptionState.value = SubscriptionState.Free
                prefs.edit().putBoolean(KEY_IS_SUBSCRIBED, false).apply()
            }
        }
    }

    private suspend fun handlePurchase(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        val productId = purchase.products.firstOrNull() ?: return
        acknowledgePurchaseIfNeeded(purchase)
        updateSubscriptionState(productId, purchase.purchaseTime)

        val price = getFormattedPrice(productId)
        val currency = getPriceCurrencyCode(productId)
        AnalyticsService.trackSubscriptionBilled(productId, price, currency)
        FirebaseAnalyticsHelper.logPurchaseCompleted(productId, getRawPrice(productId))
        TikTokHelper.trackEvent("purchase_success")
        FacebookSDKHelper.logPurchase(getRawPrice(productId), getPriceCurrencyCode(productId), productId)
        // Trial-start is a distinct Meta event used for funnel-stage optimization
        // and LTV cohorting. Both SKUs ship with a 3-day free trial. The dedupe
        // inside the helper ensures we only fire once per (install, product) —
        // Google Play sends Purchase events for both trial accept AND renewals.
        FacebookSDKHelper.logTrialStartedOnce(productId)
        // PaywallKit conversion telemetry — mirrors VibeBuild Android. Lets the
        // PaywallKit-API/Supabase paywall_events table see real Android purchases
        // (not just button-taps), so we can reconcile against ASC/Play sales.
        com.kreativekoala.paywallkit.manager.PaywallManager.trackEvent(
            appId = "scribeai",
            placement = "play_billing_confirmed",
            templateId = "default",
            event = "purchased",
            productId = productId,
        )
        // Rating peak — Apple/Google guidance is to ask after success moments.
        // The helper dedupes (1 prompt every 7d, never if user already rated).
        InAppReviewHelper.recordSuccessfulAction()
        scope.launch {
            kotlinx.coroutines.delay(1500)
            InAppReviewHelper.checkAndShowPromptIfEligible()
        }
        PromoCodeManager.clearAfterConversion()
        syncWithServer(productId, purchase.orderId, purchase.purchaseTime)
    }

    private suspend fun acknowledgePurchaseIfNeeded(purchase: Purchase) {
        if (!purchase.isAcknowledged) {
            val ackParams = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build()
            val result = billingClient.acknowledgePurchase(ackParams)
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "Purchase acknowledged: ${purchase.orderId}")
            }
        }
    }

    private fun updateSubscriptionState(productId: String, purchaseTimeMs: Long? = null) {
        val type = when {
            productId.contains("yearly") || productId.contains("annual") -> SubscriptionType.YEARLY
            else -> SubscriptionType.MONTHLY
        }
        _subscriptionState.value = SubscriptionState.Subscribed(type, purchaseTimeMs)
        prefs.edit()
            .putBoolean(KEY_IS_SUBSCRIBED, true)
            .putBoolean(KEY_HAS_ACCESS, true)
            .apply()
        Log.d(TAG, "Subscription active: $productId, type=$type")
        syncWithServer()
    }

    // ── Purchase flow ─────────────────────────────────────────────────────────

    fun launchSubscriptionFlow(
        activity: Activity,
        productId: String,
        onSuccess: () -> Unit = {},
        onError: (String) -> Unit = {}
    ) {
        val productDetails = _products.value.find { it.productId == productId }
        if (productDetails == null) {
            Log.e(TAG, "ProductDetails not found for $productId")
            onError("Product not found")
            return
        }

        val offerToken = productDetails.subscriptionOfferDetails?.firstOrNull()?.offerToken ?: ""
        val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)
            .setOfferToken(offerToken)
            .build()

        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productDetailsParams))
            .build()

        val result = billingClient.launchBillingFlow(activity, params)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.e(TAG, "launchBillingFlow failed: ${result.debugMessage}")
            onError(result.debugMessage)
        }
        // Success is handled by PurchasesUpdatedListener → handlePurchase → updateSubscriptionState
        // onSuccess called after state update would need a listener; for now paywall dismisses via state
    }

    fun restorePurchases(onSuccess: () -> Unit = {}, onError: (String) -> Unit = {}) {
        scope.launch {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
            val result = billingClient.queryPurchasesAsync(params)
            val activePurchases = result.purchasesList.filter {
                it.purchaseState == Purchase.PurchaseState.PURCHASED
            }
            if (activePurchases.isNotEmpty()) {
                val purchase = activePurchases.first()
                val productId = purchase.products.firstOrNull() ?: ""
                acknowledgePurchaseIfNeeded(purchase)
                updateSubscriptionState(productId, purchase.purchaseTime)
                refreshAccessStatus()
                withContext(Dispatchers.Main) { onSuccess() }
            } else {
                withContext(Dispatchers.Main) { onError("No active subscriptions found") }
            }
        }
    }

    // ── State helpers ─────────────────────────────────────────────────────────

    fun isSubscribed(): Boolean =
        _subscriptionState.value is SubscriptionState.Subscribed ||
                prefs.getBoolean(KEY_IS_SUBSCRIBED, false)

    fun identify(userId: String) {
        // No-op with direct billing — user ID tracked server-side
        Log.d(TAG, "identify called for userId=$userId (no-op with direct billing)")
        refreshAccessStatus()
    }

    fun resetIdentity() {
        _subscriptionState.value = SubscriptionState.Free
        prefs.edit().putBoolean(KEY_IS_SUBSCRIBED, false).apply()
    }

    fun cleanup() {
        billingClient.endConnection()
        scope.cancel()
    }

    // ── Price helpers ─────────────────────────────────────────────────────────

    fun getFormattedPrice(productId: String): String =
        _products.value.find { it.productId == productId }
            ?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.lastOrNull()
            ?.formattedPrice ?: ""

    fun getPriceAmountMicros(productId: String): Long =
        _products.value.find { it.productId == productId }
            ?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.lastOrNull()
            ?.priceAmountMicros ?: 0L

    fun getPriceCurrencyCode(productId: String): String =
        _products.value.find { it.productId == productId }
            ?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.lastOrNull()
            ?.priceCurrencyCode ?: "USD"

    fun getRawPrice(productId: String): Double = getPriceAmountMicros(productId) / 1_000_000.0

    fun formatPrice(amount: Double, productId: String): String {
        val code = getPriceCurrencyCode(productId)
        return try {
            val fmt = NumberFormat.getCurrencyInstance()
            fmt.currency = Currency.getInstance(code)
            fmt.format(amount)
        } catch (e: Exception) { String.format("%.2f", amount) }
    }

    fun getYearlyPricePerMonth(): String {
        val micros = getPriceAmountMicros(YEARLY_SUB_ID)
        if (micros == 0L) return ""
        return formatPrice(micros / 12 / 1_000_000.0, YEARLY_SUB_ID)
    }

    fun getYearlyPricePerWeek(): String {
        val micros = getPriceAmountMicros(YEARLY_SUB_ID)
        if (micros == 0L) return ""
        return formatPrice(micros / 52 / 1_000_000.0, YEARLY_SUB_ID)
    }

    fun getSavingsPercentage(): Int {
        val monthly = getPriceAmountMicros(MONTHLY_SUB_ID)
        val yearly = getPriceAmountMicros(YEARLY_SUB_ID)
        if (monthly == 0L || yearly == 0L) return 0
        val yearlyIfMonthly = monthly * 12
        return ((yearlyIfMonthly - yearly).toDouble() / yearlyIfMonthly * 100).toInt()
    }

    fun arePricesLoaded(): Boolean =
        _products.value.isNotEmpty() &&
                getPriceAmountMicros(MONTHLY_SUB_ID) > 0 &&
                getPriceAmountMicros(YEARLY_SUB_ID) > 0

    // ── Free tier ─────────────────────────────────────────────────────────────

    fun getLifetimeNotebooksCreated(): Int = prefs.getInt(KEY_LIFETIME_NOTEBOOKS, 0)
    fun incrementLifetimeNotebooks() {
        prefs.edit().putInt(KEY_LIFETIME_NOTEBOOKS, getLifetimeNotebooksCreated() + 1).apply()
    }
    fun canCreateNotebook(): Boolean = isSubscribed() || getLifetimeNotebooksCreated() < FREE_NOTEBOOK_LIMIT
    fun getRemainingFreeNotebooks(): Int = (FREE_NOTEBOOK_LIMIT - getLifetimeNotebooksCreated()).coerceAtLeast(0)

    fun getAppOpenCount(): Int = prefs.getInt(KEY_APP_OPEN_COUNT, 0)
    fun incrementAppOpenCount() {
        prefs.edit().putInt(KEY_APP_OPEN_COUNT, getAppOpenCount() + 1).apply()
    }
    fun shouldShowHardPaywall(): Boolean = !isSubscribed() && getAppOpenCount() > FREE_OPEN_LIMIT

    // ── Feature gates ─────────────────────────────────────────────────────────

    fun hasServerVerifiedAccess(): Boolean = _serverAccessStatus.value?.hasAccess == true

    fun canUseAI(): Boolean {
        if (_deviceTrialExpired.value && !isSubscribed()) return false
        val s = _serverAccessStatus.value
        return if (s != null) s.features?.canUseAI == true || s.hasAccess else isSubscribed()
    }

    fun canGeneratePodcasts(): Boolean {
        if (_deviceTrialExpired.value && !isSubscribed()) return false
        val s = _serverAccessStatus.value
        return if (s != null) s.features?.canGeneratePodcasts == true || s.isSubscribed || s.isInTrial else isSubscribed()
    }

    fun canExportNotes(): Boolean {
        if (_deviceTrialExpired.value && !isSubscribed()) return false
        val s = _serverAccessStatus.value
        return if (s != null) s.features?.canExportNotes == true || s.isSubscribed || s.isInTrial else isSubscribed()
    }

    // ── Server sync ───────────────────────────────────────────────────────────

    fun syncWithServer(productId: String? = null, orderId: String? = null, purchaseTimeMs: Long? = null) {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch
                val resolvedProductId = productId ?: when ((_subscriptionState.value as? SubscriptionState.Subscribed)?.type) {
                    SubscriptionType.YEARLY -> YEARLY_SUB_ID
                    SubscriptionType.MONTHLY -> MONTHLY_SUB_ID
                    else -> return@launch
                }
                val request = SubscriptionSyncRequest(
                    productId = resolvedProductId,
                    platform = "android",
                    status = if (isSubscribed()) "active" else "cancelled",
                    transactionId = orderId,
                    originalTransactionId = orderId,
                    purchaseDate = purchaseTimeMs?.let { isoFormatter.format(Date(it)) },
                    isTrial = false,
                    autoRenewEnabled = true,
                    priceAmount = getFormattedPrice(resolvedProductId).replace(Regex("[^0-9.]"), ""),
                    priceCurrency = getPriceCurrencyCode(resolvedProductId),
                    deviceId = deviceId
                )
                val response = RetrofitClient.apiService.syncSubscription("Bearer $token", request)
                if (response.isSuccessful) {
                    Log.d(TAG, "Subscription synced with server")
                    refreshAccessStatus()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error syncing subscription", e)
            }
        }
    }

    fun refreshAccessStatus() {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch
                try {
                    val trialResponse = RetrofitClient.apiService.checkTrialWithDevice(
                        "Bearer $token", TrialCheckRequest(deviceId = deviceId)
                    )
                    if (trialResponse.isSuccessful) {
                        val d = trialResponse.body()?.data
                        _deviceTrialExpired.value = d?.deviceTrialUsed == true && d.trialExpired
                    }
                } catch (e: Exception) { Log.e(TAG, "Trial check error", e) }

                val response = RetrofitClient.apiService.getAccessStatus("Bearer $token")
                if (response.isSuccessful) {
                    val accessData = response.body()?.data
                    _serverAccessStatus.value = accessData
                    val hasAccess = accessData?.isSubscribed == true ||
                            accessData?.isInTrial == true ||
                            accessData?.hasAccess == true
                    // Persist for cross-process readers (Retrofit interceptor reads
                    // this to decide whether to send the rate-limit bypass header).
                    prefs.edit().putBoolean(KEY_HAS_ACCESS, hasAccess).apply()
                    if (accessData?.isSubscribed == true || accessData?.isInTrial == true) {
                        val type = if (accessData.productId?.contains("yearly") == true) SubscriptionType.YEARLY else SubscriptionType.MONTHLY
                        _subscriptionState.value = SubscriptionState.Subscribed(type, null)
                    }
                }
            } catch (e: Exception) { Log.e(TAG, "Error refreshing access status", e) }
        }
    }

    fun recordSubscriptionEvent(eventType: String, productId: String? = null, reason: String? = null) {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch
                val request = SubscriptionEventRequest(
                    eventType = eventType, platform = "android", productId = productId,
                    priceAmount = productId?.let { getFormattedPrice(it).replace(Regex("[^0-9.]"), "") },
                    priceCurrency = productId?.let { getPriceCurrencyCode(it) }, reason = reason
                )
                RetrofitClient.apiService.recordSubscriptionEvent("Bearer $token", request)
            } catch (e: Exception) { Log.e(TAG, "Error recording subscription event", e) }
        }
    }
}
