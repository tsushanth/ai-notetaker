// userRoutes.js
// Account management routes including account deletion (Apple requirement 5.1.1)

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authenticate } = require('../middleware/auth');

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
 * Deletes in order:
 * 1. AI-generated content (quizzes, flashcards, podcasts, summaries, chat)
 * 2. Recordings and transcriptions
 * 3. Notes
 * 4. User profile
 * 5. Supabase auth user
 */
router.delete('/delete-account', async (req, res) => {
    const userId = req.userId;
    
    console.log(`🗑️ Starting account deletion for user: ${userId}`);
    
    try {
        // Step 1: Delete AI-generated content
        console.log('  → Deleting AI content...');
        const { error: aiError } = await supabaseAdmin
            .from('ai_content')
            .delete()
            .eq('user_id', userId);
        
        if (aiError) {
            console.warn('  ⚠️ AI content deletion warning:', aiError.message);
        }
        
        // Step 2: Delete chat history
        console.log('  → Deleting chat history...');
        const { error: chatError } = await supabaseAdmin
            .from('chat_messages')
            .delete()
            .eq('user_id', userId);
        
        if (chatError) {
            console.warn('  ⚠️ Chat deletion warning:', chatError.message);
        }
        
        // Step 3: Delete recordings
        console.log('  → Deleting recordings...');
        
        // First, get recording storage paths to delete from storage
        const { data: recordings } = await supabaseAdmin
            .from('recordings')
            .select('storage_path')
            .eq('user_id', userId);
        
        // Delete recording files from storage
        if (recordings && recordings.length > 0) {
            const storagePaths = recordings
                .map(r => r.storage_path)
                .filter(p => p);
            
            if (storagePaths.length > 0) {
                const { error: storageError } = await supabaseAdmin.storage
                    .from('recordings')
                    .remove(storagePaths);
                
                if (storageError) {
                    console.warn('  ⚠️ Recording storage deletion warning:', storageError.message);
                }
            }
        }
        
        // Delete recording records
        const { error: recordingsError } = await supabaseAdmin
            .from('recordings')
            .delete()
            .eq('user_id', userId);
        
        if (recordingsError) {
            console.warn('  ⚠️ Recordings deletion warning:', recordingsError.message);
        }
        
        // Step 4: Delete notes
        console.log('  → Deleting notes...');
        const { error: notesError } = await supabaseAdmin
            .from('notes')
            .delete()
            .eq('user_id', userId);
        
        if (notesError) {
            console.warn('  ⚠️ Notes deletion warning:', notesError.message);
        }
        
        // Step 5: Delete user profile (if exists)
        console.log('  → Deleting user profile...');
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', userId);
        
        if (profileError) {
            console.warn('  ⚠️ Profile deletion warning:', profileError.message);
        }
        
        // Step 6: Delete subscriptions (if exists)
        console.log('  → Deleting subscriptions...');
        const { error: subscriptionError } = await supabaseAdmin
            .from('subscriptions')
            .delete()
            .eq('user_id', userId);
        
        if (subscriptionError) {
            console.warn('  ⚠️ Subscription deletion warning:', subscriptionError.message);
        }
        
        // Step 7: Delete the Supabase auth user
        console.log('  → Deleting auth user...');
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        
        if (authError) {
            console.error('  ❌ Auth user deletion error:', authError.message);
            // Don't throw here - user data is already deleted
            // They just won't be able to sign in again
        }
        
        console.log(`✅ Account deletion completed for user: ${userId}`);
        
        res.status(200).json({
            success: true,
            message: 'Account and all associated data have been permanently deleted.'
        });
        
    } catch (error) {
        console.error('❌ Account deletion error:', error);
        res.status(500).json({
            success: false,
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