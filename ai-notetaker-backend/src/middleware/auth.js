const { supabase } = require('../config/supabase');
const { logger } = require('../utils/logger');

/**
 * Middleware to authenticate requests using Supabase JWT
 * Enhanced with better token validation and error handling
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

    // Verify the JWT token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      // Log specific Supabase auth errors
      logger.warn('Supabase authentication failed', {
        path: req.path,
        method: req.method,
        error: error.message,
        errorCode: error.code,
        errorStatus: error.status,
        ip: req.ip
      });

      // Handle specific error cases
      if (error.message?.includes('expired')) {
        return res.status(401).json({
          success: false,
          error: 'Token expired'
        });
      }

      if (error.message?.includes('invalid') || error.message?.includes('malformed')) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }

      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    if (!user) {
      logger.warn('Authentication failed: No user found', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Attach user to request object
    req.user = user;
    req.userId = user.id;
    req.userEmail = user.email;

    // Log successful authentication (debug level)
    logger.debug('Authentication successful', {
      userId: req.userId,
      email: req.userEmail,
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
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (!error && user) {
        req.user = user;
        req.userId = user.id;
        req.userEmail = user.email;
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