// userRoutes.js
// Account management routes including account deletion (Apple requirement 5.1.1)

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authenticate } = require('../middleware/auth');
const { deleteAccount } = require('../services/accountDeletionService');

// Initialize Supabase admin client (uses service role key for admin operations)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// All routes require authentication
router.use(authenticate);

/**
 * DELETE /api/user/delete-account
 * 
 * Permanently deletes the user's account and all associated data.
 * Required by Apple App Store guidelines 5.1.1
 * 
 * See services/accountDeletionService.js for the order. Responds 200 only when the
 * Supabase auth user is actually gone; otherwise 500 so the app keeps the session
 * and the user can retry.
 */
router.delete('/delete-account', async (req, res) => {
    const userId = req.userId;

    console.log(`Starting account deletion for user: ${userId}`);

    try {
        const result = await deleteAccount(supabaseAdmin, userId, console);

        if (!result.ok) {
            // The auth user (or a table in front of it) is still there: do not tell the app it can sign the user out.
            console.error(`Account deletion incomplete for user ${userId}; failed: ${result.failedSteps.join(', ')}`);
            return res.status(500).json({
                success: false,
                code: 'ACCOUNT_DELETION_INCOMPLETE',
                error: 'We could not finish deleting your account. Nothing further was lost; please try again, or contact support if it keeps failing.'
            });
        }

        if (result.warnings.length > 0) {
            console.warn(`Account deleted for user ${userId} with warnings: ${result.warnings.join(', ')}`);
        }
        console.log(`Account deletion completed for user: ${userId}`);

        res.status(200).json({
            success: true,
            message: 'Account and all associated data have been permanently deleted.'
        });

    } catch (error) {
        console.error('Account deletion error:', error);
        res.status(500).json({
            success: false,
            code: 'ACCOUNT_DELETION_INCOMPLETE',
            error: 'Failed to delete account. Please try again or contact support.'
        });
    }
});

/**
 * GET /api/user/data-export
 * 
 * Export all user data (optional - good practice for GDPR compliance)
 */
router.get('/data-export', async (req, res) => {
    const userId = req.userId;
    
    console.log(`📦 Starting data export for user: ${userId}`);
    
    try {
        // Get user profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        // Get all notes
        const { data: notes } = await supabaseAdmin
            .from('notes')
            .select('*')
            .eq('user_id', userId);
        
        // Get all recordings (metadata only, not actual files)
        const { data: recordings } = await supabaseAdmin
            .from('recordings')
            .select('id, title, duration, format, status, created_at')
            .eq('user_id', userId);
        
        // Get AI content
        const { data: aiContent } = await supabaseAdmin
            .from('ai_content')
            .select('*')
            .eq('user_id', userId);
        
        const exportData = {
            exportDate: new Date().toISOString(),
            profile,
            notes: notes || [],
            recordings: recordings || [],
            aiContent: aiContent || []
        };
        
        console.log(`✅ Data export completed for user: ${userId}`);
        
        res.status(200).json({
            success: true,
            data: exportData
        });
        
    } catch (error) {
        console.error('❌ Data export error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export data. Please try again.'
        });
    }
});

module.exports = router;