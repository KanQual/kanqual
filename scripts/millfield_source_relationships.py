"""Add content-based source-to-object relationships to the Millfield fixture."""
import re


def rename_people(tables):
    """Give people stable resident labels while retaining their fictional names."""
    definition_id = 'OA-PSEUDONYM'
    stamp = '2026-08-31T12:00:00Z'
    if not any(d['id'] == definition_id for d in tables['object_attribute_definitions']):
        tables['object_attribute_definitions'].append(dict(
            id=definition_id, object_type_id='TYPE-Person', object_type='Person',
            name='pseudonym', data_type='text', created_at=stamp))
    values = {v['object_id']: v for v in tables['object_attribute_values']
              if v['attribute_definition_id'] == definition_id}
    people = sorted((o for o in tables['research_objects'] if o['object_type'] == 'Person'),
                    key=lambda o: o['id'])
    for index, person in enumerate(people, 1):
        if person['id'] not in values:
            tables['object_attribute_values'].append(dict(
                id=f'OV-PSEUDONYM-{index:03}', object_id=person['id'],
                attribute_definition_id=definition_id, value=person['title'], created_at=stamp))
        person['title'] = f'Resident {index:02}'


def add_source_relationships(tables):
    stamp = '2026-08-31T12:00:00Z'
    labels = ['interview with', 'observed at', 'documents event', 'depicts', 'concerns', 'discusses']
    definitions = [dict(id=f'RT-SOURCE-{i+1:02}', name=label, color='#397D68',
        description='Relationship from fictional source material to its subject.', created_at=stamp)
        for i, label in enumerate(labels)]
    tables['relationship_types'][:] = [r for r in tables['relationship_types'] if not r['id'].startswith('RT-SOURCE-')] + definitions
    tables['object_relationships'][:] = [r for r in tables['object_relationships'] if not r['id'].startswith('SREL-')]
    objects = {o['id']: o for o in tables['research_objects']}
    pseudonyms = {v['object_id']: v['value'] for v in tables['object_attribute_values']
                  if v['attribute_definition_id'] == 'OA-PSEUDONYM'}
    # Places named in the five recurring topic narratives, in topic order.
    topic_places = ['Old Mill Site', 'Bus Interchange', 'Market Square', 'Library Hall', 'Canal Walk']
    place_ids = {o['title']: o['id'] for o in objects.values() if o['object_type'] == 'Place'}
    associations = {(r['source_id'], r['object_id']) for r in tables['source_objects']}
    for source in tables['sources']:
        index = int(source['id'].split('-')[1]) - 1
        if index < 20:
            target, label = f'PERSON-{index+1:03}', 'interview with'
        elif index < 30:
            target, label = place_ids[topic_places[index % 5]], 'observed at'
        elif index < 40:
            target, label = f'EVENT-{index % 5+1:03}', 'documents event'
        else:
            target = place_ids[topic_places[index % 5]]
            label = 'depicts' if source['source_kind'] == 'Image' else 'concerns'
        targets = {target: label}
        text = source.get('text_content', '')
        for obj in objects.values():
            name = pseudonyms.get(obj['id'], obj['title'])
            # The two Alex Morgan objects cannot be disambiguated by name alone.
            if name == 'Alex Morgan':
                continue
            if re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', text, re.IGNORECASE):
                targets.setdefault(obj['id'], 'discusses')
        for target, label in targets.items():
            definition = next(d for d in definitions if d['name'] == label)
            tables['object_relationships'].append(dict(
                id=f'SREL-{source["id"]}-{target}', from_object_id=None, to_object_id=target,
                from_entity_type='source', from_entity_id=source['id'],
                to_entity_type='object', to_entity_id=target,
                relationship_type_id=definition['id'], relationship_type=label,
                description=f'Fictional source "{source["title"]}" {label} "{objects[target]["title"]}".',
                created_at=stamp))
            if (source['id'], target) not in associations:
                tables['source_objects'].append(dict(source_id=source['id'], object_id=target, created_at=stamp))
                associations.add((source['id'], target))
