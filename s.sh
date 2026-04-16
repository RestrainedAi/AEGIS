#!/bin/bash
set -e

P="stable-framing-482501-t9"
R="us-central1"
SVC="yt-playlist-ingest"
SA="206866140882-compute@developer.gserviceaccount.com"
URL="https://yt-playlist-ingest-gyw66cuxzq-uc.a.run.app"

echo "=== Step 1: Grant roles/run.invoker to Compute SA ==="
gcloud run services add-iam-policy-binding ${SVC} \
  --region=${R} \
    --member="serviceAccount:${SA}" \
      --role="roles/run.invoker" \
        --project=${P}

        echo "=== Step 2: Create Suno ingest scheduler job ==="
        gcloud scheduler jobs create http aeonimus-suno-ingest \
          --location=${R} \
            --schedule="0 12 * * *" \
              --uri="${URL}/v1/admin/suno/ingest" \
                --http-method=POST \
                  --message-body='{"handle":"unshakableechos2341"}' \
                    --headers="Content-Type=application/json" \
                      --oidc-service-account-email=${SA} \
                        --oidc-token-audience="${URL}" \
                          --time-zone="America/Chicago" \
                            --description="Daily Suno harvest: sync unshakableechos2341 to Firestore+GCS" \
                              --project=${P}

                              echo "=== Step 3: Create YouTube playlist scheduler job ==="
                              gcloud scheduler jobs create http aeonimus-yt-playlist-ingest \
                                --location=${R} \
                                  --schedule="0 11 * * *" \
                                    --uri="${URL}/ingest" \
                                      --http-method=POST \
                                        --message-body='{"playlist":"PLaeonimus_main"}' \
                                          --headers="Content-Type=application/json" \
                                            --oidc-service-account-email=${SA} \
                                              --oidc-token-audience="${URL}" \
                                                --time-zone="America/Chicago" \
                                                  --description="Daily YouTube playlist ingest to Firestore+GCS" \
                                                    --project=${P}

                                                    echo "=== Done! Listing all scheduler jobs ==="
                                                    gcloud scheduler jobs list --location=${R} --project=${P}