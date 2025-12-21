package com.kreativekoala.scribeai.utils

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.NumberFormat
import java.util.Currency

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
}