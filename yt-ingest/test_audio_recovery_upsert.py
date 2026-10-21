import copy
import sys
import types
import unittest
from unittest.mock import patch
import firestore_upsert as m

R = dict(kind='derived-from-video', nativeOriginal=False,
         derivedAudioUrl='gs://bucket/derived/listening-copy.mp3', derivedSha256='a'*64,
         originalAudioUrl='gs://bucket/original.mp3', originalGeneration='1', originalSha256='b'*64,
         sourceVideoUrl='gs://bucket/source.mp4', sourceVideoGeneration='2', sourceVideoSha256='c'*64,
         provenanceUrl='gs://bucket/derived/provenance.json', verifiedAt='2026-10-15T00:00:00Z')


def document():
    return {'media': {'audioUrl': R['derivedAudioUrl'], 'audioRecovery': copy.deepcopy(R)}}


class DB:
    def __init__(self, values):
        self.values, self.reads, self.writes = values, 0, []
    def collection(self, name):
        assert name == 'sunoSongs'
        return self
    def document(self, key): return self
    def transaction(self): return self
    def get(self, transaction):
        val = self.values[min(self.reads, len(self.values)-1)]
        self.reads += 1
        return types.SimpleNamespace(exists=val is not None, to_dict=lambda: copy.deepcopy(val))
    def set(self, ref, payload, merge):
        assert merge
        self.writes.append(copy.deepcopy(payload))


class RecoveryTests(unittest.TestCase):
    def upsert(self, values, attempts=1, **kwargs):
        db = DB(values)
        def transactional(fn):
            def wrapped(tx):
                for _ in range(attempts): fn(tx)
            return wrapped
        stub = types.ModuleType('google.cloud.firestore')
        stub.transactional = transactional
        with patch.dict(sys.modules, {'google.cloud.firestore': stub}):
            ok = m.upsert_song_after_download('uuid', 'nessihenize', db=db, **kwargs)
        return ok, db

    def test_normal_harvest_preserves_selection(self):
        ok, db = self.upsert([document()], has_audio=True, title='Updated title')
        self.assertTrue(ok)
        self.assertEqual(db.writes[0]['media']['audioUrl'], R['derivedAudioUrl'])
        self.assertEqual(db.writes[0]['media']['audioRecovery'], R)
        self.assertEqual(db.writes[0]['title'], 'Updated title')

    def test_false_audio_preserves_selection(self):
        ok, db = self.upsert([document()], has_audio=False, caption='new caption')
        self.assertTrue(ok)
        self.assertTrue(db.writes[0]['gcs']['audio'])
        self.assertEqual(db.writes[0]['media']['audioExt'], 'mp3')

    def test_retry_sees_concurrent_repair(self):
        ok, db = self.upsert([{}, document()], attempts=2)
        self.assertTrue(ok)
        self.assertEqual(db.reads, 2)
        self.assertEqual(db.writes[-1]['media']['audioUrl'], R['derivedAudioUrl'])

    def test_new_record_native_behavior(self):
        ok, db = self.upsert([None])
        self.assertTrue(ok)
        self.assertNotIn('audioRecovery', db.writes[0]['media'])
        self.assertTrue(db.writes[0]['media']['audioUrl'].endswith('/uuid.mp3'))

    def test_incomplete_fails_without_write(self):
        d = document()
        del d['media']['audioRecovery']['verifiedAt']
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_inconsistent_selection_fails_without_write(self):
        d = document()
        d['media']['audioUrl'] = 'gs://bucket/different.mp3'
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_unverified_map_fails_without_write(self):
        d = document()
        d['media']['audioRecovery']['nativeOriginal'] = True
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_native_success_does_not_supersede(self):
        ok, db = self.upsert([document()], has_audio=True, audio_ext='m4a')
        self.assertTrue(ok)
        self.assertEqual(db.writes[0]['media']['audioUrl'], R['derivedAudioUrl'])

    def missing_original(self):
        d = document()
        d['media']['audioRecovery'].update(originalMissing=True, originalGeneration='', originalSha256='')
        return d

    def test_original_missing_preserves_selection(self):
        d = self.missing_original()
        ok, db = self.upsert([d], has_audio=False)
        self.assertTrue(ok)
        self.assertEqual(db.writes[0]['media']['audioUrl'], R['derivedAudioUrl'])
        self.assertEqual(db.writes[0]['media']['audioRecovery'], d['media']['audioRecovery'])
        self.assertTrue(db.writes[0]['gcs']['audio'])

    def test_empty_original_without_flag_still_fails(self):
        d = self.missing_original()
        del d['media']['audioRecovery']['originalMissing']
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_original_missing_with_original_hash_fails(self):
        d = self.missing_original()
        d['media']['audioRecovery']['originalSha256'] = 'b'*64
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_original_missing_non_bool_fails(self):
        d = self.missing_original()
        d['media']['audioRecovery']['originalMissing'] = 'yes'
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])

    def test_original_missing_still_checks_derived_hash(self):
        d = self.missing_original()
        d['media']['audioRecovery']['derivedSha256'] = 'zz'
        ok, db = self.upsert([d])
        self.assertFalse(ok)
        self.assertEqual(db.writes, [])


if __name__ == '__main__': unittest.main()
