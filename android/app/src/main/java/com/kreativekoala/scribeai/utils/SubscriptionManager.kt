package com.kreativekoala.scribeai.utils

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.*
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.AccessStatusData
import com.kreativekoala.scribeai.data.models.SubscriptionEventRequest
import com.kreativekoala.scribeai.data.models.SubscriptionSyncRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Currency
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Manages Google Play Billing and subscription state
 */
class SubscriptionManager(private val context: Context) {

    companion object {
        private const val TAG = "SubscriptionManager"

        // Product IDs (must match what you set in Google Play Console)
        const val MONTHLY_SUB_ID = "scribe_ai_monthly"
        const val YEARLY_SUB_ID = "scribe_ai_yearly"

        // Free tier limits
        const val FREE_NOTEBOOK_LIMIT = 3

        // SharedPreferences keys
        private const val PREFS_NAME = "scribe_ai_prefs"
        private const val KEY_LIFETIME_NOTEBOOKS = "lifetime_notebooks_created"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private var billingClient: BillingClient? = null
    private var authManager: AuthManager? = null

    // Coroutine scope for background operations
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Server-side access status
    private val _serverAccessStatus = MutableStateFlow<AccessStatusData?>(null)
    val serverAccessStatus: StateFlow<AccessStatusData?> = _serverAccessStatus.asStateFlow()

    // ISO date formatter
    private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    private val _subscriptionState = MutableStateFlow<SubscriptionState>(SubscriptionState.Unknown)
    val subscriptionState: StateFlow<SubscriptionState> = _subscriptionState.asStateFlow()

    private val _products = MutableStateFlow<List<ProductDetails>>(emptyList())
    val products: StateFlow<List<ProductDetails>> = _products.asStateFlow()

    sealed class SubscriptionState {
        object Unknown : SubscriptionState()
        object Free : SubscriptionState()
        data class Subscribed(val type: SubscriptionType, val expiryDate: Long?) : SubscriptionState()
        object Loading : SubscriptionState()
    }

    enum class SubscriptionType {
        MONTHLY, YEARLY
    }

    /**
     * Set the auth manager for token access
     */
    fun setAuthManager(authManager: AuthManager) {
        this.authManager = authManager
    }

    /**
     * Initialize billing client
     */
    fun initialize(onReady: () -> Unit = {}) {
        billingClient = BillingClient.newBuilder(context)
            .setListener { billingResult, purchases ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                    handlePurchases(purchases)
                }
            }
            .enablePendingPurchases()
            .build()

        startConnection(onReady)
    }

