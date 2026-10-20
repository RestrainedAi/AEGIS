import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from receiver import Receiver, PREFIX, INDEX, object_url

class Tests(unittest.TestCase):
    def setup_receiver(self, root, ids, result=None):
        objects = {}; index = {'schemaVersion':1,'runs':[]}; calls=[]
        for run in ids:
            data=b'songKey,account_sourceId\nx,suno_nessihenize\n'
            name=PREFIX+run+'/catalog.csv'
            receipt={'schemaVersion':1,'runId':run,'artifacts':{'catalog':{'bucket':'aeonimus-workspaces','object':name,'generation':'2','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}}}
            raw=json.dumps(receipt).encode(); recname=PREFIX+run+'/receipt.json'
            index['runs'].append({'runId':run,'receiptObject':recname,'generation':'3','sha256':hashlib.sha256(raw).hexdigest()})
            objects[object_url(recname,'3')]=raw; objects[object_url(name,'2')]=data
        objects[object_url(INDEX)]=json.dumps(index).encode()
        def transport(url):return objects[url],{}
        def sync(*args):calls.append(args[2]);return result or {'status':'partial','failure_count':0,'remaining_gap_rows':310,'evidence_status':'pending'}
        return Receiver(Path(root)/'state',root,transport,sync),objects,calls

    def test_offline_history_and_duplicate_delivery(self):
        with tempfile.TemporaryDirectory() as root:
            r,_,calls=self.setup_receiver(root,['run1','run2'])
            r.discover();r.process();r.process();r.discover();self.assertIsNone(r.process())
            self.assertEqual(len(calls),2)
            self.assertEqual({x['status'] for x in r.status()},{'awaiting_evidence'})
            r.db.close()

    def test_tampering_blocks_sync(self):
        with tempfile.TemporaryDirectory() as root:
            r,objects,calls=self.setup_receiver(root,['run1']);r.discover()
            objects[object_url(PREFIX+'run1/catalog.csv','2')]=b'bad'
            with self.assertRaises(ValueError):r.process()
            self.assertEqual(calls,[]);self.assertEqual(r.status()[0]['status'],'retry');r.db.close()

    def test_crash_replays_same_attempt_id(self):
        with tempfile.TemporaryDirectory() as root:
            r,_,calls=self.setup_receiver(root,['run1']);r.discover()
            r.db.execute("UPDATE events SET status='running',attempts=1");r.db.commit()
            r.process();self.assertTrue(calls[0].endswith('-attempt-1'));r.db.close()

    def test_commit_block_never_acknowledged(self):
        with tempfile.TemporaryDirectory() as root:
            r,_,calls=self.setup_receiver(root,['run1'],{'status':'blocked','reconciliation_required':True})
            r.discover();r.process();self.assertEqual(r.status()[0]['status'],'blocked');self.assertIsNone(r.process());r.db.close()

    def test_changed_index_identity_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            r,objects,_=self.setup_receiver(root,['run1']);r.discover()
            data=json.loads(objects[object_url(INDEX)]);data['runs'][0]['sha256']='bad';objects[object_url(INDEX)]=json.dumps(data).encode()
            with self.assertRaises(ValueError):r.discover()
            r.db.close()

if __name__=='__main__':unittest.main()
