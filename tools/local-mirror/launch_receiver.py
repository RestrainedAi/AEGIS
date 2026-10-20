"""Hidden receiver entry point with durable startup-error logging."""
from pathlib import Path
import runpy
import sys
import traceback

version = Path(__file__).resolve().parent
logs = version.parent.parent / 'logs'
logs.mkdir(parents=True, exist_ok=True)
with (logs / 'receiver.log').open('a', encoding='utf-8', buffering=1) as log:
    sys.stdout = sys.stderr = log
    sys.path.insert(0, str(version))
    sys.argv[0] = str(version / 'receiver.py')
    try:
        from receiver_hold import guard_receiver
        if guard_receiver(sys.argv):
            raise SystemExit(0)
        runpy.run_path(sys.argv[0], run_name='__main__')
    except SystemExit:
        raise
    except BaseException:
        traceback.print_exc()
        raise
