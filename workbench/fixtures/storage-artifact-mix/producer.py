"""Synthetic producer for testing storage discovery, not a real integration."""

import io
import json
import zipfile


def persist_run(store, bucket, call_id, codec, audio, metadata, log_records, part_name, part):
    store.put(bucket, f"streams/{call_id}/track.{codec}", audio)
    store.put(bucket, f"facts/{call_id}/snapshot", json.dumps(metadata).encode())
    store.put(
        bucket,
        f"debug/{metadata['day']}/events.json",
        json.dumps({"records": [{"call_id": call_id, **record} for record in log_records]}).encode(),
    )

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr(f"segments/{part_name}", part)
        bundle.writestr("index.json", json.dumps({"call_id": call_id}))
    store.put(bucket, f"bundles/{call_id}.zip", archive.getvalue())


def persist_unrelated_bucket_readme(store, bucket):
    store.put(bucket, "README", b"Bucket maintenance notes")
