import unittest
from metadata_prefetch import MetadataPrefetch

class Tests(unittest.TestCase):
    def test_matching_metadata_and_single_writer_fetch(self):
        class Transport:
            def inspect(self,url):return {'url':url,'generation':'1'}
            def fetch(self,*args):return args
        csv=b'songKey,account_sourceId,gcs_mp3\na,suno_nessihenize,gs://aeonimus-suno-media/a.mp3\n'
        wrapper=MetadataPrefetch(Transport(),csv,workers=2)
        try:
            self.assertEqual(wrapper.inspect('gs://aeonimus-suno-media/a.mp3')['generation'],'1')
            self.assertEqual(wrapper.fetch('x','1'),('x','1'))
        finally:wrapper.close()

if __name__=='__main__':unittest.main()
