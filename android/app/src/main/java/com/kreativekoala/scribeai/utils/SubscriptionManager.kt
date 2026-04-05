package com.kreativekoala.scribeai.utils

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import com.kreativekoala.scribeai.service.TikTokHelper
import android.provider.Settings
import android.util.Log
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.AccessStatusData
import com.kreativekoala.scribeai.data.models.SubscriptionEventRequest
import com.kreativekoala.scribeai.data.models.SubscriptionSyncRequest
import com.kreativekoala.scribeai.data.models.TrialCheckRequest
import com.kreativekoala.scribeai.data.models.TrialCheckData
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.getCustomerInfoWith
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.logInWith
import com.revenuecat.purchases.logOutWith
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith
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
import java.util.UUID

/**
 * Manages RevenueCat subscriptions and subscription state
 */
class SubscriptionManager(private val context: Context) {

    companion object {
        private const val TAG = "SubscriptionManager"

        // Product IDs (must match what you set in RevenueCat)
        const val MONTHLY_SUB_ID = "scribe_ai_monthly"
        const val YEARLY_SUB_ID = "scribe_ai_yearly"

        // RevenueCat entitlement identifier
        private const val ENTITLEMENT_PRO = "premium"

        // Free tier limits
        const val FREE_NOTEBOOK_LIMIT = 3

        // Number of free app opens before hard paywall is shown
        const val FREE_OPEN_LIMIT = 3

        // SharedPreferences keys
        private const val PREFS_NAME = "scribe_ai_prefs"
        private const val KEY_LIFETIME_NOTEBOOKS = "lifetime_notebooks_created"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_IS_SUBSCRIBED = "is_subscribed"
        private const val KEY_APP_OPEN_COUNT = "app_open_count"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // Device ID for trial abuse prevention (persisted across app installs where possible)
    @get:SuppressLint("HardwareIds")
    val deviceId: String by lazy {
        prefs.getString(KEY_DEVICE_ID, null) ?: run {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            val newDeviceId = if (androidId != null && androidId != "9774d56d682e549c") {
                "android_$androidId"
            } else {
                "uuid_${UUID.randomUUID()}"
            }
            prefs.edit().putString(KEY_DEVICE_ID, newDeviceId).apply()
            newDeviceId
        }
    }

    // Track if this device has already used and expired a trial
    private val _deviceTrialExpired = MutableStateFlow(false)
    val deviceTrialExpired: StateFlow<Boolean> = _deviceTrialExpired.asStateFlow()

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

    // RC packages from current offering
    private val _products = MutableStateFlow<List<Package>>(emptyList())
    val products: StateFlow<List<Package>> = _products.asStateFlow()

    // Cached customer info
    private var cachedCustomerInfo: CustomerInfo? = null

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
     * Identify the RC user with the logged-in user ID.
     * Call this after the user successfully logs in.
     */
    fun identify(userId: String) {
        Purchases.sharedInstance.logInWith(
            appUserID = userId,
            onError = { error -> Log.e(TAG, "RC login error: ${error.message}") },
            onSuccess = { customerInfo, created ->
                Log.d(TAG, "RC user identified: $userId (new=$created)")
                cachedCustomerInfo = customerInfo
                updateSubscriptionState(customerInfo)
            }
        )
    }

    /**
     * Reset RC identity on logout
     */
    fun resetIdentity() {
        Purchases.sharedInstance.logOutWith(
            onError = { error -> Log.e(TAG, "RC logout error: ${error.message}") },
            onSuccess = { customerInfo ->
                Log.d(TAG, "RC user logged out")
                cachedCustomerInfo = customerInfo
                updateSubscriptionState(customerInfo)
            }
        )
    }

    /**
     * Initialize: fetch offerings (packages) and check existing entitlements
     */
    fun initialize(onReady: () -> Unit = {}) {
        // Emit cached subscribed state immediately so UI doesn't flicker on startup
        if (prefs.getBoolean(KEY_IS_SUBSCRIBED, false)) {
            _subscriptionState.value = SubscriptionState.Subscribed(SubscriptionType.MONTHLY, null)
        } else {
            _subscriptionState.value = SubscriptionState.Loading
        }

        // Listen for RC customer info changes (e.g. purchase via PaywallDialog)
        Purchases.sharedInstance.updatedCustomerInfoListener =
            com.revenuecat.purchases.interfaces.UpdatedCustomerInfoListener { customerInfo ->
                Log.d(TAG, "RC customer info updated")
                cachedCustomerInfo = customerInfo
                updateSubscriptionState(customerInfo)
            }

        // Load available packages from RC current offering
        Purchases.sharedInstance.getOfferingsWith(
            onError = { error ->
                Log.e(TAG, "RC offerings error: ${error.message}")
                onReady()
            },
            onSuccess = { offerings ->
                val packages = offerings.current?.availablePackages ?: emptyList()
                _products.value = packages
                Log.d(TAG, "RC packages loaded: ${packages.size}")
                // Now check entitlements
                checkExistingSubscriptions()
                onReady()
            }
        )
    }

    /**
     * Check if user has existing active entitlements via RC
     */
    fun checkExistingSubscriptions() {
        Purchases.sharedInstance.getCustomerInfoWith(
            onError = { error ->
                Log.e(TAG, "RC customer info error: ${error.message}")
                _subscriptionState.value = SubscriptionState.Free
            },
            onSuccess = { customerInfo ->
                cachedCustomerInfo = customerInfo
                updateSubscriptionState(customerInfo)
            }
        )
    }

    /**
     * Derive subscription state from RC CustomerInfo
     */
    private fun updateSubscriptionState(customerInfo: CustomerInfo) {
        val entitlement = customerInfo.entitlements[ENTITLEMENT_PRO]
        if (entitlement?.isActive == true) {
            val productId = entitlement.productIdentifier
            val type = when {
                productId.contains("yearly") || productId.contains("annual") -> SubscriptionType.YEARLY
                else -> SubscriptionType.MONTHLY
            }
            val expiryMs = entitlement.expirationDate?.time
            _subscriptionState.value = SubscriptionState.Subscribed(type, expiryMs)
            prefs.edit().putBoolean(KEY_IS_SUBSCRIBED, true).apply()
            Log.d(TAG, "RC entitlement active: $productId, type=$type")
            // Sync with backend so it knows the subscription is active
            syncWithServer()
        } else {
            _subscriptionState.value = SubscriptionState.Free
            prefs.edit().putBoolean(KEY_IS_SUBSCRIBED, false).apply()
            Log.d(TAG, "RC entitlement not active")
        }
    }

    /**
     * Launch subscription purchase flow via RevenueCat
     */
    fun launchSubscriptionFlow(
        activity: Activity,
        productId: String,
        onSuccess: () -> Unit = {},
        onError: (String) -> Unit = {}
    ) {
        val pkg = _products.value.find { it.product.id == productId || it.product.id.startsWith("$productId:") }

        if (pkg == null) {
            Log.e(TAG, "RC package not found for productId=$productId")
            onError("Product not found")
            return
        }

        Purchases.sharedInstance.purchaseWith(
            PurchaseParams.Builder(activity, pkg).build(),
            onError = { error, userCancelled ->
                if (!userCancelled) {
                    Log.e(TAG, "RC purchase error: ${error.message}")
                    onError(error.message)
                }
            },
            onSuccess = { storeTransaction, customerInfo ->
                Log.d(TAG, "RC purchase success: ${storeTransaction?.productIds}")
                cachedCustomerInfo = customerInfo
                updateSubscriptionState(customerInfo)

                // Analytics
                val price = getFormattedPrice(productId)
                val currency = getPriceCurrencyCode(productId)
                AnalyticsService.trackSubscriptionBilled(productId, price, currency)
                FirebaseAnalyticsHelper.logPurchaseCompleted(
                    productId,
                    price.replace("[^\\d.]".toRegex(), "").toDoubleOrNull()
                )
                TikTokHelper.trackEvent("purchase_success")

                // Sync with server
                syncWithServer(productId, storeTransaction?.orderId, storeTransaction?.purchaseTime)

                onSuccess()
            }
        )
    }

    /**
     * Restore purchases via RevenueCat
     */
    fun restorePurchases(onSuccess: () -> Unit = {}, onError: (String) -> Unit = {}) {
        Purchases.sharedInstance.restorePurchasesWith(
            onError = { error ->
                Log.e(TAG, "RC restore error: ${error.message}")
                onError(error.message)
            },
            onSuccess = { customerInfo ->
                Log.d(TAG, "RC restore success")
                cachedCustomerInfo = customerInfo
                updateSubscriptionState(customerInfo)
                refreshAccessStatus()
                onSuccess()
            }
        )
    }

    /**
     * Check if user is subscribed
     */
    fun isSubscribed(): Boolean {
        return _subscriptionState.value is SubscriptionState.Subscribed ||
                cachedCustomerInfo?.entitlements?.get(ENTITLEMENT_PRO)?.isActive == true ||
                prefs.getBoolean(KEY_IS_SUBSCRIBED, false)
    }

    /**
     * Get formatted price from RC package
     */
    fun getFormattedPrice(productId: String): String {
        return _products.value.find { it.product.id == productId || it.product.id.startsWith("$productId:") }
            ?.product?.price?.formatted ?: ""
    }

    /**
     * Get price in micros for calculations
     */
    fun getPriceAmountMicros(productId: String): Long {
        return _products.value.find { it.product.id == productId || it.product.id.startsWith("$productId:") }
            ?.product?.price?.amountMicros ?: 0L
    }

    /**
     * Get currency code for the product
     */
    fun getPriceCurrencyCode(productId: String): String {
        return _products.value.find { it.product.id == productId || it.product.id.startsWith("$productId:") }
            ?.product?.price?.currencyCode ?: "USD"
    }

    /**
     * Get raw price as Double for calculations
     */
    fun getRawPrice(productId: String): Double {
        return getPriceAmountMicros(productId) / 1_000_000.0
    }

    /**
     * Format a price amount with the correct currency for a product
     */
    fun formatPrice(amount: Double, productId: String): String {
        val currencyCode = getPriceCurrencyCode(productId)
        return try {
            val format = NumberFormat.getCurrencyInstance()
            format.currency = Currency.getInstance(currencyCode)
            format.format(amount)
        } catch (e: Exception) {
            String.format("%.2f", amount)
        }
    }

    /**
     * Calculate yearly price per month (formatted with correct currency)
     */
    fun getYearlyPricePerMonth(): String {
        val yearlyMicros = getPriceAmountMicros(YEARLY_SUB_ID)
        if (yearlyMicros == 0L) return ""

        val currencyCode = getPriceCurrencyCode(YEARLY_SUB_ID)
        val monthlyAmount = yearlyMicros / 12 / 1_000_000.0

        return try {
            val format = NumberFormat.getCurrencyInstance()
            format.currency = Currency.getInstance(currencyCode)
            format.format(monthlyAmount)
        } catch (e: Exception) {
            String.format("%.2f", monthlyAmount)
        }
    }

    /**
     * Calculate yearly price per week (formatted with correct currency)
     */
    fun getYearlyPricePerWeek(): String {
        val yearlyMicros = getPriceAmountMicros(YEARLY_SUB_ID)
        if (yearlyMicros == 0L) return ""

        val currencyCode = getPriceCurrencyCode(YEARLY_SUB_ID)
        val weeklyAmount = yearlyMicros / 52 / 1_000_000.0

        return try {
            val format = NumberFormat.getCurrencyInstance()
            format.currency = Currency.getInstance(currencyCode)
            format.format(weeklyAmount)
        } catch (e: Exception) {
            String.format("%.2f", weeklyAmount)
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
        return (savings.toDouble() / yearlyIfMonthly.toDouble() * 100).toInt()
    }

    /**
     * Check if prices are loaded from RC
     */
    fun arePricesLoaded(): Boolean {
        return _products.value.isNotEmpty() &&
                getPriceAmountMicros(MONTHLY_SUB_ID) > 0 &&
                getPriceAmountMicros(YEARLY_SUB_ID) > 0
    }

    // ==================== FREE TIER LIMIT TRACKING ====================

    fun getLifetimeNotebooksCreated(): Int = prefs.getInt(KEY_LIFETIME_NOTEBOOKS, 0)

    fun incrementLifetimeNotebooks() {
        val current = getLifetimeNotebooksCreated()
        prefs.edit().putInt(KEY_LIFETIME_NOTEBOOKS, current + 1).apply()
        Log.d(TAG, "Lifetime notebooks incremented to ${current + 1}")
    }

    fun canCreateNotebook(): Boolean {
        if (isSubscribed()) return true
        val lifetime = getLifetimeNotebooksCreated()
        return lifetime < FREE_NOTEBOOK_LIMIT
    }

    fun getRemainingFreeNotebooks(): Int {
        return (FREE_NOTEBOOK_LIMIT - getLifetimeNotebooksCreated()).coerceAtLeast(0)
    }

    // ==================== APP OPEN TRACKING (HARD PAYWALL) ====================

    /**
     * Get the total number of app opens recorded.
     */
    fun getAppOpenCount(): Int = prefs.getInt(KEY_APP_OPEN_COUNT, 0)

    /**
     * Increment the app open counter. Call once per cold-start session.
     */
    fun incrementAppOpenCount() {
        val current = getAppOpenCount()
        prefs.edit().putInt(KEY_APP_OPEN_COUNT, current + 1).apply()
        Log.d(TAG, "App open count incremented to ${current + 1}")
    }

    /**
     * Returns true when the user has exceeded the free open limit
     * and is NOT subscribed, meaning the hard paywall should be shown.
     */
    fun shouldShowHardPaywall(): Boolean {
        if (isSubscribed()) return false
        return getAppOpenCount() > FREE_OPEN_LIMIT
    }

    /**
     * No-op — RC handles its own connection lifecycle
     */
    fun cleanup() {
        // RC SDK manages its own lifecycle
    }

    // ==================== SERVER SYNC ====================

    /**
     * Sync subscription status with server after a purchase
     */
    fun syncWithServer(
        productId: String? = null,
        orderId: String? = null,
        purchaseTimeMs: Long? = null
    ) {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch

                val resolvedProductId = productId
                    ?: if (isSubscribed()) {
                        when ((_subscriptionState.value as? SubscriptionState.Subscribed)?.type) {
                            SubscriptionType.YEARLY -> YEARLY_SUB_ID
                            SubscriptionType.MONTHLY -> MONTHLY_SUB_ID
                            else -> null
                        }
                    } else null

                if (resolvedProductId == null) {
                    Log.d(TAG, "No subscription to sync")
                    return@launch
                }

                val syncRequest = SubscriptionSyncRequest(
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

                val response = RetrofitClient.apiService.syncSubscription("Bearer $token", syncRequest)

                if (response.isSuccessful && response.body()?.success == true) {
                    Log.d(TAG, "Subscription synced with server successfully")
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
     * Refresh access status from server (authoritative feature access check)
     */
    fun refreshAccessStatus() {
        scope.launch {
            try {
                val token = authManager?.getFreshToken() ?: return@launch

                // Check trial abuse with device ID
                try {
                    val trialResponse = RetrofitClient.apiService.checkTrialWithDevice(
                        "Bearer $token",
                        TrialCheckRequest(deviceId = deviceId)
                    )
                    if (trialResponse.isSuccessful) {
                        val trialData = trialResponse.body()?.data
                        _deviceTrialExpired.value = trialData?.deviceTrialUsed == true && trialData.trialExpired
                        Log.d(TAG, "Device trial check: used=${trialData?.deviceTrialUsed}, expired=${trialData?.trialExpired}")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking trial with device", e)
                }

                val response = RetrofitClient.apiService.getAccessStatus("Bearer $token")

                if (response.isSuccessful) {
                    val accessData = response.body()?.data
                    _serverAccessStatus.value = accessData

                    if (accessData?.isSubscribed == true || accessData?.isInTrial == true) {
                        val type = when {
                            accessData.productId?.contains("yearly") == true -> SubscriptionType.YEARLY
                            else -> SubscriptionType.MONTHLY
                        }
                        _subscriptionState.value = SubscriptionState.Subscribed(type, null)
                    }

                    Log.d(TAG, "Access status refreshed: hasAccess=${accessData?.hasAccess}")
                } else {
                    Log.e(TAG, "Failed to refresh access status: ${response.code()}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error refreshing access status", e)
            }
        }
    }

    fun hasServerVerifiedAccess(): Boolean = _serverAccessStatus.value?.hasAccess == true

    /**
     * Check if user can use AI features (server-authoritative, fail-closed)
     */
    fun canUseAI(): Boolean {
        if (_deviceTrialExpired.value && !isSubscribed()) return false
        val serverStatus = _serverAccessStatus.value
        if (serverStatus != null) {
            return serverStatus.features?.canUseAI == true || serverStatus.hasAccess
        }
        return isSubscribed()
    }

    /**
     * Check if user can generate podcasts (server-authoritative, fail-closed)
     */
    fun canGeneratePodcasts(): Boolean {
        if (_deviceTrialExpired.value && !isSubscribed()) return false
        val serverStatus = _serverAccessStatus.value
        if (serverStatus != null) {
            return serverStatus.features?.canGeneratePodcasts == true ||
                    serverStatus.isSubscribed ||
                    serverStatus.isInTrial
        }
        return isSubscribed()
    }

    /**
     * Check if user can export notes (server-authoritative, fail-closed)
     */
    fun canExportNotes(): Boolean {
        if (_deviceTrialExpired.value && !isSubscribed()) return false
        val serverStatus = _serverAccessStatus.value
        if (serverStatus != null) {
            return serverStatus.features?.canExportNotes == true ||
                    serverStatus.isSubscribed ||
                    serverStatus.isInTrial
        }
        return isSubscribed()
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

                val response = RetrofitClient.apiService.recordSubscriptionEvent("Bearer $token", request)

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
