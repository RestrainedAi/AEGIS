#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "mirror-current" ]; then
    cd /app
    python3 - <<'PY'
from pathlib import Path
import os,json
from harvest_completion import MetadataStorage,publish_completion,CATALOG,META
store=MetadataStorage()
catalog=store.get(CATALOG);meta=store.get(META)
if catalog is None or meta is None:raise RuntimeError('Published catalog unavailable')
r=publish_completion(store,'manual-'+os.environ['CLOUD_RUN_EXECUTION'],catalog[0],meta[0],{'source_coverage_not_reverified':3},source={'kind':'explicit-current-catalog-mirror','source_coverage':'not reverified; existing catalog only'})
print(json.dumps({'runId':r['runId'],'status':r['status'],'receiptObject':r['receiptObject']}))
PY
else
    exec /app/entrypoint.sh "$@"
fi