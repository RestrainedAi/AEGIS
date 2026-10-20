"""Generation-bound media checks; receipts never replace native objects."""
import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

CONTRACT = "full-decode-duration-v1"


def receipt_matches(receipt, blob, expected, kind):
    return (isinstance(receipt, dict) and receipt.get("contract") == CONTRACT and receipt.get("status") == "verified"
            and receipt.get("generation") == str(blob.generation)
            and receipt.get("bytes") == blob.size and receipt.get("md5") == blob.md5_hash
            and bool(blob.md5_hash) and bool(receipt.get("sha256"))
            and receipt.get("expected_seconds") == expected and receipt.get("kind") == kind)


class ReceiptStore:
    def __init__(self, client=None):
        if client is None:
            from google.cloud import storage
            from google.auth import compute_engine
            if not os.environ.get("CLOUD_RUN_JOB"):
                raise RuntimeError("Validation receipts require the harvest machine identity")
            client = storage.Client(project=os.environ.get("GCP_PROJECT", os.environ.get("PROJECT", "stable-framing-482501-t9")), credentials=compute_engine.Credentials())
        self.client = client

    def objects(self, uri):
        parsed = urlsplit(uri)
        bucket = self.client.bucket(parsed.netloc)
        name = parsed.path.lstrip("/")
        return bucket.get_blob(name, timeout=30), bucket.blob(name + ".validation.json")

    def verified(self, uri, expected, kind):
        blob, receipt_blob = self.objects(uri)
        if blob is None or not blob.size:
            return False
        from google.api_core.exceptions import NotFound
        try:
            receipt = json.loads(receipt_blob.download_as_text(timeout=30))
        except (NotFound, ValueError):
            return False
        return receipt_matches(receipt, blob, expected, kind)

    def validate(self, uri, expected, kind, validator):
        # Read exact immutable generation and verify bytes before accepting it.
        blob, receipt_blob = self.objects(uri)
        if blob is None or not blob.size:
            return False
        from google.api_core.exceptions import NotFound
        try:
            receipt = json.loads(receipt_blob.download_as_text(timeout=30))
        except (NotFound, ValueError):
            receipt = {}
        if receipt_matches(receipt, blob, expected, kind):
            return True
        with tempfile.TemporaryDirectory(prefix="suno-validate-") as directory:
            path = Path(directory) / Path(blob.name).name
            blob.download_to_filename(str(path), if_generation_match=int(blob.generation), timeout=180)
            content = path.read_bytes()
            md5 = base64.b64encode(hashlib.md5(content).digest()).decode()
            if len(content) != blob.size or not blob.md5_hash or md5 != blob.md5_hash:
                raise ValueError("storage byte/hash mismatch")
            measured = validator(path, expected)
            receipt = dict(contract=CONTRACT, status="verified", generation=str(blob.generation),
                           bytes=blob.size, md5=md5, sha256=hashlib.sha256(content).hexdigest(),
                           expected_seconds=expected, kind=kind, measured=measured)
        current, _ = self.objects(uri)
        if current is None or str(current.generation) != str(blob.generation):
            return False
        # A stale concurrent receipt is harmless: readers compare current generation.
        receipt_blob.upload_from_string(json.dumps(receipt), content_type="application/json", timeout=30)
        return True
