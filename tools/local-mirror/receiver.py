"""Durable consumer of validated harvest receipts. No harvest or personal login.

The resident mode checks the small completion index, not the song collection.
Each event is recorded before processing; local receipt replay makes crashes safe.
"""
from __future__ import annotations
import argparse
import csv
import io
import hashlib
import html
import importlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import secrets
import threading
from urllib.parse import quote

BUCKET = 'aeonimus-workspaces'
PREFIX = 'exports/suno/harvest-completions/'
INDEX = PREFIX + 'index.json'

def object_url(name, generation=None):
    if not name.startswith(PREFIX) or '..' in name.split('/'):
        raise ValueError('Completion object outside allowed prefix')
    url = 'https://storage.googleapis.com/' + BUCKET + '/' + quote(name, safe='/')
    return url + ('?generation=' + str(int(generation)) if generation else '')

def checked(payload, expected):
    if hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError('Completion artifact SHA256 mismatch')
    return payload

class Receiver:
    def __init__(self, state, root, transport, sync, outbox=None, tagging_adapter=None, *, library_only=False):
        self.state, self.root, self.transport, self.sync = Path(state), Path(root), transport, sync
        self.outbox = outbox
        self.tagging_adapter = tagging_adapter
        self.library_only = library_only
        self.state.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.state / 'queue.sqlite3', timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, descriptor TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, next_try REAL NOT NULL DEFAULT 0)')
        self.db.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        self.db.commit()

    def enqueue_manual(self, request_id):
        raw, _ = self.transport(object_url(INDEX))
        index=json.loads(raw)
        if index.get('schemaVersion')!=1 or not index.get('runs'):
            raise ValueError('No verified completed catalog available for one-off')
        latest=max(index['runs'],key=lambda item:(item.get('catalogGeneratedAt',''),item.get('publishedAt','')))
        descriptor=dict(latest, originRunId=latest['runId'], requestedAt=time.time())
        self.db.execute('INSERT OR IGNORE INTO events(id,descriptor,status) VALUES(?,?,?)',
                        ('manual-' + request_id, json.dumps(descriptor, sort_keys=True), 'pending'))
        self.db.commit()

    def discover(self):
        raw, _ = self.transport(object_url(INDEX))
        index = json.loads(raw)
        if index.get('schemaVersion') != 1 or not isinstance(index.get('runs'), list):
            raise ValueError('Unsupported completion index')
        for item in sorted(index['runs'], key=lambda item: (item.get('catalogGeneratedAt', item.get('publishedAt', '')), item['runId'])):
            run = item['runId']
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,199}', run):
                raise ValueError('Invalid completion run ID')
            if item['receiptObject'] != PREFIX + run + '/receipt.json':
                raise ValueError('Receipt path/run mismatch')
            descriptor = json.dumps(item, sort_keys=True)
            old = self.db.execute('SELECT descriptor FROM events WHERE id=?', (run,)).fetchone()
            if old and old['descriptor'] != descriptor:
                raise ValueError('Immutable completion index entry changed')
            self.db.execute('INSERT OR IGNORE INTO events(id,descriptor,status) VALUES(?,?,?)', (run, descriptor, 'pending'))
        self.db.commit()

    def process(self):
        # One pending event per pass limits failure impact; historical native gaps
        # do not cause endless retries of successfully transferred immutable bytes.
        event = self.db.execute("SELECT * FROM events WHERE status IN ('pending','running','retry','blocked') ORDER BY rowid LIMIT 1").fetchone()
        if not event or event['status'] == 'blocked' or event['next_try'] > time.time():
            return None
        item = json.loads(event['descriptor'])
        run = event['id']
        source_run = item.get('originRunId',run)
        attempt = event['attempts'] if event['status'] == 'running' else event['attempts'] + 1
        self.db.execute("UPDATE events SET status='running',attempts=? WHERE id=?", (attempt, run)); self.db.commit()
        status_path = self.state / 'status.json'
        temporary = status_path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'at':time.time(),'status':'processing','events':self.status()},indent=2),encoding='utf-8')
        os.replace(temporary,status_path)
        try:
            raw, _ = self.transport(object_url(item['receiptObject'], item['generation']))
            receipt = json.loads(checked(raw, item['sha256']))
            if receipt.get('runId') != source_run or receipt.get('schemaVersion') != 1:
                raise ValueError('Receipt identity/schema mismatch')
            generated = receipt.get('catalogGeneratedAt', '')
            if item.get('catalogGeneratedAt') and generated != item['catalogGeneratedAt']:
                raise ValueError('Receipt catalog timestamp differs from index')
            watermark = self.db.execute("SELECT value FROM settings WHERE key='catalog_watermark'").fetchone()
            if watermark and generated < watermark['value']:
                saved = self.state / ('late-receipt-' + hashlib.sha256(run.encode()).hexdigest() + '.json')
                saved.write_bytes(raw)
                if self.library_only:
                    result = {'status':'superseded_library_catalog', 'catalogGeneratedAt':generated,
                              'current_watermark':watermark['value'], 'evidence_dispatch':False,
                              'reason':'Verified receipt predates current library catalog; no library mutation'}
                    self.db.execute('UPDATE events SET status=?,result=?,error=NULL WHERE id=?',
                                    ('superseded_library_catalog',json.dumps(result),run))
                    self.db.commit()
                    return result
                raise ValueError('Late historical catalog needs reconciliation; current catalog will not be regressed')
            asset = receipt['artifacts']['catalog']
            if asset['bucket'] != BUCKET or not asset['object'].startswith(PREFIX + source_run + '/'):
                raise ValueError('Catalog snapshot outside receipt scope')
            artifact_url = object_url(asset['object'], asset['generation'])
            if not re.fullmatch('[0-9a-f]{64}', asset['sha256']) or int(asset['bytes']) < 0:
                raise ValueError('Invalid catalog artifact descriptor')
            verified_hash = self.db.execute("SELECT value FROM settings WHERE key='catalog_sha256'").fetchone()
            if self.library_only and watermark and generated == watermark['value'] and verified_hash and asset['sha256'] == verified_hash['value']:
                saved = self.state / ('verified-receipt-' + hashlib.sha256(run.encode()).hexdigest() + '.json')
                saved.write_bytes(raw)
                result = {'status':'already_verified_library_catalog', 'catalogGeneratedAt':generated,
                          'catalog_sha256':asset['sha256'], 'evidence_dispatch':False,
                          'reason':'Receipt identifies the exact previously verified library snapshot; no library mutation'}
                self.db.execute('UPDATE events SET status=?,result=?,error=NULL WHERE id=?',
                                (result['status'],json.dumps(result),run))
                self.db.commit()
                return result
            data, _ = self.transport(artifact_url)
            checked(data, asset['sha256'])
            if len(data) != int(asset['bytes']):
                raise ValueError('Catalog snapshot length mismatch')
            return self.integrate(event, data, generated, attempt)
        except Exception as exc:
            # Never claim a failed download is absent at source. Interrupted
            # multi-file commits need journal inspection, not a new overwrite.
            message = str(exc)
            status = 'blocked' if any(term in message.lower() for term in ('commit', 'reconciliation', 'incomplete run','authentication')) or attempt >= 3 else 'retry'
            self.db.execute('UPDATE events SET status=?,error=?,next_try=? WHERE id=?',
                            (status, type(exc).__name__ + ': ' + message[:500], time.time() + min(3600, 60 * 2 ** attempt), run))
            self.db.commit()
            raise

    def integrate(self, event, data, generated, attempt):
        run = event['id']
        local_run = 'harvest-' + hashlib.sha256(run.encode()).hexdigest()[:32] + '-attempt-' + str(attempt)
        result = self.sync(self.root, data, local_run, self.transport)
        if result.get('status')=='interrupted' and result.get('retryable'):
            self.db.execute("UPDATE events SET status='running',result=?,next_try=? WHERE id=?",(json.dumps(result),time.time()+60,run));self.db.commit()
            return result
        failures = int(result.get('retryable_failure_count',result.get('failure_count', 0)))
        status = 'retry' if failures and attempt < 3 else ('blocked' if failures else 'awaiting_evidence')
        if self.library_only:
            result = dict(result, operating_mode='library_only', evidence_status='held',
                          evidence_dispatch=False, tagging_dispatch=False)
            if status == 'awaiting_evidence':
                status = 'library_synced_evidence_held'
        if result.get('reconciliation_required') or result.get('status') == 'blocked':
            status = 'blocked'
        if not self.library_only and self.outbox and status != 'blocked':
            from evidence_handoff import publish
            result = dict(result, anchor_handoff=publish(self.root, result, self.outbox))
            self.enqueue_tagging(result)
        self.db.execute('UPDATE events SET status=?,result=?,error=NULL,next_try=? WHERE id=?',
                        (status, json.dumps(result), time.time() + min(3600, 60 * 2 ** attempt), run))
        if status in ('awaiting_evidence', 'library_synced_evidence_held') and generated:
            self.db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('catalog_watermark',?)", (generated,))
            if self.library_only:
                self.db.execute("DELETE FROM settings WHERE key='catalog_sha256'")
                if not result.get('failure_count') and result.get('status') in ('complete', 'partial'):
                    self.db.execute("INSERT INTO settings(key,value) VALUES('catalog_sha256',?)", (hashlib.sha256(data).hexdigest(),))
        self.db.commit()
        if self.library_only:
            # Current attempt health is separate from the append-only historical
            # gap inventory; its row count is not a current missing-file count.
            health = {'at':time.time(), 'event_id':run, 'catalogGeneratedAt':generated,
                      'queue_status':status, 'sync_status':result.get('status'),
                      'selected_songs':result.get('selected_songs'),
                      'current_absent_references':result.get('absent_reference_count'),
                      'current_download_failures':result.get('failure_count'),
                      'retryable_failure_count':result.get('retryable_failure_count'),
                      'added_files':len(result.get('added_files', [])),
                      'verified_unchanged_assets':sum(a.get('status')=='unchanged_verified' for a in result.get('assets', [])),
                      'historical_gap_rows':result.get('remaining_gap_rows'),
                      'historical_gap_rows_are_current_missing_files':False,
                      'evidence_dispatch':False, 'tagging_dispatch':False,
                      'receipt_path':result.get('receipt_path')}
            target = self.state / 'library-health.json'
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(health, indent=2), encoding='utf-8')
            os.replace(temporary, target)
        if result.get('blocker')=='machine_authentication':
            raise RuntimeError('Machine authentication blocked: HTTP ' + str(result.get('http_status','unavailable')))
        return result

    def status(self):
        return [dict(row) for row in self.db.execute('SELECT id,status,attempts,error,result FROM events ORDER BY rowid')]

    def enqueue_tagging(self, result):
        if self.library_only or not self.tagging_adapter or not result.get('anchor_handoff'):
            return
        from tagging_callback import enqueue
        try:
            result['tagging_callback'] = enqueue(result['anchor_handoff'], self.tagging_adapter)
        except Exception as exc:
            # Retry the callback on the next acknowledgment pass, not acquisition.
            result['tagging_callback'] = {'status':'failed','error':str(exc)[:1000]}

    def refresh_acknowledgments(self):
        if self.library_only:
            return
        from evidence_handoff import read_ack
        for event in self.db.execute("SELECT id,result FROM events WHERE status='awaiting_evidence'").fetchall():
            result=json.loads(event['result'])
            if not result.get('anchor_handoff'):continue
            self.enqueue_tagging(result)
            ack=read_ack(result['anchor_handoff'])
            result['anchor_acknowledgment']=ack
            status='awaiting_steward' if ack['status']=='ACCEPTED' else 'awaiting_evidence'
            self.db.execute('UPDATE events SET status=?,result=? WHERE id=?',(status,json.dumps(result),event['id']))
        self.db.commit()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['once', 'watch', 'status', 'request'])
    parser.add_argument('--root', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--auth-dir', required=True)
    parser.add_argument('--interval', type=int, default=300)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--evidence-outbox')
    parser.add_argument('--tagging-adapter')
    parser.add_argument('--library-only', action='store_true',
                        help='Sync library only; suppress evidence handoff, acknowledgments and tagging')
    args = parser.parse_args()
    state_path = Path(args.state); state_path.mkdir(parents=True, exist_ok=True)
    if args.mode == 'status':
        saved=state_path/'status.json'
        print(saved.read_text() if saved.exists() else json.dumps({'status':'not_started'}));return 0
    if args.mode == 'request':
        request_id = uuid.uuid4().hex
        (state_path / ('request-' + request_id + '.json')).write_text(json.dumps({'requestId':request_id,'at':time.time()}))
        print(json.dumps({'status':'queued','requestId':request_id,'note':'Receiver must be running; no success implied'})); return 0
    from local_mirror import SecureGcsTransport
    from metadata_prefetch import sync_with_prefetch
    sys.path.insert(0, str(Path(args.auth_dir).resolve()))
    auth = importlib.import_module('sundrop_storage_auth')
    transport = SecureGcsTransport({'aeonimus-workspaces', 'aeonimus-suno-media'}, auth.get_access_token)
    receiver = Receiver(args.state, args.root, transport, sync_with_prefetch, args.evidence_outbox, args.tagging_adapter,
                        library_only=args.library_only)
    # Held OS lock also protects separate manually invoked processes. It is
    # released by the OS on crashes, unlike an orphaned PID file.
    import msvcrt
    lock = open(Path(args.state) / 'receiver.lock', 'a+b')
    lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        raise SystemExit('Receiver already running; use its local pending queue.')
    if args.mode == 'watch':
        start_api(state_path, args.port)
    last_alert = None
    while True:
        try:
            if args.mode != 'status':
                receiver.discover()
                for request in sorted(state_path.glob('request-*.json')):
                    request_id = request.stem.removeprefix('request-')
                    if not re.fullmatch('[a-f0-9]{32}', request_id):
                        continue
                    if not receiver.db.execute('SELECT 1 FROM events WHERE id=?', ('manual-' + request_id,)).fetchone():
                        receiver.enqueue_manual(request_id)
                    request.rename(request.with_name('accepted-' + request.name))
                while receiver.process() is not None:
                    pass
                receiver.refresh_acknowledgments()
            status = {'at': time.time(), 'events': receiver.status()}
        except Exception as exc:
            status = {'at': time.time(), 'status': 'blocked', 'error': type(exc).__name__ + ': ' + str(exc)[:500], 'events': receiver.status()}
            if any(word in status['error'].lower() for word in ('identity','credential','authentication','401','403','token')) and last_alert != status['error']:
                import subprocess
                alert=Path(args.auth_dir)/'alert-suno-login.ps1'
                if alert.is_file():
                    subprocess.Popen(['powershell.exe','-NoProfile','-WindowStyle','Hidden','-File',str(alert)],creationflags=subprocess.CREATE_NO_WINDOW)
                last_alert=status['error']
        target = Path(args.state) / 'status.json'
        temporary = target.with_suffix('.tmp'); temporary.write_text(json.dumps(status, indent=2), encoding='utf-8'); os.replace(temporary, target)
        cards=[]
        for item in status.get('events',[]):
            result=json.loads(item['result']) if item.get('result') else {}
            cards.append('<tr><td>'+html.escape(item['id'])+'</td><td>'+html.escape(item['status'])+'</td><td>'+str(len(result.get('added_files',[])))+'</td><td>'+str(result.get('remaining_gap_rows','unknown'))+'</td><td>'+html.escape(item.get('error') or '')+'</td></tr>')
        page='<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>Sundrop local copies</title><style>body{font:16px system-ui;margin:2rem}td,th{padding:.6rem;text-align:left;border-bottom:1px solid #ccc}</style><h1>Sundrop local copies</h1><p>Runs after published harvest receipts or an explicit request. No daily 9 AM job.</p><p>'+html.escape(status.get('error','Receiver checked '+time.strftime('%Y-%m-%d %H:%M:%S')))+'</p><table><tr><th>Run</th><th>State</th><th>New files</th><th>Unresolved gaps</th><th>Error</th></tr>'+''.join(cards)+'</table><p>Awaiting evidence or Steward means delivery has not been accepted. Published catalog and byte transfer do not prove complete source coverage.</p>'
        (state_path/'status.html').write_text(page,encoding='utf-8')
        if args.mode != 'watch':
            print(json.dumps(status)); return 2 if status.get('status') == 'blocked' else 0
        deadline = time.monotonic() + max(60, args.interval)
        while time.monotonic() < deadline:
            if next(state_path.glob('request-*.json'), None):
                break
            time.sleep(2)

def start_api(state, port):
    """Loopback-only API. Callers read the token from the restricted state folder.

    No CORS, no ambient browser authentication, no arbitrary source URLs/paths.
    The durable request file survives receiver restarts.
    """
    token_path = state / 'api-token'
    if not token_path.exists():
        with token_path.open('x') as f: f.write(secrets.token_urlsafe(32))
    token = token_path.read_text()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, code, body):
            data = json.dumps(body).encode(); self.send_response(code)
            self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
        def authorized(self):
            return not self.headers.get('Origin') and secrets.compare_digest(self.headers.get('Authorization',''), 'Bearer ' + token)
        def do_GET(self):
            if not self.authorized(): return self.reply(401, {'error':'Unauthorized'})
            if self.path != '/status': return self.reply(404, {'error':'Unknown route'})
            p = state / 'status.json'
            return self.reply(200, json.loads(p.read_text()) if p.exists() else {'status':'starting'})
        def do_POST(self):
            if not self.authorized(): return self.reply(401, {'error':'Unauthorized'})
            if self.path != '/sync' or int(self.headers.get('Content-Length','0')) != 0:
                return self.reply(400, {'error':'POST /sync accepts no body'})
            ident = uuid.uuid4().hex
            (state / ('request-' + ident + '.json')).write_text(json.dumps({'requestId':ident,'at':time.time()}))
            return self.reply(202, {'status':'queued','requestId':ident})
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server

if __name__ == '__main__':
    raise SystemExit(main())
