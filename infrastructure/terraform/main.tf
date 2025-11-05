# infrastructure/terraform/main.tf
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Variables
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

# Enable required APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "speech.googleapis.com",
    "texttospeech.googleapis.com",
    "pubsub.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  
  project = var.project_id
  service = each.key
  
  disable_on_destroy = false
}

# Cloud Storage Buckets
resource "google_storage_bucket" "audio" {
  name          = "notetaker-audio-${var.environment}"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 1
      matches_prefix = ["temp/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket" "generated" {
  name          = "notetaker-generated-${var.environment}"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
}

# Firestore Database
resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
}

# Pub/Sub Topics and Subscriptions
resource "google_pubsub_topic" "transcription_requests" {
  name = "transcription-requests"
}

resource "google_pubsub_subscription" "transcription_requests" {
  name  = "transcription-requests-sub"
  topic = google_pubsub_topic.transcription_requests.name

  ack_deadline_seconds = 600

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic" "generation_jobs" {
  name = "generation-jobs"
}

resource "google_pubsub_subscription" "generation_jobs" {
  name  = "generation-jobs-sub"
  topic = google_pubsub_topic.generation_jobs.name

  ack_deadline_seconds = 600

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

resource "google_pubsub_topic" "dead_letter" {
  name = "dead-letter-topic"
}

# Cloud Run Services (placeholders - actual deployment via Cloud Build)
resource "google_cloud_run_service" "recording" {
  name     = "recording-service"
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/recording-service:latest"
        
        resources {
          limits = {
            cpu    = "2000m"
            memory = "2Gi"
          }
        }

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "AUDIO_BUCKET"
          value = google_storage_bucket.audio.name
        }
      }

      service_account_name = google_service_account.recording.email
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "0"
        "autoscaling.knative.dev/maxScale" = "20"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_service" "generation" {
  name     = "generation-service"
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/generation-service:latest"
        
        resources {
          limits = {
            cpu    = "2000m"
            memory = "4Gi"
          }
        }

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "GENERATED_BUCKET"
          value = google_storage_bucket.generated.name
        }
      }

      service_account_name = google_service_account.generation.email
      timeout_seconds      = 600
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "0"
        "autoscaling.knative.dev/maxScale" = "10"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [google_project_service.apis]
}

# IAM - Service Accounts
resource "google_service_account" "recording" {
  account_id   = "recording-service"
  display_name = "Recording Service Account"
}

resource "google_service_account" "generation" {
  account_id   = "generation-service"
  display_name = "Generation Service Account"
}

# IAM - Roles for Recording Service
resource "google_storage_bucket_iam_member" "recording_audio" {
  bucket = google_storage_bucket.audio.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.recording.email}"
}

resource "google_project_iam_member" "recording_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.recording.email}"
}

resource "google_project_iam_member" "recording_pubsub" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.recording.email}"
}

resource "google_project_iam_member" "recording_speech" {
  project = var.project_id
  role    = "roles/speech.client"
  member  = "serviceAccount:${google_service_account.recording.email}"
}

# IAM - Roles for Generation Service
resource "google_storage_bucket_iam_member" "generation_audio" {
  bucket = google_storage_bucket.audio.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.generation.email}"
}

resource "google_storage_bucket_iam_member" "generation_generated" {
  bucket = google_storage_bucket.generated.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.generation.email}"
}

resource "google_project_iam_member" "generation_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.generation.email}"
}

resource "google_project_iam_member" "generation_tts" {
  project = var.project_id
  role    = "roles/texttospeech.client"
  member  = "serviceAccount:${google_service_account.generation.email}"
}

# Cloud Run IAM - Allow unauthenticated (for testing, remove in production)
resource "google_cloud_run_service_iam_member" "recording_noauth" {
  location = google_cloud_run_service.recording.location
  project  = google_cloud_run_service.recording.project
  service  = google_cloud_run_service.recording.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "generation_noauth" {
  location = google_cloud_run_service.generation.location
  project  = google_cloud_run_service.generation.project
  service  = google_cloud_run_service.generation.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Outputs
output "recording_service_url" {
  value = google_cloud_run_service.recording.status[0].url
}

output "generation_service_url" {
  value = google_cloud_run_service.generation.status[0].url
}

output "audio_bucket_name" {
  value = google_storage_bucket.audio.name
}

output "generated_bucket_name" {
  value = google_storage_bucket.generated.name
}