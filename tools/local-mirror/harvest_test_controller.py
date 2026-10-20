"""Finite real-harvest verification. Machine broker only; never invokes gcloud/ADC."""
import argparse
import contextlib
import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
import uuid

import requests

AUTH_DIR = Path(r'E:\_Vanessa sux\___Divorce\_SUNO\Vanessa-Vault-decbb81b0b4a344b')
RUNTIME = AUTH_DIR / 'runtime'
STATE = RUNTIME / 'six-cycle-test.json'
JOB = 'projects/stable-framing-482501-t9/locations/us-central1/jobs/suno-harvest'
API = 'https://run.googleapis.com/v2/'
BROKER = 'https://suno-viewer-gyw66cuxzq-uc.a.run.app/api/local-mirror/harvest-test-token'


def save(state):
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps(state, indent=2), encoding='utf-8')
    os.replace(temp, STATE)


def terminal(execution):
    if execution.get('completionTime'):
        return True
    return any(c.get('type') == 'Completed' and c.get('state') in
               ('CONDITION_SUCCEEDED', 'CONDITION_FAILED') for c in execution.get('conditions', []))


def launch_allowed(state, executions, now):
    if state.get('dispatch_pending'):
        return False, 'dispatch_uncertain_requires_reconciliation'
    if len(state['executions']) >= 6:
        return False, 'six_dispatched'
    if any(not terminal(e) for e in executions):
        return False, 'existing_harvest_running'
    if state['executions'] and now - max(e['dispatched_at'] for e in state['executions']) < 21600:
        return False, 'six_hour_cooldown'
    return True, 'ready'


class Client:
    def __init__(self):
        sys.path.insert(0, str(AUTH_DIR))
        import sundrop_storage_auth as auth
        info = json.loads(auth._crypt(auth.KEY_PATH.read_bytes(), False))
        auth.validate_info(info)
        if info['type'] != 'sundrop_keyless_client':
            raise RuntimeError('Protected machine broker client required')
        self.secret = info['client_secret']
        self.token = None
        self.expires = 0

    def refresh(self):
        r = requests.post(BROKER, headers={'Authorization': 'Bearer ' + self.secret},
                          timeout=60, allow_redirects=False)
        if r.status_code != 200:
            raise RuntimeError('Harvest machine broker HTTP ' + str(r.status_code))
        data = r.json()
        expires = dt.datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00')).timestamp()
        if not data.get('access_token') or not time.time() + 60 < expires <= time.time() + 660:
            raise RuntimeError('Invalid machine token lifetime')
        self.token, self.expires = data['access_token'], expires

    def call(self, path, method='GET', body=None):
        if not self.token or time.time() > self.expires - 90:
            self.refresh()
        for attempt in range(2):
            r = requests.request(method, API + path, json=body,
                                 headers={'Authorization': 'Bearer ' + self.token},
                                 timeout=90, allow_redirects=False)
            if r.status_code == 401 and attempt == 0:
                self.refresh()
                continue
            if not r.ok:
                raise RuntimeError('Cloud Run HTTP ' + str(r.status_code) + ' for ' + method)
            return r.json()
        raise RuntimeError('Cloud Run machine authentication failed')

    def executions(self):
        result = []
        page = ''
        while True:
            suffix = '?pageSize=100' + ('&pageToken=' + requests.utils.quote(page, safe='') if page else '')
            data = self.call(JOB + '/executions' + suffix)
            result.extend(data.get('executions', []))
            page = data.get('nextPageToken')
            if not page:
                return result


@contextlib.contextmanager
def locked():
    import msvcrt
    with (RUNTIME / 'six-cycle-test.lock').open('a+b') as f:
        f.seek(0)
        if not f.read(1):
            f.write(b'0'); f.flush()
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            yield
        finally:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def run(launch=False):
    with locked():
        state = json.loads(STATE.read_text(encoding='utf-8-sig'))
        client = Client()
        client.call(JOB)
        remote = client.executions()
        by_name = {e['name']: e for e in remote}
        for record in state['executions']:
            execution = by_name.get(record['name']) or client.call(record['name'])
            record['terminal'] = terminal(execution)
            record['execution'] = execution
        state['completed_cycles'] = sum(bool(e.get('terminal')) for e in state['executions'])
        state['last_checked_at'] = time.time()
        state['blockers'] = []
        allowed, reason = launch_allowed(state, remote, time.time())
        state['status'] = 'finished_six_executions' if state['completed_cycles'] == 6 else reason
        save(state)
        if launch and allowed:
            # Persist BEFORE dispatch: an interrupted/uncertain POST must never be repeated blindly.
            state['dispatch_pending'] = {'id': str(uuid.uuid4()), 'started_at': time.time(),
                                         'prior_names': list(by_name)}
            save(state)
            operation = client.call(JOB + ':run', 'POST', {})
            name = operation.get('metadata', {}).get('name', '')
            if not name.startswith(JOB + '/executions/'):
                state['dispatch_pending']['operation'] = operation
                save(state)
                raise RuntimeError('Dispatch response needs execution reconciliation; will not retry')
            state['executions'].append({'cycle': len(state['executions']) + 1, 'name': name,
                                        'dispatched_at': state['dispatch_pending']['started_at'],
                                        'operation_name': operation.get('name'), 'terminal': False})
            del state['dispatch_pending']
            state['status'] = 'running'
            save(state)
        print(json.dumps({'status': state['status'], 'dispatched': len(state['executions']),
                          'terminal': state['completed_cycles'],
                          'executions': [{'cycle': e['cycle'], 'name': e['name'],
                                          'terminal': e.get('terminal')} for e in state['executions']]}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch', action='store_true')
    args = parser.parse_args()
    try:
        run(args.launch)
    except Exception as exc:
        # Do not dump HTTP bodies, tokens, or protected client credentials.
        print('Harvest test blocked: ' + str(exc), file=sys.stderr)
        sys.exit(1)
