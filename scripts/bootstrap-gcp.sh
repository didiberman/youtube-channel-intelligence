#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-didiberman}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-youtube-channel-intelligence}"
RUNTIME_SA="youtube-monitor-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="youtube-monitor-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtasks.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  youtube.googleapis.com

gcloud artifacts repositories describe youtube-intelligence \
  --location="${REGION}" >/dev/null 2>&1 ||
  gcloud artifacts repositories create youtube-intelligence \
    --repository-format=docker \
    --location="${REGION}"

gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create youtube-monitor-runtime

gcloud iam service-accounts describe "${SCHEDULER_SA}" >/dev/null 2>&1 ||
  gcloud iam service-accounts create youtube-monitor-scheduler

for role in roles/datastore.user roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="${role}" >/dev/null
done

gcloud tasks queues describe transcript-retries \
  --location="${REGION}" >/dev/null 2>&1 ||
  gcloud tasks queues create transcript-retries \
    --location="${REGION}" \
    --max-concurrent-dispatches=2 \
    --max-attempts=5

gcloud tasks queues update transcript-retries \
  --location="${REGION}" \
  --max-concurrent-dispatches=2 \
  --max-attempts=5

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudtasks.enqueuer" >/dev/null

gcloud iam service-accounts add-iam-policy-binding "${SCHEDULER_SA}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

echo "Create these Secret Manager secrets before deployment:"
echo "  youtube-api-key"
echo "  supadata-api-key"
echo "  telegram-bot-token"
echo "  openrouter-api-key"
echo "  allowed-emails"
echo "  scheduler-audience (the final Cloud Run service URL)"
echo
echo "Then run: gcloud builds submit --config cloudbuild.yaml"
echo "After deployment, run: ./scripts/create-scheduler.sh"
