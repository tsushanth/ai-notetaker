#!/bin/bash

# AI Notetaker Backend - Deployment Script
# This script builds and deploys the backend to GCP Cloud Run

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== AI Notetaker Backend Deployment ===${NC}"
echo ""

# Load environment variables from .env file
if [ -f .env ]; then
    echo -e "${GREEN}Loading environment variables from .env file...${NC}"
    export $(grep -v '^#' .env | xargs)
else
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file from .env.example"
    exit 1
fi

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="ai-notetaker-backend"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Check if required environment variables are set
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: GCP_PROJECT_ID not set in .env file${NC}"
    exit 1
fi

if [ -z "$SUPABASE_URL" ]; then
    echo -e "${RED}Error: SUPABASE_URL not set in .env file${NC}"
    exit 1
fi

if [ -z "$SUPABASE_ANON_KEY" ]; then
    echo -e "${RED}Error: SUPABASE_ANON_KEY not set in .env file${NC}"
    exit 1
fi

# Clean ALLOWED_ORIGINS (remove trailing commas and spaces)
ALLOWED_ORIGINS=$(echo "$ALLOWED_ORIGINS" | sed 's/,*$//' | sed 's/^,*//')
if [ -z "$ALLOWED_ORIGINS" ]; then
    ALLOWED_ORIGINS="*"
fi

echo -e "${YELLOW}Project ID: ${PROJECT_ID}${NC}"
echo -e "${YELLOW}Region: ${REGION}${NC}"
echo -e "${YELLOW}Service Name: ${SERVICE_NAME}${NC}"
echo -e "${YELLOW}Supabase URL: ${SUPABASE_URL}${NC}"
echo -e "${YELLOW}Allowed Origins: ${ALLOWED_ORIGINS}${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set the project
echo -e "${GREEN}Setting GCP project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${GREEN}Enabling required GCP APIs...${NC}"
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com

# Build the container image
echo -e "${GREEN}Building Docker image...${NC}"
gcloud builds submit --tag $IMAGE_NAME

# Check if secrets exist, if not create them
echo -e "${GREEN}Checking and creating secrets...${NC}"

check_and_create_secret() {
    local secret_name=$1
    local secret_value=$2
    
    if gcloud secrets describe $secret_name &> /dev/null; then
        echo -e "${GREEN}✓ Secret '$secret_name' exists${NC}"
    else
        echo -e "${YELLOW}Creating secret '$secret_name'...${NC}"
        echo -n "$secret_value" | gcloud secrets create $secret_name --data-file=-
        echo -e "${GREEN}✓ Secret '$secret_name' created${NC}"
    fi
}

# Create secrets from .env
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OPENAI_API_KEY not set in .env file${NC}"
    exit 1
fi

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo -e "${RED}Error: SUPABASE_SERVICE_KEY not set in .env file${NC}"
    exit 1
fi

check_and_create_secret "openai-key" "$OPENAI_API_KEY"
check_and_create_secret "supabase-service-key" "$SUPABASE_SERVICE_KEY"

# Grant access to secrets
echo -e "${GREEN}Granting access to secrets...${NC}"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")

gcloud secrets add-iam-policy-binding openai-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None 2>/dev/null || true

gcloud secrets add-iam-policy-binding supabase-service-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None 2>/dev/null || true

# Deploy to Cloud Run
echo -e "${GREEN}Deploying to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --min-instances 0 \
  --set-env-vars "NODE_ENV=production,SUPABASE_URL=${SUPABASE_URL},SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY},ALLOWED_ORIGINS=${ALLOWED_ORIGINS},GCP_PROJECT_ID=${PROJECT_ID},GCP_REGION=${REGION},MAX_FILE_SIZE=${MAX_FILE_SIZE:-52428800},MAX_AUDIO_DURATION=${MAX_AUDIO_DURATION:-7200},RATE_LIMIT_WINDOW=${RATE_LIMIT_WINDOW:-900000},RATE_LIMIT_MAX_REQUESTS=${RATE_LIMIT_MAX_REQUESTS:-100},SUPABASE_STORAGE_BUCKET=${SUPABASE_STORAGE_BUCKET:-notetaker-files}" \
  --set-secrets "OPENAI_API_KEY=openai-key:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       🎉 DEPLOYMENT SUCCESSFUL! 🎉            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Service URL: ${SERVICE_URL}${NC}"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo ""
echo -e "1️⃣  Test the health endpoint:"
echo -e "   ${GREEN}curl ${SERVICE_URL}/health${NC}"
echo ""
echo -e "2️⃣  View logs:"
echo -e "   ${GREEN}gcloud run services logs read $SERVICE_NAME --region $REGION${NC}"
echo ""
echo -e "3️⃣  View service details:"
echo -e "   ${GREEN}gcloud run services describe $SERVICE_NAME --region $REGION${NC}"
echo ""
echo -e "4️⃣  Update your frontend to use this URL:"
echo -e "   ${GREEN}API_URL=${SERVICE_URL}${NC}"
echo ""
echo -e "${YELLOW}🔐 Make sure you've set up Supabase:${NC}"
echo -e "   • Run setup-supabase-safe.sql in Supabase SQL Editor"
echo -e "   • Create storage bucket 'notetaker-files'"
echo -e "   • Configure storage policies"
echo ""
