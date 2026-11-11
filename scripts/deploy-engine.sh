#!/usr/bin/env bash
set -euo pipefail
image=${1:?Usage: scripts/deploy-engine.sh us-central1-docker.pkg.dev/enigmagenomics/fastvep/engine@sha256:...}
case "$image" in
  us-central1-docker.pkg.dev/enigmagenomics/fastvep/engine:*) ;;
  us-central1-docker.pkg.dev/enigmagenomics/fastvep/engine@sha256:*) ;;
  *) echo 'Use the tested fastVEP image from the us-central1 registry.' >&2; exit 1 ;;
esac
gcloud run deploy fastvep-engine \
  --project enigmagenomics --region us-central1 --image "$image" \
  --service-account fastvep-engine@enigmagenomics.iam.gserviceaccount.com \
  --no-allow-unauthenticated --cpu 4 --memory 16Gi \
  --concurrency 4 --max-instances 2 --min-instances 0 \
  --timeout 120s --execution-environment gen2 --cpu-boost \
  --startup-probe 'tcpSocket.port=8080,periodSeconds=5,failureThreshold=48,timeoutSeconds=5' \
  --quiet
gcloud run services add-iam-policy-binding fastvep-engine \
  --project enigmagenomics --region us-central1 \
  --member serviceAccount:firebase-app-hosting-compute@enigmagenomics.iam.gserviceaccount.com \
  --role roles/run.invoker --quiet
