#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-didiberman}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-youtube-channel-intelligence}"
SCHEDULER_SA="youtube-monitor-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

SERVICE_URL="$(
  gcloud run services describe "${SERVICE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)'
)"

gcloud run services add-iam-policy-binding "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker"

if gcloud scheduler jobs describe youtube-channel-poll \
  --project="${PROJECT_ID}" \
  --location="${REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http youtube-channel-poll \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --schedule="0 */3 * * *" \
    --uri="${SERVICE_URL}/internal/poll" \
    --http-method=POST \
    --oidc-service-account-email="${SCHEDULER_SA}" \
    --oidc-token-audience="${SERVICE_URL}"
else
  gcloud scheduler jobs create http youtube-channel-poll \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --schedule="0 */3 * * *" \
    --uri="${SERVICE_URL}/internal/poll" \
    --http-method=POST \
    --oidc-service-account-email="${SCHEDULER_SA}" \
    --oidc-token-audience="${SERVICE_URL}"
fi

echo "Scheduler configured for ${SERVICE_URL}/internal/poll"

