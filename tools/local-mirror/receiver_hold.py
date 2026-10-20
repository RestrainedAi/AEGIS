"""No-case-write observer for receiver product-code promotion under a hold."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time


def hold_state(root, observe_only=False):
    hold = Path(root).resolve().parents[1] / '_management/trial_preparation/2026-10-05/search/CATALOG_MAINTENANCE_PAUSED.json'
    try:
        value = json.loads(hold.read_text(encoding='utf-8-sig'))
        released = value.get('status') == 'RELEASED'
        reason = value.get('reason', 'Canonical maintenance hold')
    except (OSError, ValueError):
        released = False
        reason = 'Hold status unavailable or invalid; fail closed'
    return {'status': 'observe_only' if observe_only else ('released' if released else 'held'),
            'hold_path': str(hold), 'reason': 'Explicit no-case-write product promotion' if observe_only else reason,
            'case_writes_allowed': released and not observe_only,
            'receiver_processing': False, 'evidence_dispatch': False, 'sync_api_enabled': False}


def observe_once(root, state, observe_only=False):
    status = hold_state(root, observe_only)
    status['at_utc'] = datetime.now(timezone.utc).isoformat()
    destination = Path(state) / 'hold-status.json'
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(status, indent=2), encoding='utf-8')
    os.replace(temporary, destination)
    return status


def guard_receiver(argv):
    """Handle held launch without importing receiver, auth, queue, or dispatch code.

    Explicit --observe-only never auto-releases, even if a hold file changes.
    Removing that argument is a separate reviewed activation action.
    """
    observe_only = '--observe-only' in argv
    if observe_only:
        argv.remove('--observe-only')
    if '--root' not in argv or '--state' not in argv:
        return False
    root, state = argv[argv.index('--root') + 1], argv[argv.index('--state') + 1]
    if '--library-only' in argv and not observe_only:
        # Explicit scoped activation does not edit or release the global hold.
        # Receiver enforces the dispatch prohibition independently of this guard.
        status = hold_state(root)
        status.update(status='library_only', case_writes_allowed=False,
                      library_writes_allowed=True, receiver_processing=True,
                      evidence_dispatch=False, tagging_dispatch=False, sync_api_enabled=True,
                      reason='Explicit library-only release; canonical evidence remains held',
                      at_utc=datetime.now(timezone.utc).isoformat())
        destination = Path(state) / 'hold-status.json'
        temporary = destination.with_suffix('.tmp')
        temporary.write_text(json.dumps(status, indent=2), encoding='utf-8')
        os.replace(temporary, destination)
        return False
    if hold_state(root, observe_only)['case_writes_allowed']:
        return False
    mode = argv[1] if len(argv) > 1 else ''
    if mode == 'status':
        return False
    while True:
        status = observe_once(root, state, observe_only)
        if mode != 'watch':
            print(json.dumps(status))
            return True
        time.sleep(60)
        # A hold-aware watch stays an observer for this process lifetime. Restart
        # explicitly after release so no file edit silently starts case writes.
