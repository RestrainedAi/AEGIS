const express = require("express");
const { Storage } = require("@google-cloud/storage");

const app = express();
const storage = new Storage();

const BUCKET = "aeonimus-workspaces";
const OBJECT = "exports/suno/latest_catalog_wide.csv";

app.get("/catalog.csv", async (_req, res) => {
  try {
    const [buf] = await storage.bucket(BUCKET).file(OBJECT).download();
    res.type("text/csv").send(buf);
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to load catalog.csv: " + (e?.message || e));
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Suno Catalog Viewer</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 16px; }
    input { width: 100%; padding: 10px; margin: 10px 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { position: sticky; top: 0; background: #111; color: #fff; text-align: left; }
    .small { color:#666; font-size: 12px; }
    .pill { display:inline-block; padding:2px 8px; border:1px solid #ddd; border-radius:999px; font-size:12px; margin-right:6px; }
    a { color:#2563eb; }
  </style>
</head>
<body>
  <h2>🎧 Suno Catalog Viewer</h2>
  <div class="small">Source: /catalog.csv (served privately by Cloud Run)</div>
  <input id="q" placeholder="Search title / songKey / tags …" />
  <div id="status" class="small"></div>
  <table id="t">
    <thead><tr>
      <th>Title</th><th>SongKey</th><th>Media</th><th>Account</th><th>Tags</th>
    </tr></thead>
    <tbody></tbody>
  </table>

<script>
const CSV_URL = "/catalog.csv";

function parseCSV(text) {
  const lines = text.split(/\\r?\\n/).filter(Boolean);
  const header = lines[0].split(",");
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const line = lines[i];
    const cols = [];
    let cur="", inQ=false;
    for (let j=0;j<line.length;j++){
      const ch=line[j];
      if (ch==='\"') { inQ=!inQ; continue; }
      if (ch===',' && !inQ) { cols.push(cur); cur=""; continue; }
      cur+=ch;
    }
    cols.push(cur);
    const obj = {};
    header.forEach((h, idx)=> obj[h]=cols[idx] ?? "");
    rows.push(obj);
  }
  return rows;
}

function linkIf(gsUri, label) {
  if (!gsUri) return "";
  if (gsUri.startsWith("gs://")) {
    const rest = gsUri.slice(5);
    const [bucket, ...path] = rest.split("/");
    return \`<a href="https://storage.googleapis.com/\${bucket}/\${path.join("/")}" target="_blank">\${label}</a>\`;
  }
  if (gsUri.startsWith("http")) return \`<a href="\${gsUri}" target="_blank">\${label}</a>\`;
  return "";
}

let allRows = [];
function render(rows) {
  const tbody = document.querySelector("#t tbody");
  tbody.innerHTML = "";
  for (const r of rows) {
    const title = (r.title || "").slice(0,180);
    const key = r.songKey || "";
    const mp3 = r.gcs_latest_audio || r.gcs_mp3 || "";
    const mp4 = r.gcs_latest_mp4 || r.gcs_mp4 || "";
    const thb = r.gcs_latest_thumb || r.gcs_thumb || "";
    const acct = (r.account_handle || r.account_label || "").trim();
    const tags = (r.tags || r.meta_tags || "").toString();

    const media = [
      linkIf(mp3, "MP3/M4A"),
      linkIf(mp4, "MP4"),
      linkIf(thb, "THUMB")
    ].filter(Boolean).join(" · ");

    tbody.insertAdjacentHTML("beforeend", \`
      <tr>
        <td>\${title}</td>
        <td class="small">\${key}</td>
        <td>\${media || "<span class='small'>—</span>"}</td>
        <td><span class="pill">\${acct || "—"}</span></td>
        <td class="small">\${tags}</td>
      </tr>\`);
  }
  document.getElementById("status").textContent = rows.length + " rows";
}

function applyFilter() {
  const q = document.getElementById("q").value.toLowerCase().trim();
  if (!q) return render(allRows);
  render(allRows.filter(r => JSON.stringify(r).toLowerCase().includes(q)));
}

document.getElementById("q").addEventListener("input", applyFilter);

fetch(CSV_URL).then(r=>r.text()).then(text=>{
  allRows = parseCSV(text);
  render(allRows);
}).catch(err=>{
  document.getElementById("status").textContent = "Failed to load CSV: " + err;
});
</script>
</body>
</html>`);
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));
