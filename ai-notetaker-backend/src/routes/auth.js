// auth.js - Authentication routes for web app
// Handles email/password auth, Google Sign-In, and Apple Sign-In

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const { authenticate } = require('../middleware/auth');

// Initialize Supabase admin client
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/register
 * Register a new user with email and password
 */
router.post('/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            error: 'Password must be at least 6 characters'
        });
    }

    try {
        // Create user with Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto-confirm email for now
            user_metadata: {
                name: name || email.split('@')[0],
                source: 'web'
            }
        });

        if (authError) {
            console.error('Registration error:', authError);

            if (authError.message?.includes('already registered')) {
                return res.status(409).json({
                    success: false,
                    error: 'An account with this email already exists'
                });
            }

            return res.status(400).json({
                success: false,
                error: authError.message || 'Registration failed'
            });
        }

        // Create a session for the user
        const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.signInWithPassword({
            email,
            password
        });

        if (sessionError) {
            console.error('Session creation error:', sessionError);
            // User was created but session failed - they can still log in
            return res.status(201).json({
                success: true,
                message: 'Account created. Please sign in.',
                user: {
                    id: authData.user.id,
                    email: authData.user.email,
                    name: authData.user.user_metadata?.name
                }
            });
        }

        // Create profile in profiles table
        await supabaseAdmin.from('profiles').upsert({
            id: authData.user.id,
            email: authData.user.email,
            name: name || email.split('@')[0],
            created_at: new Date().toISOString()
        });

        res.status(201).json({
            success: true,
            token: sessionData.session.access_token,
            user: {
                id: authData.user.id,
                email: authData.user.email,
                name: authData.user.user_metadata?.name
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/login
 * Sign in with email and password
 */
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Email and password are required'
        });
    }

    try {
        const { data, error } = await supabaseAdmin.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error('Login error:', error);

            if (error.message?.includes('Invalid login credentials')) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid email or password'
                });
            }

            return res.status(401).json({
                success: false,
                error: error.message || 'Login failed'
            });
        }

        // Get or create profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        res.status(200).json({
            success: true,
            token: data.session.access_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                name: profile?.name || data.user.user_metadata?.name || data.user.email.split('@')[0]
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/google
 * Sign in or register with Google
 */
