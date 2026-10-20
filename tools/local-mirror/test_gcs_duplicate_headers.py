from email.message import Message
from unittest.mock import patch, MagicMock
import unittest
from local_mirror import SecureGcsTransport

class DuplicateHeaderTests(unittest.TestCase):
    def test_real_gcs_separate_crc_and_md5_headers(self):
        headers = Message()
        headers['Content-Length'] = '4'
        headers['X-Goog-Generation'] = '1234'
        headers['X-Goog-Hash'] = 'crc32c=abcd'
        headers['X-Goog-Hash'] = 'md5=verified-md5'
        response = MagicMock()
        response.headers = headers
        response.read.return_value = b'data'
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch('local_mirror.urllib.request.build_opener', return_value=opener):
            transport = SecureGcsTransport({'bucket'}, lambda: 'fake-token')
            self.assertEqual(transport.inspect('gs://bucket/song')['md5'], 'verified-md5')
            data, saved = transport.fetch('gs://bucket/song', '1234')
            self.assertEqual(data, b'data')
            self.assertEqual(saved['x-goog-hash'], 'crc32c=abcd, md5=verified-md5')
