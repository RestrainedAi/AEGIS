# AEGIS Vault to YouTube Zero-Byte Media Incident

## Date

2026-03-30

## Related Jira

1. `DEV-30`
2. `DEV-33`
3. `DEV-55`
4. `DEV-60`

## Summary

The `Vault -> queue -> uploader` path is operational.

The remaining confirmed failure mode is not YouTube auth, Cloud Run runtime, or queue creation. It is a media-integrity edge case where some SUNO MP4 artifacts exist in GCS as zero-byte objects.

When those objects are selected for YouTube upload:

1. the queue record is created normally
2. `yt-upload-job` executes normally
3. the uploader downloads `0 bytes`
4. YouTube returns a low-signal chunk upload `400`
5. the item remains blocked until media repair or recapture

## Proof Trail

### 1. Cloud Run job configuration is good

The latest inspected execution showed:

1. job: `yt-upload-job`
2. region: `us-central1`
3. service account: `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`
4. expected YouTube secrets mounted

This confirms the uploader is no longer failing because of the wrong runtime service account.

### 2. The uploader works for valid media

The inspected logs show successful YouTube uploads for valid media, including:

1. `THE FINAL MECHANISM ? IDENTIFIED, NAMED, AND DELETED FOREVER ?`
2. `Divine Glitch Protocol`

That proves the end-to-end publishing path is functioning for healthy media artifacts.

### 3. The failing items point to zero-byte MP4 objects

Affected queue rows and songs:

1. queue item `G0KMVbEt4slPYivQ3BHC`
   song key `63cae7f5-8d32-4ef1-9fd7-79983121501c`
2. queue item `csmXgM26D5ivTlVgxyjk`
   song key `c901a10f-9e5c-40a0-b395-a456e17c98d0`

Affected GCS objects:

1. `gs://aeonimus-suno-media/suno/handles/unshakableechos2341/63cae7f5-8d32-4ef1-9fd7-79983121501c.mp4`
2. `gs://aeonimus-suno-media/suno/handles/unshakableechos2341/c901a10f-9e5c-40a0-b395-a456e17c98d0.mp4`

These objects were verified as zero-byte artifacts.

### 4. Logs confirm the exact failure pattern

The uploader logs showed:

1. `downloaded 0 bytes`
2. `YouTube chunk upload HTTP 400: Failed to parse Content-Range header.`

This is now the known signature of the zero-byte media edge case.

## Conclusion

The correct product statement is:

`Vault-to-YouTube is operational, with one identified bad-media edge case still being hardened.`

That edge case is:

1. zero-byte MP4 source artifact in GCS
2. upload should be blocked early
3. queue item should be classified clearly
4. operator should be guided toward repair, not blind retry

## Required Handling

Per the edge-case framework, the handling should be:

1. detect zero-byte media before upload
2. classify it as a media-integrity failure
3. fail the single item, not the batch
4. preserve evidence on the queue row
5. provide repair-oriented operator guidance

## Follow-Up

The active implementation follow-up is:

1. `DEV-60` detect and repair zero-byte SUNO media artifacts before YouTube upload