    private fun startConnection(onReady: () -> Unit) {
        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client connected")
                    querySubscriptions()
                    checkExistingSubscriptions()
                    onReady()
                } else {
                    Log.e(TAG, "Billing setup failed: ${billingResult.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected")
                // Retry connection
            }
        })
    }

    /**
     * Query available subscription products from Play Store
     */
    private fun querySubscriptions() {
        val productList = listOf(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(MONTHLY_SUB_ID)
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(YEARLY_SUB_ID)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        )

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build()

        billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                _products.value = productDetailsList
                Log.d(TAG, "Products loaded: ${productDetailsList.size}")
            } else {
                Log.e(TAG, "Failed to query products: ${billingResult.debugMessage}")
            }
        }
    }

    /**
     * Check if user has existing active subscriptions
     */
    fun checkExistingSubscriptions() {
        _subscriptionState.value = SubscriptionState.Loading

        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()

        billingClient?.queryPurchasesAsync(params) { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                handlePurchases(purchases)
            } else {
                Log.e(TAG, "Failed to query purchases: ${billingResult.debugMessage}")
                _subscriptionState.value = SubscriptionState.Free
            }
        }
    }

    /**
     * Handle purchase updates
     */
    private fun handlePurchases(purchases: List<Purchase>) {
        if (purchases.isEmpty()) {
            _subscriptionState.value = SubscriptionState.Free
            return
        }

        // Find active subscription
        val activePurchase = purchases.find { purchase ->
            purchase.purchaseState == Purchase.PurchaseState.PURCHASED &&
                    (purchase.products.contains(MONTHLY_SUB_ID) || purchase.products.contains(YEARLY_SUB_ID))
        }

        if (activePurchase != null) {
            // Acknowledge purchase if not already acknowledged
            if (!activePurchase.isAcknowledged) {
                acknowledgePurchase(activePurchase)
            }

            val type = when {
                activePurchase.products.contains(YEARLY_SUB_ID) -> SubscriptionType.YEARLY
                activePurchase.products.contains(MONTHLY_SUB_ID) -> SubscriptionType.MONTHLY
                else -> SubscriptionType.MONTHLY
            }

            _subscriptionState.value = SubscriptionState.Subscribed(
                type = type,
                expiryDate = null // Would need to call Google API for actual expiry
            )

            // Track subscription for analytics
            val productId = if (type == SubscriptionType.YEARLY) YEARLY_SUB_ID else MONTHLY_SUB_ID
            val price = getFormattedPrice(productId)
            val currency = getPriceCurrencyCode(productId)
            AnalyticsService.trackSubscriptionBilled(productId, price, currency)

            // Sync with server
            syncWithServer(activePurchase)

            Log.d(TAG, "Active subscription found: $type")
        } else {
            _subscriptionState.value = SubscriptionState.Free
        }
    }

    /**
     * Acknowledge a purchase
     */
    private fun acknowledgePurchase(purchase: Purchase) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()

        billingClient?.acknowledgePurchase(params) { billingResult ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "Purchase acknowledged")
            } else {
                Log.e(TAG, "Failed to acknowledge: ${billingResult.debugMessage}")
            }
        }
    }

    /**
     * Launch subscription purchase flow
     */
    fun launchSubscriptionFlow(
        activity: Activity,
        productId: String,
        onSuccess: () -> Unit = {},
        onError: (String) -> Unit = {}
    ) {
        val product = _products.value.find { it.productId == productId }

        if (product == null) {
            onError("Product not found")
            return
        }

        val offerToken = product.subscriptionOfferDetails?.firstOrNull()?.offerToken

        if (offerToken == null) {
            onError("No offer available")
            return
        }

        val productDetailsParamsList = listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(product)
                .setOfferToken(offerToken)
                .build()
        )

        val billingFlowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(productDetailsParamsList)
            .build()

        val billingResult = billingClient?.launchBillingFlow(activity, billingFlowParams)

        if (billingResult?.responseCode == BillingClient.BillingResponseCode.OK) {
            Log.d(TAG, "Billing flow launched")
            onSuccess()
        } else {
            onError(billingResult?.debugMessage ?: "Failed to launch billing flow")
        }
    }

    /**
     * Check if user is subscribed
     */
    fun isSubscribed(): Boolean {
        return _subscriptionState.value is SubscriptionState.Subscribed
    }

    /**
     * Get formatted subscription price from product details
     */
    fun getFormattedPrice(productId: String): String {
        val product = _products.value.find { it.productId == productId }
        return product?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.firstOrNull()
            ?.formattedPrice ?: ""
    }

    /**
     * Get price in micros for calculations
     */
    fun getPriceAmountMicros(productId: String): Long {
        val product = _products.value.find { it.productId == productId }
        return product?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.firstOrNull()
            ?.priceAmountMicros ?: 0L
    }

    /**
     * Get currency code for the product
     */
    fun getPriceCurrencyCode(productId: String): String {
        val product = _products.value.find { it.productId == productId }
        return product?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.firstOrNull()
            ?.priceCurrencyCode ?: "USD"
    }

    /**
     * Calculate yearly price per month (formatted with correct currency)
     */
    fun getYearlyPricePerMonth(): String {
        val yearlyMicros = getPriceAmountMicros(YEARLY_SUB_ID)
        if (yearlyMicros == 0L) return ""

        val currencyCode = getPriceCurrencyCode(YEARLY_SUB_ID)
        val monthlyMicros = yearlyMicros / 12
        val monthlyAmount = monthlyMicros / 1_000_000.0

        return try {
            val format = NumberFormat.getCurrencyInstance()
            format.currency = Currency.getInstance(currencyCode)
            format.format(monthlyAmount)
        } catch (e: Exception) {
            // Fallback formatting
            String.format("%.2f", monthlyAmount)
        }
    }

    /**
     * Calculate savings percentage (yearly vs monthly)
     */
    fun getSavingsPercentage(): Int {
        val monthlyMicros = getPriceAmountMicros(MONTHLY_SUB_ID)
        val yearlyMicros = getPriceAmountMicros(YEARLY_SUB_ID)

        if (monthlyMicros == 0L || yearlyMicros == 0L) return 0

        val yearlyIfMonthly = monthlyMicros * 12
        val savings = yearlyIfMonthly - yearlyMicros
        val savingsPercent = (savings.toDouble() / yearlyIfMonthly.toDouble() * 100).toInt()

        return savingsPercent
    }

    /**
     * Check if prices are loaded from Play Store
     */
    fun arePricesLoaded(): Boolean {
        return _products.value.isNotEmpty() &&
                getPriceAmountMicros(MONTHLY_SUB_ID) > 0 &&
                getPriceAmountMicros(YEARLY_SUB_ID) > 0
    }

    // ==================== FREE TIER LIMIT TRACKING ====================

    /**
     * Get the lifetime count of notebooks created (never decreases)
     */
    fun getLifetimeNotebooksCreated(): Int {
        return prefs.getInt(KEY_LIFETIME_NOTEBOOKS, 0)
    }

    /**
     * Increment the lifetime notebook counter (call this on every notebook creation)
     */
    fun incrementLifetimeNotebooks() {
        val current = getLifetimeNotebooksCreated()
        prefs.edit().putInt(KEY_LIFETIME_NOTEBOOKS, current + 1).apply()
        Log.d(TAG, "Lifetime notebooks incremented to ${current + 1}")
    }

    /**
     * Check if user can create a new notebook
     * Returns true if subscribed OR hasn't hit lifetime limit
     */
    fun canCreateNotebook(): Boolean {
        if (isSubscribed()) {
            return true
        }
        val lifetime = getLifetimeNotebooksCreated()
        val canCreate = lifetime < FREE_NOTEBOOK_LIMIT
        Log.d(TAG, "canCreateNotebook: lifetime=$lifetime, limit=$FREE_NOTEBOOK_LIMIT, canCreate=$canCreate")
        return canCreate
    }

    /**
     * Get remaining free notebooks
     */
    fun getRemainingFreeNotebooks(): Int {
        val lifetime = getLifetimeNotebooksCreated()
        return (FREE_NOTEBOOK_LIMIT - lifetime).coerceAtLeast(0)
    }

    /**
     * Clean up resources
     */
    fun cleanup() {
        billingClient?.endConnection()
    }

    // ==================== SERVER SYNC ====================

    /**
     * Sync subscription status with server
     * Call this after a successful purchase or periodically to keep server in sync
     */
    fun syncWithServer(purchase: Purchase? = null) {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch

                // Determine product ID and type
                val productId = purchase?.products?.firstOrNull()
                    ?: if (isSubscribed()) {
                        when ((_subscriptionState.value as? SubscriptionState.Subscribed)?.type) {
                            SubscriptionType.YEARLY -> YEARLY_SUB_ID
                            SubscriptionType.MONTHLY -> MONTHLY_SUB_ID
                            else -> null
                        }
                    } else null

                if (productId == null) {
                    Log.d(TAG, "No subscription to sync")
                    return@launch
                }

                val syncRequest = SubscriptionSyncRequest(
                    productId = productId,
                    platform = "android",
                    status = if (isSubscribed()) "active" else "cancelled",
                    transactionId = purchase?.orderId,
                    originalTransactionId = purchase?.orderId,
                    purchaseDate = purchase?.purchaseTime?.let { isoFormatter.format(Date(it)) },
                    isTrial = false, // Google Play doesn't expose trial status directly
                    autoRenewEnabled = true,
                    priceAmount = getFormattedPrice(productId).replace(Regex("[^0-9.]"), ""),
                    priceCurrency = getPriceCurrencyCode(productId)
                )

                val response = RetrofitClient.apiService.syncSubscription(
                    "Bearer $token",
                    syncRequest
                )

                if (response.isSuccessful && response.body()?.success == true) {
                    Log.d(TAG, "Subscription synced with server successfully")
                    // Refresh access status after sync
                    refreshAccessStatus()
                } else {
                    Log.e(TAG, "Failed to sync subscription: ${response.errorBody()?.string()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error syncing subscription with server", e)
            }
        }
    }

    /**
     * Refresh access status from server
     * This is the authoritative check for what features the user can access
     */
    fun refreshAccessStatus() {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch

                val response = RetrofitClient.apiService.getAccessStatus("Bearer $token")

                if (response.isSuccessful) {
                    val accessData = response.body()?.data
                    _serverAccessStatus.value = accessData

                    // Update local subscription state based on server response
                    if (accessData?.isSubscribed == true || accessData?.isInTrial == true) {
                        val type = when {
                            accessData.productId?.contains("yearly") == true -> SubscriptionType.YEARLY
                            else -> SubscriptionType.MONTHLY
                        }
                        _subscriptionState.value = SubscriptionState.Subscribed(type, null)
                    }

                    Log.d(TAG, "Access status refreshed: hasAccess=${accessData?.hasAccess}, isSubscribed=${accessData?.isSubscribed}")
                } else {
                    Log.e(TAG, "Failed to refresh access status: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error refreshing access status", e)
            }
        }
    }

    /**
     * Check if user has server-verified access to premium features
     */
    fun hasServerVerifiedAccess(): Boolean {
        return _serverAccessStatus.value?.hasAccess == true
    }

    /**
     * Check if user can use AI features (server-authoritative)
     */
    fun canUseAI(): Boolean {
        val serverStatus = _serverAccessStatus.value
        return serverStatus?.features?.canUseAI == true ||
               serverStatus?.hasAccess == true ||
               isSubscribed() // Fall back to local state if server status not available
    }

    /**
     * Check if user can generate podcasts (server-authoritative)
     */
    fun canGeneratePodcasts(): Boolean {
        val serverStatus = _serverAccessStatus.value
        return serverStatus?.features?.canGeneratePodcasts == true ||
               serverStatus?.isSubscribed == true ||
               serverStatus?.isInTrial == true ||
               isSubscribed()
    }

    /**
     * Record a subscription event on the server
     */
    fun recordSubscriptionEvent(
        eventType: String,
        productId: String? = null,
        reason: String? = null
    ) {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch

                val request = SubscriptionEventRequest(
                    eventType = eventType,
                    platform = "android",
                    productId = productId,
                    priceAmount = productId?.let { getFormattedPrice(it).replace(Regex("[^0-9.]"), "") },
                    priceCurrency = productId?.let { getPriceCurrencyCode(it) },
                    reason = reason
                )

                val response = RetrofitClient.apiService.recordSubscriptionEvent(
                    "Bearer $token",
                    request
                )

                if (response.isSuccessful) {
                    Log.d(TAG, "Subscription event recorded: $eventType")
                } else {
                    Log.e(TAG, "Failed to record subscription event: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error recording subscription event", e)
            }
        }
    }
}