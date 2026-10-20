import asyncio
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import download_media_gcs as media
from audio_integrity import InvalidAudio, expected_duration, validate_audio, validate_video


class AudioIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
            raise RuntimeError('ffmpeg and ffprobe required for audio acceptance tests')
        cls.tmp = tempfile.TemporaryDirectory()
        cls.stub = pathlib.Path(cls.tmp.name) / 'stub.mp3'
        cls.full = pathlib.Path(cls.tmp.name) / 'full.mp3'
        for path, duration in ((cls.stub, '0.096'), (cls.full, '3')):
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                            'sine=frequency=440:sample_rate=48000', '-t', duration,
                            '-c:a', 'libmp3lame', str(path)], check=True)

        cls.video = pathlib.Path(cls.tmp.name) / 'video.mp4'
        cls.silent_video = pathlib.Path(cls.tmp.name) / 'silent.mp4'
        cls.renamed_image = pathlib.Path(cls.tmp.name) / 'image.mp4'
        for path, audio in ((cls.video, True), (cls.silent_video, False)):
            command = ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10']
            if audio:
                command += ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000']
            command += ['-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']
            if audio:
                command += ['-c:a', 'aac']
            subprocess.run(command + [str(path)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32',
                        '-frames:v', '1', '-f', 'image2', '-c:v', 'png', str(cls.renamed_image)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_real_short_mp3_rejected(self):
        with self.assertRaisesRegex(InvalidAudio, 'stub'):
            validate_audio(self.stub)

    def test_complete_audio_decodes(self):
        self.assertAlmostEqual(validate_audio(self.full, 3), 3, delta=0.2)

    def test_longer_preview_rejected_against_source_duration(self):
        with self.assertRaisesRegex(InvalidAudio, 'differs'):
            validate_audio(self.full, 154)

    def test_non_audio_response_rejected(self):
        path = pathlib.Path(self.tmp.name) / 'error.mp3'
        path.write_text('{"error":"not audio"}')
        with self.assertRaises(InvalidAudio):
            validate_audio(path)

    def test_missing_decoder_fails_closed(self):
        with patch('audio_integrity.shutil.which', return_value=None):
            with self.assertRaisesRegex(InvalidAudio, 'requires'):
                validate_audio(self.full)

    def test_bytes_path_never_uploads_stub(self):
        with patch.object(media, 'gs_audio_valid') as existing:
            self.assertFalse(media.stream_bytes_to_gcs(self.stub.read_bytes(), 'gs://bucket/song.mp3'))
            existing.assert_not_called()

    def test_url_path_never_uploads_stub(self):
        real_run = subprocess.run
        uploads = []
        def run(command, **kwargs):
            if command[0] == media.CURL_BIN:
                pathlib.Path(command[command.index('-o') + 1]).write_bytes(self.stub.read_bytes())
                return subprocess.CompletedProcess(command, 0, b'', b'')
            if command[0] == media.GSUTIL_BIN:
                uploads.append(command)
                raise AssertionError('stub reached storage')
            return real_run(command, **kwargs)
        with patch.object(media.subprocess, 'run', side_effect=run):
            self.assertFalse(media.stream_to_gcs('https://example.com/song.mp3', 'gs://bucket/song.mp3'))
        self.assertEqual(uploads, [])

    def test_existing_invalid_original_is_not_overwritten(self):
        real_run = subprocess.run
        storage_calls = []
        def run(command, **kwargs):
            if command[0] == media.GSUTIL_BIN:
                storage_calls.append(command)
                self.assertEqual(command[1], 'stat')
                return subprocess.CompletedProcess(command, 0, b'Content-Length: 4844', b'')
            return real_run(command, **kwargs)
        with patch.object(media.subprocess, 'run', side_effect=run), patch.object(media, 'gs_audio_valid', return_value=False):
            self.assertFalse(media.stream_bytes_to_gcs(self.full.read_bytes(), 'gs://bucket/song.mp3', 3))
        self.assertEqual(len(storage_calls), 1)

    def test_no_clobber_race_is_not_reported_as_success(self):
        with patch.object(media, 'validate_audio'), patch.object(media, 'gs_audio_valid', return_value=False), patch.object(media.subprocess, 'run', side_effect=[subprocess.CompletedProcess([], 1, b'', b'not found'), subprocess.CompletedProcess([], 0, b'', b'')]) as run:
            self.assertFalse(media.upload_validated_file(self.full, 'gs://bucket/song.mp3', 3))
            self.assertIn('-n', run.call_args_list[1].args[0])

    def test_existing_m4a_selected_only_after_validation(self):
        with patch.object(media, 'gs_video_valid', return_value=True), patch.object(media, 'gs_exists', return_value=True), patch.object(media, 'gs_audio_valid', side_effect=[False, True]) as check:
            result = asyncio.run(media.process_clip({'songKey': 'id', 'reason': 'new', 'duration': '154'}))
        self.assertTrue(result['audio'])
        self.assertEqual(result['audio_ext'], 'm4a')
        self.assertEqual(check.call_args.args[1], 154)

    def test_missing_optional_assets_are_not_claimed_present(self):
        with patch.object(media, 'gs_exists', side_effect=lambda uri: uri.endswith('.mp3')), patch.object(media, 'gs_audio_valid', return_value=True), patch.object(media, 'intercept_clip_media', new=AsyncMock(return_value={})):
            result = asyncio.run(media.process_clip({'songKey': 'id', 'reason': 'new'}))
        self.assertTrue(result['audio'])
        self.assertFalse(result['video'])
        self.assertFalse(result['thumb'])

    def test_real_song_video_decodes_both_streams(self):
        durations = validate_video(self.video, 3)
        self.assertAlmostEqual(durations['audio_seconds'], 3, delta=0.2)
        self.assertAlmostEqual(durations['video_seconds'], 3, delta=0.2)

    def test_renamed_image_is_not_a_song_video(self):
        with self.assertRaises(InvalidAudio):
            validate_video(self.renamed_image)

    def test_video_without_audio_is_rejected(self):
        with self.assertRaisesRegex(InvalidAudio, 'audio stream'):
            validate_video(self.silent_video)

    def test_audio_only_payload_is_not_a_video(self):
        with self.assertRaisesRegex(InvalidAudio, 'video stream'):
            validate_video(self.full)

    def test_video_preview_is_rejected(self):
        with self.assertRaisesRegex(InvalidAudio, 'differs'):
            validate_video(self.video, 321)

    def test_captured_png_masquerading_as_mp4_never_reaches_storage(self):
        with patch.object(media, 'gs_video_valid') as stored:
            self.assertFalse(media.stream_bytes_to_gcs(self.renamed_image.read_bytes(), 'gs://bucket/song.mp4'))
            stored.assert_not_called()

    def test_existing_invalid_video_is_not_overwritten(self):
        with patch.object(media, 'validate_video'), patch.object(media, 'gs_video_valid', return_value=False), patch.object(media.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'', b'')) as run:
            self.assertFalse(media.upload_validated_file(self.video, 'gs://bucket/song.mp4', 3))
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][1], 'stat')

    def test_long_audio_missing_fifteen_seconds_is_rejected(self):
        responses = [subprocess.CompletedProcess([], 0, '{"streams":[{"codec_type":"audio"}]}', ''),
                     subprocess.CompletedProcess([], 0, 'out_time_us=385000000\n', '')]
        with patch('audio_integrity.subprocess.run', side_effect=responses):
            with self.assertRaisesRegex(InvalidAudio, '385.000s differs from expected 400.000s'):
                validate_audio(self.full, 400)

    def test_long_video_track_missing_fifteen_seconds_is_rejected(self):
        responses = [subprocess.CompletedProcess([], 0, '{"streams":[{"codec_type":"video","width":64,"height":64}]}', ''),
                     subprocess.CompletedProcess([], 0, 'out_time_us=385000000\n', '')]
        with patch('audio_integrity.validate_audio', return_value=400), patch('audio_integrity.subprocess.run', side_effect=responses):
            with self.assertRaisesRegex(InvalidAudio, '385.000s differs from expected/audio 400.000s'):
                validate_video(self.video, 400)

    def test_invalid_captured_video_retries_full_url(self):
        captured = {'video_bytes': b'incomplete response', 'video_url': 'https://example.com/full.mp4'}
        with patch.object(media, 'gs_exists', side_effect=lambda uri: not uri.endswith('.mp4')), patch.object(media, 'gs_audio_valid', return_value=True), patch.object(media, 'intercept_clip_media', new=AsyncMock(return_value=captured)), patch.object(media, 'stream_bytes_to_gcs', return_value=False) as byte_upload, patch.object(media, 'stream_to_gcs', return_value=True) as url_upload:
            result = asyncio.run(media.process_clip({'songKey': 'id', 'handle': 'handle', 'reason': 'new', 'duration': '154'}))
        self.assertTrue(result['video'])
        byte_upload.assert_called_once_with(b'incomplete response', media.gcs_path('handle', 'id', 'mp4'), expected_seconds=154)
        url_upload.assert_called_once_with('https://example.com/full.mp4', media.gcs_path('handle', 'id', 'mp4'), expected_seconds=154)

    def test_expected_duration_ignores_nan_and_accepts_alias(self):
        self.assertEqual(expected_duration({'duration': 'nan', 'durationSeconds': '154'}), 154)


if __name__ == '__main__':
    unittest.main()
