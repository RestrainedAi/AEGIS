import { useEffect, useState } from "react";

export interface ViewAsSession {
  subjectName: string;
  mode: "read_only" | "write";
  startedAt: number;
  exp: number;
}

/** Always-visible, non-dismissible banner while a Master Admin views as a user. */
export function ViewAsBanner({ session, onExit }: { session: ViewAsSession | null; onExit: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const title = document.title;
    document.title = `[VIEW AS] ${title}`;
    return () => { clearInterval(t); document.title = title; };
  }, [session]);
  useEffect(() => { if (session && now >= session.exp) onExit(); }, [now, session, onExit]);
  if (!session) return null;
  const left = Math.max(0, session.exp - now);
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const started = new Date(session.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return (
    <div role="alert" aria-live="polite" data-testid="view-as-banner"
      style={{ position: "sticky", top: 0, zIndex: 10000, background: session.mode === "write" ? "#8b1e1e" : "#7a5a00",
        color: "#fff", padding: "8px 16px", display: "flex", gap: 16, alignItems: "center", fontWeight: 600 }}>
      <span>Viewing as {session.subjectName} ({session.mode === "write" ? "WRITE MODE" : "read-only"})</span>
      <span>started {started}</span>
      <span>ends in {mm}:{ss}</span>
      <button type="button" onClick={onExit} style={{ marginLeft: "auto" }}>Exit</button>
    </div>
  );
}
