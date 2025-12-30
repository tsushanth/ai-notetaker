/**
 * Environment Variable Validation
 *
 * This module validates all required environment variables at startup.
 * The server will fail to start if any required variables are missing,
 * preventing partial deployments that could break functionality.
 */

const requiredEnvVars = [
  // Core Infrastructure
  { name: 'NODE_ENV', description: 'Environment (production/development)' },

  // Supabase Configuration
  { name: 'SUPABASE_URL', description: 'Supabase project URL' },
  { name: 'SUPABASE_ANON_KEY', description: 'Supabase anonymous/public key' },
  { name: 'SUPABASE_SERVICE_KEY', description: 'Supabase service role key (admin)' },

  // Authentication
  { name: 'JWT_SECRET', description: 'Secret for signing custom JWT tokens' },

  // Google OAuth - All client IDs for multi-platform support
  { name: 'GOOGLE_CLIENT_ID', description: 'Primary Google OAuth client ID' },
  { name: 'GOOGLE_WEB_CLIENT_ID', description: 'Google OAuth client ID for web app' },
  { name: 'GOOGLE_IOS_CLIENT_ID', description: 'Google OAuth client ID for iOS app' },
  { name: 'GOOGLE_ANDROID_CLIENT_ID', description: 'Google OAuth client ID for Android app' },

  // OpenAI
  { name: 'OPENAI_API_KEY', description: 'OpenAI API key for AI features' },

  // YouTube transcript fallback - essential for videos without native captions
  { name: 'SUPADATA_API_KEY', description: 'Supadata API key for YouTube transcript fallback' },

  // Stripe - Required for web subscriptions
  { name: 'STRIPE_SECRET_KEY', description: 'Stripe secret key for payment processing' },
  { name: 'STRIPE_PRICE_MONTHLY', description: 'Stripe price ID for monthly subscription' },
  { name: 'STRIPE_PRICE_YEARLY', description: 'Stripe price ID for yearly subscription' },
];

const optionalEnvVars = [
  // GCP Configuration
  { name: 'GCP_PROJECT_ID', description: 'Google Cloud project ID', default: '' },
  { name: 'GCP_REGION', description: 'Google Cloud region', default: 'us-central1' },

  // CORS
  { name: 'ALLOWED_ORIGINS', description: 'Allowed CORS origins', default: '*' },

  // Rate Limiting
  { name: 'RATE_LIMIT_WINDOW', description: 'Rate limit window in ms', default: '900000' },
  { name: 'RATE_LIMIT_MAX_REQUESTS', description: 'Max requests per window', default: '100' },
  { name: 'RATE_LIMIT_ALLOWLIST', description: 'IPs to bypass rate limiting', default: '' },
  { name: 'RATE_LIMIT_DISABLED', description: 'Disable rate limiting', default: 'false' },

  // File Upload Limits
  { name: 'MAX_FILE_SIZE', description: 'Max file upload size in bytes', default: '52428800' },
  { name: 'MAX_AUDIO_DURATION', description: 'Max audio duration in seconds', default: '7200' },

  // Storage
  { name: 'SUPABASE_STORAGE_BUCKET', description: 'Supabase storage bucket name', default: 'notetaker-files' },

  // External Services
  { name: 'YOUTUBE_COOKIES', description: 'YouTube cookies for yt-dlp', default: '' },
  { name: 'SUPADATA_API_KEY', description: 'Supadata API key', default: '' },

  // Alerts
  { name: 'ALERT_EMAIL_PASS', description: 'Email password for alerts', default: '' },

  // Stripe webhook secret (optional but recommended for production)
  { name: 'STRIPE_WEBHOOK_SECRET', description: 'Stripe webhook signing secret', default: '' },
  { name: 'STRIPE_PUBLISHABLE_KEY', description: 'Stripe publishable key (for client)', default: '' },
];

/**
 * Validates all required environment variables
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function validateEnv() {
  const missing = [];
  const warnings = [];
  const present = [];

  // Check required variables
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar.name];
    if (!value || value.trim() === '') {
      missing.push(`${envVar.name} - ${envVar.description}`);
    } else {
      present.push(envVar.name);
    }
  }

  // Check optional variables and set defaults
  for (const envVar of optionalEnvVars) {
    const value = process.env[envVar.name];
    if (!value || value.trim() === '') {
      if (envVar.default !== '') {
        process.env[envVar.name] = envVar.default;
        warnings.push(`${envVar.name} not set, using default: "${envVar.default}"`);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    present
  };
}

/**
 * Validates environment and exits if validation fails
 * Call this at the very start of the application
 */
function validateEnvOrExit() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Environment Variable Validation                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const result = validateEnv();

  // Log present variables (without values for security)
  console.log('\n✅ Required variables present:');
  for (const name of result.present) {
    // Mask the value for security
    const value = process.env[name];
    const masked = value.length > 8
      ? value.substring(0, 4) + '****' + value.substring(value.length - 4)
      : '****';
    console.log(`   • ${name}: ${masked}`);
  }

  // Log warnings for optional variables
  if (result.warnings.length > 0) {
    console.log('\n⚠️  Optional variables using defaults:');
    for (const warning of result.warnings) {
      console.log(`   • ${warning}`);
    }
  }

  // If validation failed, log errors and exit
  if (!result.valid) {
    console.error('\n❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
    console.error('════════════════════════════════════════════════════════════');
    for (const missing of result.missing) {
      console.error(`   ✗ ${missing}`);
    }
    console.error('════════════════════════════════════════════════════════════');
    console.error('\n🛑 Server startup BLOCKED due to missing configuration.');
    console.error('   Please set all required environment variables and restart.\n');
    console.error('   For Cloud Run deployments, use:');
    console.error('   gcloud run services update SERVICE_NAME --update-env-vars="VAR=value"');
    console.error('   or --update-secrets="VAR=secret:version" for sensitive values\n');

    // Exit with error code
    process.exit(1);
  }

  console.log('\n✅ All required environment variables are present.');
  console.log('════════════════════════════════════════════════════════════\n');

  return result;
}

/**
 * Get a summary of all configured environment variables
 * Useful for debugging and health checks
 */
function getEnvSummary() {
  const summary = {
    required: {},
    optional: {}
  };

  for (const envVar of requiredEnvVars) {
    summary.required[envVar.name] = {
      present: !!process.env[envVar.name],
      description: envVar.description
    };
  }

  for (const envVar of optionalEnvVars) {
    summary.optional[envVar.name] = {
      present: !!process.env[envVar.name],
      description: envVar.description,
      usingDefault: !process.env[envVar.name] && envVar.default !== undefined
    };
  }

  return summary;
}

module.exports = {
  validateEnv,
  validateEnvOrExit,
  getEnvSummary,
  requiredEnvVars,
  optionalEnvVars
};
