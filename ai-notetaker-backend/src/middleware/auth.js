const { supabase } = require('../config/supabase');
const { logger } = require('../utils/logger');
const jwt = require('jsonwebtoken');

// JWT secret for custom tokens (Google sign-in)
const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;

/**
 * Middleware to authenticate requests using Supabase JWT or custom JWT
 * Supports both native Supabase tokens (iOS/Android) and custom JWTs (Google sign-in)
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check for authorization header
    if (!authHeader) {
      logger.warn('Authentication failed: No authorization header', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        error: 'No authorization token provided'
      });
    }

    // Check Bearer format
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('Authentication failed: Invalid header format', {
        path: req.path,
        method: req.method,
        headerStart: authHeader.substring(0, 20)
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid authorization header format. Use: Bearer <token>'
      });
    }

    // Extract and validate token
    const token = authHeader.substring(7).trim();

    if (!token) {
      logger.warn('Authentication failed: Empty token', {
        path: req.path,
        method: req.method
      });
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    // Validate JWT format (3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      logger.warn('Authentication failed: Malformed JWT token', {
        path: req.path,
        method: req.method,
        tokenLength: token.length,
        parts: tokenParts.length,
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        error: 'Malformed token - invalid JWT format'
      });
    }

    // Validate each part is not empty and is valid base64
    try {
      tokenParts.forEach((part, index) => {
        if (!part || part.length === 0) {
          throw new Error(`Token segment ${index + 1} is empty`);
        }
        // Validate base64 format (JWT uses base64url encoding)
        if (!/^[A-Za-z0-9_-]+$/.test(part)) {
          throw new Error(`Token segment ${index + 1} has invalid encoding`);
        }
      });
    } catch (validationError) {
      logger.warn('Authentication failed: Invalid token encoding', {
        path: req.path,
        method: req.method,
        error: validationError.message
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid token encoding'
      });
    }

    // Try Supabase authentication first (for native iOS/Android tokens)
    let user = null;
    let authMethod = null;

    const { data: supabaseData, error: supabaseError } = await supabase.auth.getUser(token);

    if (!supabaseError && supabaseData?.user) {
      // Native Supabase token worked
      user = supabaseData.user;
      authMethod = 'supabase';
      logger.debug('Authenticated via Supabase token', { userId: user.id });
    } else {
      // Try custom JWT verification (for Google sign-in tokens)
      try {
        const decoded = jwt.verify(token, jwtSecret);

        if (decoded && decoded.sub) {
          user = {
            id: decoded.sub,
            email: decoded.email,
            user_metadata: decoded.user_metadata || {},
            role: decoded.role || 'authenticated'
          };
          authMethod = 'custom_jwt';
          logger.debug('Authenticated via custom JWT', { userId: user.id, email: user.email });
        }
      } catch (jwtError) {
        // JWT verification failed
        logger.warn('Custom JWT verification failed', {
          path: req.path,
          method: req.method,
          error: jwtError.message
        });
      }
    }

    // If neither auth method worked, return error
    if (!user) {
      logger.warn('Authentication failed: No valid token', {
        path: req.path,
        method: req.method,
        supabaseError: supabaseError?.message,
        ip: req.ip
      });

      // Handle specific error cases from Supabase
      if (supabaseError?.message?.includes('expired')) {
        return res.status(401).json({
          success: false,
          error: 'Token expired'
        });
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // ✅ CRITICAL FIX: Store the token for RLS operations
    // Attach user info AND token to request object
    req.user = {
      ...user,
      token: token  // ← Add raw token to user object
    };
    req.userId = user.id;
    req.userEmail = user.email;
    req.token = token;  // ← Also store at top level for easy access
    req.authMethod = authMethod;

    // Log successful authentication (debug level)
    logger.debug('Authentication successful', {
      userId: req.userId,
      email: req.userEmail,
      authMethod: authMethod,
      hasToken: !!req.token,
      path: req.path,
      method: req.method
    });

    next();
  } catch (error) {
    // Catch any unexpected errors
    logger.error('Unexpected authentication error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });

    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't require it
 * Supports both native Supabase tokens and custom JWTs
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.substring(7).trim();
    const tokenParts = token.split('.');

    // Only proceed if token format looks valid
    if (tokenParts.length === 3) {
      let user = null;
      let authMethod = null;

      // Try Supabase first
      const { data: supabaseData, error: supabaseError } = await supabase.auth.getUser(token);

      if (!supabaseError && supabaseData?.user) {
        user = supabaseData.user;
        authMethod = 'supabase';
      } else {
        // Try custom JWT
        try {
          const decoded = jwt.verify(token, jwtSecret);
          if (decoded && decoded.sub) {
            user = {
              id: decoded.sub,
              email: decoded.email,
              user_metadata: decoded.user_metadata || {},
              role: decoded.role || 'authenticated'
            };
            authMethod = 'custom_jwt';
          }
        } catch (jwtError) {
          // Silently fail for optional auth
        }
      }

      if (user) {
        req.user = {
          ...user,
          token: token
        };
        req.userId = user.id;
        req.userEmail = user.email;
        req.token = token;
        req.authMethod = authMethod;
      }
    }
  } catch (error) {
    // Silently fail for optional auth
    logger.debug('Optional auth failed', { error: error.message });
  }

  next();
};

module.exports = { 
  authenticate,
  optionalAuth
};