router.post('/google', async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({
            success: false,
            error: 'Google ID token is required'
        });
    }

    try {
        // Verify the Google ID token
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: [
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_WEB_CLIENT_ID,
                process.env.GOOGLE_IOS_CLIENT_ID,
                process.env.GOOGLE_ANDROID_CLIENT_ID
            ].filter(Boolean)
        });

        const payload = ticket.getPayload();
        const { email, name, sub: googleId, picture } = payload;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email not provided by Google'
            });
        }

        // Check if user already exists using RPC function
        let userId;

        // Use RPC function to lookup user by email (much more reliable than listUsers)
        const { data: existingUserData, error: lookupError } = await supabaseAdmin.rpc(
            'get_user_id_by_email',
            { user_email: email }
        );

        if (lookupError) {
            console.log('RPC lookup error (may not exist yet):', lookupError.message);
        }

        const existingUserId = existingUserData?.[0]?.id;

        if (existingUserId) {
            // User exists - update and proceed
            userId = existingUserId;
            console.log('Found existing user via RPC:', userId);

            // Update user metadata with Google info
            await supabaseAdmin.auth.admin.updateUserById(userId, {
                user_metadata: {
                    name,
                    avatar_url: picture,
                    provider: 'google',
                    google_id: googleId
                }
            });

            // Update/create profile
            await supabaseAdmin.from('profiles').upsert({
                id: userId,
                email,
                name,
                avatar_url: picture,
                updated_at: new Date().toISOString()
            });

        } else {
            // User doesn't exist - create new user
            const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: true,
                user_metadata: {
                    name,
                    avatar_url: picture,
                    provider: 'google',
                    google_id: googleId,
                    source: 'web'
                }
            });

            if (createError) {
                console.error('Error creating Google user:', createError);

                // If email_exists, try RPC again (race condition)
                if (createError.code === 'email_exists' || createError.message?.includes('already been registered')) {
                    const { data: retryData } = await supabaseAdmin.rpc('get_user_id_by_email', { user_email: email });
                    if (retryData?.[0]?.id) {
                        userId = retryData[0].id;
                        console.log('Found user on retry:', userId);
                    } else {
                        return res.status(500).json({
                            success: false,
                            error: 'Account exists but could not be accessed'
                        });
                    }
                } else {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create account'
                    });
                }
            } else {
                // New user created successfully
                userId = newUser.user.id;
                console.log('Created new user:', userId);

                // Create profile
                await supabaseAdmin.from('profiles').upsert({
                    id: userId,
                    email,
                    name,
                    avatar_url: picture,
                    created_at: new Date().toISOString()
                });
            }
        }

        // Generate a proper JWT token for the user using our own JWT signing
        // This creates a token that can be verified by our middleware
        const jwt = require('jsonwebtoken');
        const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;

        // Create a JWT token that matches what Supabase expects
        const token = jwt.sign(
            {
                sub: userId,
                email: email,
                role: 'authenticated',
                aud: 'authenticated',
                user_metadata: {
                    name,
                    avatar_url: picture,
                    provider: 'google'
                }
            },
            jwtSecret,
            { expiresIn: '7d' }
        );

        console.log('Generated JWT token for user:', userId);

        // Return the token and user info
        res.status(200).json({
            success: true,
            token: token,
            user: {
                id: userId,
                email,
                name,
                avatar_url: picture
            },
            provider: 'google'
        });

    } catch (error) {
        console.error('Google auth error:', error);

        if (error.message?.includes('Token used too late') || error.message?.includes('Token used too early')) {
            return res.status(401).json({
                success: false,
                error: 'Google token expired. Please try again.'
            });
        }

        if (error.message?.includes('Wrong recipient')) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Google client configuration'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Google authentication failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/apple
 * Sign in or register with Apple
 */
router.post('/apple', async (req, res) => {
    const { idToken, authorizationCode, user: appleUser } = req.body;

    if (!idToken && !authorizationCode) {
        return res.status(400).json({
            success: false,
            error: 'Apple ID token or authorization code is required'
        });
    }

    try {
        // Apple Sign-In verification
        // For web, we typically use the authorization code
        // The idToken contains the user info (email, sub, etc.)

        // Decode the JWT to get user info (basic validation)
        // Note: In production, you should verify the signature with Apple's public key
        let payload;
        if (idToken) {
            const parts = idToken.split('.');
            if (parts.length === 3) {
                payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            }
        }

        const email = payload?.email || appleUser?.email;
        const appleUserId = payload?.sub;
        const name = appleUser?.name?.firstName
            ? `${appleUser.name.firstName} ${appleUser.name.lastName || ''}`.trim()
            : null;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email not provided by Apple. Please ensure you shared your email.'
            });
        }

        // Check if user exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(u => u.email === email);

        let userId;

        if (existingUser) {
            userId = existingUser.id;

            // Update user metadata if we have a name (Apple only provides it on first sign-in)
            if (name) {
                await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
                    user_metadata: {
                        name,
                        provider: 'apple',
                        apple_id: appleUserId
                    }
                });
            }
        } else {
            // Create new user
            const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: true,
                user_metadata: {
                    name: name || email.split('@')[0],
                    provider: 'apple',
                    apple_id: appleUserId,
                    source: 'web'
                }
            });

            if (createError) {
                console.error('Error creating Apple user:', createError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create account'
                });
            }

            userId = newUser.user.id;

            // Create profile
            await supabaseAdmin.from('profiles').upsert({
                id: userId,
                email,
                name: name || email.split('@')[0],
                created_at: new Date().toISOString()
            });
        }

        // Generate session token
        const { data: tokenData } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email
        });

        res.status(200).json({
            success: true,
            token: tokenData?.properties?.hashed_token || userId,
            user: {
                id: userId,
                email,
                name: name || email.split('@')[0]
            },
            provider: 'apple'
        });

    } catch (error) {
        console.error('Apple auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Apple authentication failed. Please try again.'
        });
    }
});

/**
 * GET /api/auth/profile
 * Get current user profile
 */
router.get('/profile', authenticate, async (req, res) => {
    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', req.userId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
            console.error('Profile fetch error:', error);
        }

        res.status(200).json({
            success: true,
            user: {
                id: req.userId,
                email: req.userEmail,
                name: profile?.name || req.user?.user_metadata?.name,
                avatar_url: profile?.avatar_url || req.user?.user_metadata?.avatar_url,
                created_at: profile?.created_at || req.user?.created_at
            }
        });

    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

/**
 * POST /api/auth/refresh
 * Refresh the access token
 */
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({
            success: false,
            error: 'Refresh token is required'
        });
    }

    try {
        const { data, error } = await supabaseAdmin.auth.refreshSession({
            refresh_token: refreshToken
        });

        if (error) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired refresh token'
            });
        }

        res.status(200).json({
            success: true,
            token: data.session.access_token,
            refreshToken: data.session.refresh_token
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh token'
        });
    }
});

/**
 * POST /api/auth/logout
 * Sign out the user
 */
router.post('/logout', authenticate, async (req, res) => {
    try {
        // Invalidate the session on Supabase side
        await supabaseAdmin.auth.admin.signOut(req.token);

        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });

    } catch (error) {
        // Even if server-side logout fails, client should clear local state
        console.error('Logout error:', error);
        res.status(200).json({
            success: true,
            message: 'Logged out'
        });
    }
});

module.exports = router;
