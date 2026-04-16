import sys
from google.cloud import firestore
from build_manifest_from_studio_api import fetch_profile_clip_ids

HANDLE = "unshakableechos2341"
SOURCE_ID = f"suno_{HANDLE}"

def get_firestore_ids(db):
    ids = set()
    docs = db.collection("sunoSongs") \
             .where("sourceId", "==", SOURCE_ID) \
             .stream()
    for d in docs:
        ids.add(d.id.replace("suno:", ""))
    return ids

def main():
    print(f"Running delta check for: {HANDLE}")

    db = firestore.Client()

    print("Fetching latest IDs from Suno...")
    current_ids = set(fetch_profile_clip_ids(HANDLE))
    print(f"Current Suno count: {len(current_ids)}")

    print("Fetching existing IDs from Firestore...")
    existing_ids = get_firestore_ids(db)
    print(f"Firestore count: {len(existing_ids)}")

    new_ids = current_ids - existing_ids
    removed_ids = existing_ids - current_ids
    unchanged_ids = current_ids & existing_ids

    print("\n===== DELTA REPORT =====")
    print(f"New clips: {len(new_ids)}")
    print(f"Removed clips: {len(removed_ids)}")
    print(f"Unchanged clips: {len(unchanged_ids)}")

    if new_ids:
        print("\nFirst 10 new IDs:")
        for i in list(new_ids)[:10]:
            print(" +", i)

    if removed_ids:
        print("\nFirst 10 removed IDs:")
        for i in list(removed_ids)[:10]:
            print(" -", i)

    print("\nDone.")

if __name__ == "__main__":
    main()
