"""Validate generated Millfield content, attachment hashes and media decoding."""
from pathlib import Path
from collections import Counter
import base64
import hashlib
import json
import subprocess
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'docs/test-project/millfield'
payload = json.loads((root / 'millfield-project.json').read_text(encoding='utf-8'))
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
tables = {t['name']: t['rows'] for t in payload['tables']}
assert payload['format'] == 'kanqual-project-export' and payload['version'] == 1
assert Counter(s['source_kind'] for s in tables['sources']) == {'Text':40, 'Audio':5, 'Video':10, 'Image':20, 'PDF':15}
for table, count in [('research_objects',50),('object_relationships',472),('codes',20),('annotations',360),('memos',15),('reports',8)]:
    assert len(tables[table]) == count
sources = {s['id']: s for s in tables['sources']}
for index in range(1,21):
    text = sources[f'SRC-{index:03}']['text_content']
    paragraphs = text.split('\n\n')
    assert len([p for p in paragraphs if p.startswith('Interviewer: ')]) == 10
    assert len([p for p in paragraphs if p.startswith('Participant (')]) == 10
    assert not any(label in text for label in ['Research note:', 'Closing reflection:', 'Extended observation'])
objects = {o['id'] for o in tables['research_objects']}
people = sorted((o for o in tables['research_objects'] if o['object_type'] == 'Person'), key=lambda o: o['id'])
assert [o['title'] for o in people] == [f'Resident {i:02}' for i in range(1, 26)]
pseudonyms = {v['object_id']: v['value'] for v in tables['object_attribute_values'] if v['attribute_definition_id'] == 'OA-PSEUDONYM'}
assert set(pseudonyms) == {o['id'] for o in people}
assert all(pseudonyms.values())
assert pseudonyms['PERSON-024'] == pseudonyms['PERSON-025'] == 'Alex Morgan'
assets = {a['fileName']:a for a in payload['assets']}
meta = {s['id']:s for s in manifest['sources']}
assert len(assets) == 90
assert {link['object_id'] for link in tables['source_objects']} == objects
assert {link['source_id'] for link in tables['source_objects']} == set(sources)
assert len({(r['from_entity_type'],r['from_entity_id'],r['to_entity_id'],r['relationship_type_id']) for r in tables['object_relationships']}) == 472
assert {r['from_entity_id'] for r in tables['object_relationships'] if r['from_entity_type']=='source'} == set(sources)
for row in tables['object_relationships']:
    assert row['to_object_id'] in objects and row['to_entity_id'] == row['to_object_id']
    if row['from_entity_type'] == 'source':
        assert row['from_entity_id'] in sources and row['from_object_id'] is None
    else:
        assert row['from_object_id'] in objects and row['from_entity_id'] == row['from_object_id']
for source in sources.values():
    item = meta[source['id']]
    path = root / item['file']
    data = path.read_bytes()
    assert base64.b64decode(assets[source['storage_path']]['dataBase64'], validate=True) == data
    assert hashlib.sha256(data).hexdigest() == item['sha256']
    if source['source_kind'] == 'Image':
        with Image.open(path) as image:
            assert list(image.size) == item['dimensions']
            image.verify()
    if source['source_kind'] in ('Audio','Video'):
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
        duration = float(probe['format']['duration'])*1000
        assert abs(duration-item['durationMs']) < 2000
        assert any(s['codec_type']=='audio' for s in probe['streams'])
        if source['source_kind']=='Video': assert any(s['codec_type']=='video' for s in probe['streams'])
        subprocess.run(['ffmpeg','-hide_banner','-v','error','-xerror','-i',str(path),'-f','null','-'],check=True)
for annotation in tables['annotations']:
    source = sources[annotation['source_id']]
    if annotation['anchor_kind'] == 'text_span':
        text = source['text_content']
        assert text[annotation['start_offset']:annotation['end_offset']] == annotation['quote']
        # JS uses UTF-16 offsets; this fixture avoids supplementary characters.
        assert len(text.encode('utf-16-le'))//2 == len(text)
    elif annotation['anchor_kind'] == 'time_range':
        assert 0 <= annotation['time_start_ms'] < annotation['time_end_ms'] <= meta[source['id']]['durationMs']
    else:
        r = json.loads(annotation['region_selector_json'])
        assert 0 <= r['x'] < r['x']+r['width'] <= r['imageWidth']
        assert 0 <= r['y'] < r['y']+r['height'] <= r['imageHeight']
        if source['source_kind'] == 'PDF': assert 1 <= r['pageNumber'] <= meta[source['id']]['pages']
for report in tables['reports']:
    snapshot = json.loads(report['content_json'])
    assert len(snapshot['codes']) == 20
    assert len(snapshot['documents']) > 0
    assert len(snapshot['annotations']) == 4*len(snapshot['documents'])
result = {'passed': True, 'sources':90, 'objects':50, 'relationships':472, 'annotations':360,
    'attachmentHashesVerified':90, 'imagesVerified':20, 'mediaFilesDecoded':15,
    'notes':'PDF readability and actual database import are checked separately.'}
(root/'validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
