import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from tagging_callback import enqueue


class CallbackTests(unittest.TestCase):
    def test_receipt_and_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root/'evidence-handoff.json'; manifest.write_text('{}')
            digest = hashlib.sha256(manifest.read_bytes()).hexdigest()
            queue = root/'queue.json'; queue.write_text(json.dumps({'source_manifest_sha256':digest,'items':[]}))
            handoff = {'path':str(manifest),'sha256':digest}
            answer = SimpleNamespace(returncode=0, stdout=json.dumps({'status':'queued','items':0,'path':str(queue)}))
            with patch('tagging_callback.subprocess.run', return_value=answer) as run:
                self.assertEqual(enqueue(handoff,root/'adapter.py')['status'],'queued')
                enqueue(handoff,root/'adapter.py')
                self.assertEqual(run.call_count,1)
            manifest.write_text('changed')
            with self.assertRaises(ValueError): enqueue(handoff,root/'adapter.py')

    def test_failure_not_success_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory)/'evidence-handoff.json'; manifest.write_text('{}')
            handoff={'path':str(manifest),'sha256':hashlib.sha256(manifest.read_bytes()).hexdigest()}
            with patch('tagging_callback.subprocess.run', return_value=SimpleNamespace(returncode=1,stderr='failed')):
                with self.assertRaises(RuntimeError):enqueue(handoff,'adapter.py')
            self.assertFalse((manifest.parent/'tagging-callback.json').exists())
