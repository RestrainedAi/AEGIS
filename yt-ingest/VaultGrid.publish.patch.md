# VaultGrid.tsx — Publish to YouTube Patch

Apply these changes to `~/suno-viewer/src/VaultGrid.tsx` (or wherever the clip card is rendered).

---

## Step 1 — Add state + helper near top of component

```tsx
// ── YouTube publish state ──────────────────────────────────────────────────
// Maps songKey → { status, ytVideoId, ytCanonicalUrl }
const [ytStatus, setYtStatus] = React.useState<
  Record<string, { status: string; ytVideoId?: string; ytCanonicalUrl?: string }>
>({});

async function queueForYouTube(clip: {
  songKey: string;
  title: string;
  gcs_mp4: string;
  account_label: string;
}) {
  // Optimistic UI
  setYtStatus((prev) => ({ ...prev, [clip.songKey]: { status: 'queued' } }));
  try {
    const res = await fetch('/api/queue-for-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songKey: clip.songKey,
        title: clip.title,
        gcsPath: clip.gcs_mp4,        // mp4 preferred for YouTube
        accountLabel: clip.account_label,
      }),
    });
    const data = await res.json();
    setYtStatus((prev) => ({
      ...prev,
      [clip.songKey]: {
        status: data.status,
        ytVideoId: data.ytVideoId,
        ytCanonicalUrl: data.ytCanonicalUrl,
      },
    }));
  } catch (err) {
    console.error('queue-for-youtube failed:', err);
    setYtStatus((prev) => ({ ...prev, [clip.songKey]: { status: 'error' } }));
  }
}
```

---

## Step 2 — Add ytStatus badge helper

```tsx
function YtBadge({ songKey }: { songKey: string }) {
  const yt = ytStatus[songKey];
  if (!yt) return null;

  if (yt.status === 'done' && yt.ytCanonicalUrl) {
    return (
      <a
        href={yt.ytCanonicalUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#ff0000', fontSize: 11, textDecoration: 'none' }}
        title="View on YouTube"
      >
        ✅ YouTube ↗
      </a>
    );
  }

  const label: Record<string, string> = {
    queued:    '⏳ Queued',
    uploading: '🔄 Uploading…',
    error:     '❌ Error',
    not_queued:'',
  };

  return (
    <span style={{ fontSize: 11, color: '#888' }}>
      {label[yt.status] ?? yt.status}
    </span>
  );
}
```

---

## Step 3 — Add Publish button inside each clip card

Find the section in VaultGrid.tsx where the clip card buttons are rendered (near the `▶ Play / Waveform` button). Add this below it:

```tsx
{/* ── YouTube Publish button ── */}
<div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
  <button
    onClick={() =>
      queueForYouTube({
        songKey: clip.songKey,          // adjust field name to match your data shape
        title: clip.title,
        gcs_mp4: clip.gcs_mp4 ?? clip.gcs_latest_mp4 ?? '',
        account_label: clip.account_label ?? 'vanessa_primary',
      })
    }
    disabled={['queued', 'uploading', 'done'].includes(ytStatus[clip.songKey]?.status ?? '')}
    style={{
      padding: '3px 8px',
      fontSize: 11,
      background: '#ff0000',
      color: '#fff',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      opacity: ['queued', 'uploading', 'done'].includes(ytStatus[clip.songKey]?.status ?? '') ? 0.5 : 1,
    }}
    title="Queue this clip for YouTube upload"
  >
    🎬 Publish
  </button>
  <YtBadge songKey={clip.songKey} />
</div>
```

---

## Step 4 — Wire up server.ts

In `~/suno-viewer/src/server.ts` (or `index.ts`), add:

```typescript
import queueYt from './routes/queue-youtube';
// ... after other middleware ...
app.use(express.json());   // ensure body parsing is on
app.use(queueYt);
```

---

## Notes

- Phase I: **no auth** on the `/api/queue-for-youtube` endpoint (single user, internal tool)
- Phase II: add Google Sign-In token verification (use Firebase Auth middleware)
- `gcs_mp4` falls back to `gcs_latest_mp4` — mp4 preferred; youtube_uploader.py handles download
- After queueing, `yt-upload-daily` runs at 06:00 UTC to process the queue
  - To upload immediately: `gcloud run jobs execute yt-upload-job --region=us-central1 --project=stable-framing-482501-t9`
