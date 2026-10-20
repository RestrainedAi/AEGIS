"""Bounded concurrent HEAD requests; one sequential acquisition/catalog writer."""
from concurrent.futures import ThreadPoolExecutor
from local_mirror import ACCOUNTS, ASSETS, csv_rows, gcs_url

class MetadataPrefetch:
    def __init__(self, transport, catalog, workers=8):
        self.transport=transport
        self.pool=ThreadPoolExecutor(max_workers=workers,thread_name_prefix='sundrop-metadata')
        urls=[]
        for row in csv_rows(catalog):
            if row.get('account_sourceId') not in ACCOUNTS:continue
            for kind in (*ASSETS,'gcs_latest_audio','gcs_latest_mp4','gcs_latest_thumb'):
                if row.get(kind):
                    try:urls.append(gcs_url(row[kind]))
                    except ValueError:pass
        self.urls=iter(dict.fromkeys(urls));self.pending={};self.window=workers*4
        self._fill()

    def _fill(self):
        while len(self.pending)<self.window:
            source=next(self.urls,None)
            if source is None:break
            self.pending[source]=self.pool.submit(self.transport.inspect,source)

    def inspect(self,source):
        source=gcs_url(source)
        future=self.pending.pop(source,None)
        result=future.result() if future else self.transport.inspect(source)
        self._fill()
        return result

    def fetch(self,*args):return self.transport.fetch(*args)
    def __call__(self,*args):return self.transport(*args)
    def close(self):self.pool.shutdown(wait=True,cancel_futures=True)

def sync_with_prefetch(root,catalog,run_id,transport):
    from local_mirror import sync_catalog
    proxy=MetadataPrefetch(transport,catalog)
    try:return sync_catalog(root,catalog,run_id,proxy)
    finally:proxy.close()
