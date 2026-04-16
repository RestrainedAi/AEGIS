import csv
HANDLE_MAP = {"unshakableechos2341": "vanessa_primary"}
rows = []
with open("latest_catalog_wide.csv") as f:
    r = csv.DictReader(f)
    fn = r.fieldnames
    for row in r:
        orig = row["account_handle"]
        row["account_handle"] = HANDLE_MAP.get(orig, orig)
        if row["account_label"] == "" and orig in HANDLE_MAP:
            row["account_label"] = HANDLE_MAP[orig]
        rows.append(row)
with open("latest_catalog_wide.csv", "w", newline="") as g:
    w = csv.DictWriter(g, fieldnames=fn)
    w.writeheader()
    w.writerows(rows)
vp = sum(1 for r in rows if r["account_handle"] == "vanessa_primary")
print("Patched", len(rows), "rows | vanessa_primary:", vp)
