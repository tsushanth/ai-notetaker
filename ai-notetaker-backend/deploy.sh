#!/bin/bash

echo "🚀 Deploying AI Notetaker Backend with all configurations..."

# Deploy with ALL environment variables AND secrets
gcloud run deploy ai-notetaker-backend \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --timeout 300 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10 \
  --set-env-vars "\
NODE_ENV=production,\
SUPABASE_URL=https://shufmkocfnjnlwshqrue.supabase.co,\
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNodWZta29jZm5qbmx3c2hxcnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNzkzMTksImV4cCI6MjA3Nzg1NTMxOX0.WPmgPldx4bt82JCr7K-20-z-53q8926qtDV5rLMSAnw,\
ALLOWED_ORIGINS=*,\
GCP_PROJECT_ID=summarizerproxy,\
GCP_REGION=us-central1,\
MAX_FILE_SIZE=52428800,\
MAX_AUDIO_DURATION=7200,\
RATE_LIMIT_WINDOW=900000,\
RATE_LIMIT_MAX_REQUESTS=100,\
SUPABASE_STORAGE_BUCKET=notetaker-files,\
SUPADATA_API_KEY=sd_0b7684da5e57fc89456c63eef5b79458" \
  --set-secrets="\
OPENAI_API_KEY=openai-key:latest,\
SUPABASE_SERVICE_KEY=supabase-service-key:latest,\
YOUTUBE_COOKIES=youtube-cookies:latest"

if [ $? -eq 0 ]; then
  echo "✅ Deployment successful!"
  echo ""
  echo "Service URL:"
  gcloud run services describe ai-notetaker-backend --region us-central1 --format='value(status.url)'
else
  echo "❌ Deployment failed!"
  exit 1
fi