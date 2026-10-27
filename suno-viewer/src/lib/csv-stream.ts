// Incremental CSV parser for the Vault catalog. Feed it text chunks as they arrive
// over the network and it hands back every record that is complete so far, so the
// grid can render the first songs long before the whole file has downloaded.
// Supports quoted fields, escaped quotes ("") and newlines inside quotes.

export type CsvRecord = Record<string, string>

export type CsvStreamParser = {
  /** Parse another chunk; returns the records completed by it. */
  push: (chunk: string) => CsvRecord[]
  /** Flush the final record (file without a trailing newline). */
  end: () => CsvRecord[]
  headers: () => string[]
}

export function createCsvStreamParser(): CsvStreamParser {
  let headers: string[] | null = null
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // A quote seen at the very end of a chunk while in quotes: we can't yet tell
  // whether it closes the field or starts an escaped "" pair.
  let pendingQuote = false
  let pendingCR = false

  const toRecord = (cells: string[]): CsvRecord | null => {
    if (!cells.some(cell => cell.trim() !== '')) return null
    if (!headers) {
      headers = cells.map(cell => cell.replace(/^\uFEFF/, '').trim())
      return null
    }
    const record: CsvRecord = {}
    headers.forEach((header, idx) => { record[header] = cells[idx] ?? '' })
    return record
  }

  const finishRow = (out: CsvRecord[]) => {
    row.push(field)
    field = ''
    const record = toRecord(row)
    row = []
    if (record) out.push(record)
  }

  const push = (chunk: string) => {
    const out: CsvRecord[] = []
    let i = 0
    if (pendingCR) {
      pendingCR = false
      if (chunk[0] === '\n') i = 1
    }
    if (pendingQuote) {
      pendingQuote = false
      if (chunk[0] === '"') { field += '"'; i = Math.max(i, 1) }
      else inQuotes = false
    }
    let start = i
    for (; i < chunk.length; i++) {
      const ch = chunk.charCodeAt(i)
      if (inQuotes) {
        if (ch !== 34) continue
        field += chunk.slice(start, i)
        if (i + 1 >= chunk.length) { pendingQuote = true; start = i + 1; break }
        if (chunk.charCodeAt(i + 1) === 34) { field += '"'; i += 1 }
        else inQuotes = false
        start = i + 1
        continue
      }
      if (ch === 34) { field += chunk.slice(start, i); inQuotes = true; start = i + 1; continue }
      if (ch === 44) { field += chunk.slice(start, i); row.push(field); field = ''; start = i + 1; continue }
      if (ch === 10 || ch === 13) {
        field += chunk.slice(start, i)
        finishRow(out)
        if (ch === 13) {
          if (i + 1 >= chunk.length) pendingCR = true
          else if (chunk.charCodeAt(i + 1) === 10) i += 1
        }
        start = i + 1
      }
    }
    if (start < chunk.length) field += chunk.slice(start)
    return out
  }

  const end = () => {
    const out: CsvRecord[] = []
    if (pendingQuote) { pendingQuote = false; inQuotes = false }
    if (field.length > 0 || row.length > 0) finishRow(out)
    return out
  }

  return { push, end, headers: () => headers || [] }
}

export function parseCsvText(text: string): CsvRecord[] {
  const parser = createCsvStreamParser()
  return [...parser.push(text), ...parser.end()]
}
