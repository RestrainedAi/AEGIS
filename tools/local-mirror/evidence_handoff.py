"""Immutable producer handoffs; never acquires/writes Anchor's canonical catalog."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def publish(root, result, outbox):
    root = Path(root).resolve(); outbox = Path(outbox).resolve()
    run_id = result['run_id']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}',run_id):
        raise ValueError('Invalid handoff run ID')
    run = root / 'Catalog/Maintenance' / run_id
    target = outbox / run_id / 'evidence-handoff.json'
    if target.exists():
        existing=json.loads(target.read_text())
        if existing['run_id'] != run_id: raise ValueError('Handoff identity conflict')
        if existing.get('catalog_source_sha256')!=result.get('catalog_sha256'):raise ValueError('Handoff source snapshot changed')
        for item in existing['items']:
            if sha(item['path'])!=item['sha256'] or Path(item['path']).stat().st_size!=item['bytes']:
                raise ValueError('Previously staged handoff bytes changed')
        return {'path':str(target),'sha256':sha(target),'status':'STAGED'}
    items=[]; seen=set(); at=datetime.now(timezone.utc).isoformat()
    def add(path, role, source=None, song=None, relation=None, expected_sha=None, expected_bytes=None, recovery=None):
        path=Path(path).resolve()
        if not path.is_relative_to(root) or not path.is_file():raise ValueError('Handoff path not preserved in library')
        digest=sha(path)
        if expected_sha is not None and digest!=expected_sha:raise ValueError('Handoff bytes differ from sync verification')
        if expected_bytes is not None and path.stat().st_size!=int(expected_bytes):raise ValueError('Handoff size differs from sync verification')
        if str(path) in seen:
            if next(i for i in items if i['path']==str(path))['role']!=role:raise ValueError('Conflicting roles for preserved path')
            return
        seen.add(str(path))
        items.append({'item_id':hashlib.sha256(str(path).encode()).hexdigest()[:24],
                      'path':str(path),'title':path.name,'original_filename':path.name,'media_type':path.suffix.lstrip('.'),
                      'role':role,'bytes':path.stat().st_size,'sha256':digest,'verified_at_utc':at,
                      'provenance':{'original_path':str(path),'source_url':source,'provider':'Sundrop Vault',
                                    'song_id':song,'acquisition_method':'Machine-auth GCS byte preservation' if role=='native' else 'Local derived catalog or provenance preservation',
                                    'acquired_at_utc':result.get('at'),'source_timestamps':{'status':'See frozen catalog; unknown if not supplied'},
                                    'custody':'Originals retained; changes preserved as separate versions',
                                    **({'native_original':False,'audio_recovery':recovery} if recovery else {})},
                      'relationships':[] if relation is None else [relation],
                      'review_status':'UNREVIEWED','limitations':'Byte verification is not authorship, factual, legal, or media-completeness verification.',
                      'prior_canonical_id':None})
    for asset in result.get('added_files',[]):
        role=asset.get('native_or_derivative','native')
        is_derived=asset.get('kind','').startswith('derived') or '/derived/' in asset.get('source','')
        relation=None; recovery=None
        if is_derived and role not in ('derivative','provenance_manifest'):
            raise ValueError('Derived asset cannot be published as native')
        if role not in ('native','derivative','provenance_manifest'):
            raise ValueError('Unsupported acquired asset role')
        if role=='derivative':
            recovery=asset.get('audio_recovery',{})
            if asset.get('native_original') is not False or recovery.get('nativeOriginal') is not False or recovery.get('kind')!='derived-from-video' or recovery.get('derivedSha256')!=asset['sha256']:
                raise ValueError('Malformed derivative provenance')
            parent=root/asset.get('source_video_path','')
            add(parent,'native',recovery.get('sourceVideoUrl'),asset.get('songKey'),expected_sha=recovery.get('sourceVideoSha256'))
            relation={'type':'derived_from','target_item_id':hashlib.sha256(str(parent.resolve()).encode()).hexdigest()[:24],
                      'target_path':str(parent.resolve()),'target_sha256':recovery['sourceVideoSha256'],
                      'target_run_id':run_id,'target_evd_id':None}
            original=next((a for a in result.get('assets',[]) if a.get('songKey')==asset.get('songKey') and a.get('kind')=='gcs_mp3' and a.get('status') in ('saved','unchanged_verified')),None)
            if not original:raise ValueError('Preserved native original missing from derivative handoff')
            add(root/original['path'],'native',recovery.get('originalAudioUrl'),asset.get('songKey'),expected_sha=recovery.get('originalSha256'),expected_bytes=original['bytes'])
        add(root/asset['path'],role,asset.get('source'),asset.get('songKey'),relation=relation,expected_sha=asset['sha256'],expected_bytes=asset['bytes'],recovery=recovery)
    manifests={entry['path']:entry for entry in result.get('commit_manifest',[])}
    for entry in result.get('catalog_updates',[]):
        rel=entry['path']; before=run/'before'/rel; staged=run/'staged'/rel
        if before.exists():add(before,'prior_generated_catalog',expected_sha=manifests[rel]['before_sha256'])
        relationship={'type':'version_of','target_item_id':hashlib.sha256(str(before.resolve()).encode()).hexdigest()[:24] if before.exists() else None,
                      'target_run_id':run_id,'target_evd_id':None,'target_path':str(before) if before.exists() else None,'target_sha256':sha(before) if before.exists() else None}
        add(staged,'generated_catalog',relation=relationship,expected_sha=entry['sha256'])
    for name in ('vault-catalog-source.csv','receipt.json','evidence-handoff.json'):
        if (run/name).exists():add(run/name,'provenance_manifest')
    for supporting in result.get('supporting_files',[]):
        add(root/supporting['path'],'provenance_manifest',expected_sha=supporting['sha256'],expected_bytes=supporting['bytes'])
    body={'schema_version':'suno-evidence-handoff/1','run_id':run_id,'created_at_utc':at,'producer':'Cadence','producer_version':'local-mirror-1',
          'status':'STAGED','scope':{'accounts':['suno_unshakableechos2341','suno_nessihenize'],'library':str(root),'limits':result.get('limitations')},
          'catalog_source_sha256':result.get('catalog_sha256'),
          'supersedes_run_id':None,'items':items,
          'coverage':{'expected_items':len(items),'supplied_items':len(items),
                      'missing':[a for a in result.get('assets',[]) if a.get('status')=='absent_source'],
                      'errors':result.get('failures',[]),'historical_gap_rows':result.get('remaining_gap_rows'),
                      'native_audio_unresolved_count':result.get('native_audio_unresolved_count')},
          'artifacts':[]}
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_suffix('.tmp')
    with temporary.open('x',encoding='utf-8') as f:
        json.dump(body,f,indent=2);f.flush()
        import os
        os.fsync(f.fileno())
    # Windows rename fails rather than replaces existing destination.
    if target.exists():raise ValueError('Concurrent handoff publisher')
    temporary.rename(target)
    return {'path':str(target),'sha256':sha(target),'status':'STAGED'}

def read_ack(handoff):
    path=Path(handoff['path']); expected=sha(path)
    if expected!=handoff['sha256']:raise ValueError('Published handoff baseline changed')
    body=json.loads(path.read_text()); known={item['item_id']:item for item in body['items']}
    answers=[]
    for candidate in sorted(path.parent.glob('acknowledgment-*.json')):
        ack=json.loads(candidate.read_text())
        if ack.get('schema_version')!='suno-evidence-ack/1' or ack.get('handoff_sha256')!=expected or ack.get('run_id')!=body['run_id'] or ack.get('owner')!='Anchor':
            continue
        if ack.get('status')=='ACCEPTED':
            mappings={item['item_id']:item for item in ack.get('mapping',[])}
            if set(mappings)!=set(known):continue
            if not ack.get('verification') or not ack.get('exports'):continue
            if any(mappings[key].get('sha256')!=item['sha256'] or mappings[key].get('path')!=item['path']
                   or not re.fullmatch(r'EVD-\d+',str(mappings[key].get('evd_id','')))
                   or mappings[key].get('disposition') not in ('new','existing_same_file','versioned')
                   or not mappings[key].get('verification_status') for key,item in known.items()):continue
        answers.append((int(ack['sequence']),candidate,ack))
    if not answers:return {'status':'UNACKNOWLEDGED'}
    _,path,ack=max(answers,key=lambda x:x[0])
    return {'status':ack['status'],'path':str(path),'sha256':sha(path),'exports':ack.get('exports'), 'mapping':ack.get('mapping',[])}
