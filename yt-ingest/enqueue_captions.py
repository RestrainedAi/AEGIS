import json, os
from google.cloud import tasks_v2

playlist_id = os.environ["PLAYLIST_ID"]
run_id = os.environ["RUN_ID"]
queue = os.environ["QUEUE"]
region = os.environ["REGION"]
run_url = os.environ["RUN_URL"]
oidc_sa = os.environ["OIDC_SA"]
project_id = "sunopipeline"

endpoint = f"{run_url}/fetch_captions"

# Create a client
client = tasks_v2.CloudTasksClient()
parent = client.queue_path(project_id, region, queue)

count = 0
with os.popen(f"gcloud storage cat gs://{os.environ['BUCKET']}/yt/runs/{playlist_id}/{run_id}/manifest/playlist_manifest.jsonl") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        video_id = rec.get("videoId")
        if not video_id:
            continue

        payload = json.dumps({
            "playlistId": playlist_id,
            "runId": run_id,
            "videoId": video_id
        })

        task_name = f"cap-{run_id}-{video_id}".replace(":", "-").replace(".", "-")

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": endpoint,
                "headers": {"Content-Type": "application/json"},
                "body": payload.encode(),
                "oidc_token": {
                    "service_account_email": oidc_sa,
                },
            },
            "name": client.task_path(project_id, region, queue, task_name),
        }

        client.create_task(parent=parent, task=task)

        count += 1

print(f"Enqueued {count} caption tasks.")
