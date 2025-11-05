# Database Setup Scripts

This folder contains database setup scripts for Supabase. **Choose the right script for your situation:**

## 📄 Available Scripts

### 1. `setup-supabase.sql` - DESTRUCTIVE (Fresh Install)

**⚠️ WARNING: This script DELETES all existing data!**

**Use this when:**
- ✅ Setting up the database for the **first time**
- ✅ You want to **completely reset** the database
- ✅ You're in a **development environment**
- ✅ You've **backed up your data** and want a clean slate

**What it does:**
- Drops all existing tables (notes, recordings, ai_content, usage_logs)
- Recreates tables with fresh schema
- Drops and recreates all indexes
- Drops and recreates all RLS policies
- Drops and recreates views
- **ALL DATA WILL BE LOST!**

---

### 2. `setup-supabase-safe.sql` - SAFE (Production Updates)

**✅ SAFE: This script preserves your existing data!**

**Use this when:**
- ✅ Updating an **existing database** with new features
- ✅ You're in a **production environment**
- ✅ You want to **keep your existing data**
- ✅ Adding new tables, indexes, or policies
- ✅ You're not sure which script to use (use this one!)

**What it does:**
- Creates tables only if they don't exist (CREATE TABLE IF NOT EXISTS)
- Creates indexes only if they don't exist (CREATE INDEX IF NOT EXISTS)
- Recreates triggers and policies (safe to update)
- Updates views without data loss
- **PRESERVES ALL EXISTING DATA**

---

## 🎯 Quick Decision Guide
```
┌─────────────────────────────────────────────────────────┐
│          Do you have existing data?                     │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
       YES               NO
        │                 │
        ▼                 ▼
┌───────────────┐  ┌──────────────┐
│ Use SAFE      │  │ Use either   │
│ setup-        │  │ (recommend   │
│ supabase-     │  │ SAFE for     │
│ safe.sql      │  │ future-      │
│               │  │ proofing)    │
└───────────────┘  └──────────────┘
```

## 📋 Step-by-Step Setup

### For First-Time Setup (No Existing Data)

1. **Create Supabase Project**
   - Go to https://supabase.com
   - Create a new project
   - Wait for it to initialize

2. **Run the SQL Script**
   - Go to SQL Editor in Supabase Dashboard
   - Copy content from `setup-supabase-safe.sql` (safer choice)
   - Paste and click "Run"

3. **Create Storage Bucket**
   - Go to Storage in Supabase Dashboard
   - Click "New bucket"
   - Name: `notetaker-files`
   - Set to **Private**
   - Click "Create bucket"

4. **Setup Storage Policies**
   - Click on the `notetaker-files` bucket
   - Go to "Policies" tab
   - Add the four policies (SELECT, INSERT, UPDATE, DELETE) as documented in the SQL file

5. **Verify Setup**
   - Check Database > Tables - you should see 4 tables
   - Check Storage - you should see the bucket
   - Check Authentication - enable Email provider if needed

### For Updating Existing Database

1. **Backup Your Data** (just in case)
   - Go to Database > Backups
   - Create a manual backup

2. **Run Safe Migration**
   - Go to SQL Editor
   - Copy content from `setup-supabase-safe.sql`
   - Paste and click "Run"

3. **Verify**
   - Check that your existing data is still there
   - Verify new tables/indexes were created if any

---

## 🛠️ Troubleshooting

### Error: "relation already exists"
- **Solution**: You already have tables. Use `setup-supabase-safe.sql` instead.

### Error: "permission denied"
- **Solution**: Make sure you're running the script in the Supabase SQL Editor with admin privileges.

### Error: "foreign key constraint"
- **Solution**: This happens with `setup-supabase.sql`. The script drops tables in the correct order. Make sure to run the entire script at once.

### Tables created but no data visible
- **Solution**: Check RLS policies are enabled and correctly configured. Make sure you're authenticated as a user.

### Storage bucket not working
- **Solution**: 
  1. Verify bucket is created and named exactly `notetaker-files`
  2. Check storage policies are added correctly
  3. Verify bucket is set to **Private**

---

## �� What Gets Created

### Tables (4)
1. **notes** - Main content storage
2. **recordings** - Audio file metadata
3. **ai_content** - Generated AI content
4. **usage_logs** - API usage tracking

### Indexes (7)
- Performance optimization for common queries

### Triggers (2)
- Auto-update `updated_at` timestamp

### RLS Policies (14)
- Row Level Security for data isolation

### Views (1)
- **user_stats** - Aggregated user statistics

---

## 🚀 Next Steps After Setup

1. ✅ Verify all tables are created
2. ✅ Create storage bucket and policies
3. ✅ Update your `.env` file with Supabase credentials
4. ✅ Deploy your backend to Cloud Run
5. ✅ Test the `/health` endpoint
6. ✅ Create a test user in Supabase Auth
7. ✅ Test authenticated endpoints

---

**Recommendation:** Always use `setup-supabase-safe.sql` unless you specifically need to drop and recreate tables.
