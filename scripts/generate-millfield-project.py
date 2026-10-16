"""Generate a self-contained KanQual import fixture. Requires Pillow, FFmpeg,
and Windows System.Speech. Run `python scripts/generate-millfield-project.py`.
Generated files live in ignored docs/test-project/millfield, not Git.
All participants, statements, documents and media are fictional test material.
"""
from pathlib import Path
from collections import defaultdict, Counter
import base64
import hashlib
import json
import subprocess
import textwrap
import wave
from PIL import Image, ImageDraw, ImageFont
from millfield_source_relationships import add_source_relationships, rename_people

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/test-project/millfield'
FILES = OUT / 'files'
FILES.mkdir(parents=True, exist_ok=True)
TABLES = defaultdict(list)
MANIFEST = []
STAMP = '2026-08-31T12:00:00Z'
DISCLAIMER = 'FICTIONAL TEST DATA. No real people, research interviews or documentary footage.'
DESCRIPTION = ('Life in Millfield explores how residents, organizations, and local institutions experience community change in a fictional town. '
    'Through interviews, observations, photographs, recordings, and public documents, the study examines housing, public transport, local businesses, and community participation. '
    'It connects people, places, organizations, and events to understand how relationships shape everyday life and responses to change.')


def add(table, **row):
    if table not in ('annotation_codes', 'annotation_objects', 'memo_sources', 'memo_codes', 'memo_objects'):
        row.setdefault('created_at', STAMP)
    TABLES[table].append(row)
    return row


def j(value):
    return json.dumps(value, ensure_ascii=False)


people = ['Amira Patel', 'Daniel Brooks', 'Elena Ruiz', 'Farah Khan', 'George Mensah',
    'Hana Mori', 'Isaac Williams', 'Joanna Evans', 'Kai Chen', 'Leila Haddad',
    'Mateo Silva', 'Nadia Okafor', 'Owen Price', 'Priya Shah', 'Quinn Taylor',
    'Rosa Martin', 'Samir Ali', 'Tessa Green', 'Uma Das', 'Victor Reed',
    'Wendy Cole', 'Yusuf Demir', 'Zo\u00eb Laurent', 'Alex Morgan', 'Alex Morgan']
orgs = ['Millfield Council', 'Tenants Assembly', 'Market Traders Cooperative', 'Millfield School',
    'Community Library', 'Transport Forum', 'Canal Arts Collective', 'Northbank Housing',
    'Youth Workshop', 'Millfield Development Partnership']
places = ['Old Mill Site', 'Market Square', 'Canal Walk', 'Northbank Estate', 'Southgate Estate',
    'Library Hall', 'Bus Interchange', 'School Grounds', 'Riverside Park', 'Station Road']
events = ['Planning Workshop', 'Transport Hearing', 'Market Festival', 'Housing Consultation', 'Youth Design Day']
event_dates = ['2026-02-12', '2026-03-19', '2026-05-16', '2026-06-11', '2026-07-09']
roles = ['tenant organizer', 'shopkeeper', 'care worker', 'bus commuter', 'teacher']
areas = ['Northbank', 'Southgate', 'Town Centre', 'Canalside', 'Station Quarter']
colors = ['#B04A33', '#2C3E50', '#397D68', '#8863A8', '#C28C35']
groups = [('Housing', ['Rent pressure', 'Repairs', 'Security of tenure']),
    ('Services', ['Transport access', 'Public space', 'Opening hours']),
    ('Belonging', ['Local identity', 'Mutual aid', 'Exclusion']),
    ('Participation', ['Consultation', 'Representation', 'Collective action']),
    ('Change', ['Redevelopment', 'Business continuity', 'Future hopes'])]
topic_details = [
    ('housing', 'rents and repairs', 'Northbank Estate', 'Tenants Assembly',
     'Residents asked for written repair deadlines and a right to return before any relocation.',
     'The draft redevelopment plan includes new homes, but does not yet specify the rent levels or the duration of temporary moves.'),
    ('transport', 'the evening bus connection', 'Bus Interchange', 'Transport Forum',
     'Shift workers asked for a later connection, while other residents prioritized a reliable daytime service.',
     'The proposed route joins the station to the market, but the last departure remains earlier than several evening shifts finish.'),
    ('business', 'market access during construction', 'Market Square', 'Market Traders Cooperative',
     'Traders supported better paving but wanted loading access and affordable temporary stalls.',
     'The works schedule closes one side of the square at a time; the location of temporary stalls is still under discussion.'),
    ('participation', 'who gets heard in consultation', 'Library Hall', 'Millfield Council',
     'Participants requested evening meetings, paper forms, translation and a published record of responses.',
     'The council has opened a consultation on the Old Mill Site. A digital response form is available alongside a weekly library drop-in.'),
    ('belonging', 'shared spaces and local identity', 'Canal Walk', 'Canal Arts Collective',
     'Young people wanted a place to meet without buying anything; older residents emphasized seating and quiet hours.',
     'A proposed public walkway would connect the canal to the old mill courtyard, with its management arrangements not yet agreed.')]

object_shapes = {'Person': 'hexagon', 'Organization': 'rectangle', 'Place': 'diamond', 'Event': 'triangle'}
for n, (kind, names) in enumerate([('Person', people), ('Organization', orgs), ('Place', places), ('Event', events)]):
    add('object_types', id=f'TYPE-{kind}', name=kind, description=f'Fictional Millfield {kind.lower()}',
        color=colors[n], shape=object_shapes[kind], fill='outline')
    for i, name in enumerate(names):
        oid = f'{kind.upper()}-{i+1:03}'
        desc = f'{DISCLAIMER} {name} is a {kind.lower()} in the Millfield study.'
        if kind == 'Person':
            desc += f' Role: {roles[i%5]}. Area: {areas[i%5]}. The two Alex Morgan records represent different participants.'
        if kind == 'Event':
            desc += f' Scheduled on {event_dates[i]}.'
        add('research_objects', id=oid, object_type_id=f'TYPE-{kind}', object_type=kind, title=name, description=desc)

for i, (parent, children) in enumerate(groups):
    pid = f'CODE-{i*4+1:03}'
    add('codes', id=pid, label=parent, description=f'Parent category for {parent.lower()}.', color=colors[i], sort_order=i*4)
    for k, label in enumerate(children, 2):
        add('codes', id=f'CODE-{i*4+k:03}', parent_code_id=pid, label=label,
            description=f'Use for passages or regions about {label.lower()}; distinguish stated needs from confirmed outcomes.', color=colors[i], sort_order=i*4+k-1)

relation_specs = [
    ('member of / works for', 'PERSON', 'ORGANIZATION', [(i%25, (i%25 + (i//25)*3)%10) for i in range(35)]),
    ('lives in / uses', 'PERSON', 'PLACE', [(i%25, (i%25 + (i//25)*4)%10) for i in range(30)]),
    ('participated in', None, 'EVENT', [(i, i%5) for i in range(35)]),
    ('operates in', 'ORGANIZATION', 'PLACE', [(i%10, (i%10 + (i//10)*3)%10) for i in range(15)]),
    ('collaborates with', 'PERSON', 'PERSON', [(i, i+1) for i in range(20)]),
    ('partners with / disputes with', 'ORGANIZATION', 'ORGANIZATION', [(i%10, (i%10+1+i//10)%10) for i in range(15)])]
for ri, (label, a, b, pairs) in enumerate(relation_specs, 1):
    tid = f'RT-{ri:02}'
    add('relationship_types', id=tid, name=label, color=colors[(ri-1)%5])
    for left, right in pairs:
        at = a or ('PERSON' if left < 25 else 'ORGANIZATION')
        ai = left if a or left < 25 else left-25
        source, target = f'{at}-{ai+1:03}', f'{b}-{right+1:03}'
        add('object_relationships', id=f'REL-{len(TABLES["object_relationships"])+1:03}',
            from_object_id=source, to_object_id=target, from_entity_type='object', to_entity_type='object',
            from_entity_id=source, to_entity_id=target, relationship_type_id=tid, relationship_type=label,
            description=f'Synthetic relationship for testing. {source} {label} {target}.')

add('source_attribute_definitions', id='SA-DATE', name='Collection date', data_type='datetime')
add('source_attribute_definitions', id='SA-TOPIC', name='Topic', data_type='categorical', options_json=j([x[0] for x in topic_details]))
add('object_attribute_definitions', id='OA-AREA', name='Neighborhood', data_type='categorical', options_json=j(areas))
add('object_attribute_definitions', id='OA-EVENT-DATE', object_type_id='TYPE-Event', object_type='Event',
    name='Event date', data_type='datetime', timeline_role='timeline_start')
for i, date in enumerate(event_dates, 1):
    add('object_attribute_values', id=f'OV-EVENT-DATE-{i:03}', object_id=f'EVENT-{i:03}',
        attribute_definition_id='OA-EVENT-DATE', value=f'{date}T12:00:00')
add('relationship_attribute_definitions', id='RA-STRENGTH', name='Strength', data_type='number')
for i, obj in enumerate(TABLES['research_objects']):
    if i%9:  # Deliberately leave some optional attributes blank.
        add('object_attribute_values', id=f'OV-{i:03}', object_id=obj['id'], attribute_definition_id='OA-AREA', value=areas[i%5])
for i, rel in enumerate(TABLES['object_relationships']):
    add('relationship_attribute_values', id=f'RV-{i:03}', relationship_id=rel['id'], attribute_definition_id='RA-STRENGTH', value=str(1+i%5))


def interview(i):
    topic, issue, place, organization, _, _ = topic_details[i%5]
    person = people[i]
    experiences = [
        ('a leaking kitchen window', 'I put a towel under it before I went to work. When I came back it was wet through. The repair portal said the job was closed, but nobody had come inside. I took a photograph and sent it again. That is why I keep asking what a promise actually means.'),
        ('the last bus after closing the shop', 'We shut at six, but that does not mean I leave at six. There is cashing up and putting the stock away. I missed the connection by about two minutes. A taxi would have cost more than I wanted to spend, so I walked. I was not thinking about the route map then; I was thinking about getting home.'),
        ('a delivery during the trial road closure', 'The driver phoned from the other side of the barriers. He could see the stall but could not get to it. We carried boxes across in several trips. People said the square looked calmer without vans. It did, actually. But somebody still has to carry the boxes.'),
        ('trying to complete the online consultation', 'I started it on my phone between other jobs. There was a question about which layout I preferred, but I wanted to explain why neither worked for me. I typed a long answer, went back a page and lost it. After that I left it. That was not a vote for either option.'),
        ('an afternoon on the canal path', 'I saw two children showing their grandfather something on the water. They stayed for ages. It reminded me that you cannot measure everything by how quickly people get through a place. Sometimes stopping is the whole point. There was nowhere for him to sit, though.'),
        ('a conversation about temporary relocation', 'A neighbor asked whether temporary meant weeks or months. Everyone had a different answer, and none of us had a letter saying either. I realized I had been repeating something I had heard in the stairwell. I stopped doing that. It was making people more worried.'),
        ('helping someone find a different bus stop', 'The notice was fixed to the old stop. It had an arrow, but from there you could not see the new stop. A woman asked me whether she was in the right place. I was waiting too and could not tell her. We both watched a bus go past on the next street.'),
        ('buying lunch at the market', 'I used to take my break there. During the fencing trial I walked round the long way and then had to go straight back. That sounds trivial, I know. But it was the bit of the day when I talked to people who were not asking me to do something.'),
        ('going to a meeting at Library Hall', 'There were three people with plans spread out on a table. They were friendly, but I did not know whether to interrupt. I waited until somebody else asked a question. Then I realized that person already knew all the names of the buildings. I felt behind before I had even started.'),
        ('an invitation to a community activity', 'The invitation said everyone was welcome. I went with a friend, which helped. We recognized nobody when we arrived. One person moved their bag so we could sit down and that made more difference than the poster. Being welcome is something people do, not just something they print.'),
        ('looking at the proposed new homes', 'The drawings look much better than what is there now. I said that at the meeting and somebody assumed I did not care about rents. Of course I care. I can want a warmer flat and still ask whether the same people will be able to live in it.'),
        ('planning a journey with two connections', 'On paper it is only one extra change. In practice I have to allow for the first bus being late. I leave much earlier than the timetable suggests. When someone says the new route saves five minutes, I want to know which five minutes they are counting.'),
        ('talking to a trader about new paving', 'He was pleased about it because the uneven stones catch the wheels of his trolley. Then he showed me where he thought the temporary stalls would go. I had not understood that improving the surface could still put him in a worse trading position for a while.'),
        ('asking how comments would be used', 'The person at the desk said every comment would be considered. I asked whether we would see an answer. She said she could not promise an individual reply. I appreciated her being honest, but I still do not know how I would recognize my concern in the next version of the plan.'),
        ('walking through the old mill courtyard', 'A friend said it was wasted space. I know what they meant; parts of it are shut off and look neglected. But I remember meeting people there after school. I do not want it frozen exactly as it was. I just do not want every trace of that life scrubbed away.'),
        ('comparing repair experiences with a neighbor', 'My repair was done quickly, so at first I thought the system was working. Then the neighbor showed me their messages. They had been waiting much longer. I had to stop treating what happened in my flat as the whole story.'),
        ('using the bus with shopping bags', 'The walk from the new stop is manageable when I have nothing with me. With shopping it feels different. A younger person offered to carry a bag once, which was kind. But kindness from a stranger should not be the transport plan.'),
        ('visiting a quieter market stall', 'The stallholder said the barriers had made people think the whole row was closed. I nearly turned back myself. A handwritten sign helped more than the official board because it said plainly that they were open. It is a small thing, but small things add up over several weeks.'),
        ('discussing a consultation form with a friend', 'We read the same question and understood it differently. I thought it asked about the finished development; she thought it asked about the building work. We would have ticked different boxes even though we agreed about most of the practical problems.'),
        ('watching how people used the park entrance', 'Some people hurried through, others stood talking right by the gate. At first I thought the group was blocking it. Then I noticed they were waiting for someone who walked slowly. I had made up an explanation without asking. That happens a lot when people talk about who belongs in public space.'),
    ]
    incident, account = experiences[i]
    concerns = [
        'A right to return needs to say what happens to the rent and who pays for moving. If those details are missing, the phrase does not give me much to plan around.',
        'I would like them to test the timetable with people who travel at different times. A route can be useful at lunchtime and almost useless after an evening shift.',
        'Keep a usable route for deliveries and tell customers which stalls are open. I would rather have a less polished temporary arrangement that people can actually find.',
        'Show us which decisions are still open. If a question cannot change anything, explain that before asking people to spend an evening answering it.',
        'Keep places where you can stay without spending money. I do not object to a cafe, but a cafe table is not the same thing as a public bench.',
    ]
    counterpoints = [
        'Somebody said delays also have a cost, and I think that is fair. The existing homes still need work. I would not want my questions used as a reason to leave them as they are.',
        'A neighbor said the daytime service mattered more because more people used it. I can understand that. I am asking whether the smaller group is being counted at all, not saying everyone should travel when I do.',
        'People with pushchairs said the square felt safer without delivery vans. They were right about that. I do not think the answer is to pretend either group can disappear.',
        'One of the organizers said they had offered several ways to respond. I believe they had tried. My point was about whether those ways felt usable, which is harder to put in a list.',
        'Someone wanted better lighting and fewer hidden corners. I agreed. Keeping memories of a place does not mean keeping every problem that came with it.',
    ]
    positions = [
        'I am cautious, but I have not decided against it. I would support it if the practical commitments came before the disruption, not afterwards.',
        'Access is my main concern. I do not need every detail to suit me personally, but I need to see that somebody has thought about people who cannot just change their routine.',
        'I can see benefits. My support depends on what happens during the work. I do not think that is being difficult; it is part of deciding whether a plan is workable.',
        'I have become impatient with the gaps between updates. That does not mean I want a rushed decision. A clear explanation of a delay would be better than silence.',
    ]
    exchanges = [
        ('Could you tell me a little about your connection to Millfield?', f'My name is {person}. I am a {roles[i%5]}, and {areas[i%5]} is the part of town I know best. I use other places too, but most of what I can tell you comes from ordinary trips and conversations. I would not claim to know how everyone in Millfield feels.'),
        (f'When you think about {issue}, what comes to mind first?', f'I think about {incident}. It sounds like a small example when I say it like that. But it is the sort of thing I remember when I look at a big proposal. I start with what people have to do in a day, rather than with what the drawing looks like.'),
        ('Could you talk me through what happened?', account),
        ('What made that experience important to you?', f'It changed how I listened to the discussion about {place}. Before that, I might have thought the details could be sorted out later. Now I notice how much depends on those details. [pause] I am not saying one experience proves the whole plan is wrong. It tells me which questions I need answered.'),
        ('What would you want to see done differently?', concerns[i%5]),
        (f'Have you raised that with anyone from {organization}?', f'I have talked about it with people who know the organization, but I would not call that a formal answer from them. I need to be careful about that. Things get repeated, and soon somebody says the organization has promised something when it was really just a conversation.'),
        ('Has anyone offered a different view that you found convincing?', counterpoints[i%5]),
        ('Where does that leave you on the proposal now?', positions[i//5]),
        ('What would help you judge whether your concern had been addressed?', 'Something specific that I could check. A named contact, a date for an update, and an explanation if the arrangement changes. I do not expect someone to predict everything. I do expect them to tell us when a promise has changed rather than leave us to discover it ourselves.'),
        ('Is there anything I have misunderstood, or anything you would like to add?', f'Only that I have mostly talked about a difficulty because that is what you asked me to describe. There are people here who help one another, and I do like living in Millfield. Wanting {issue} handled better is part of caring about the place. It is not the same as saying nothing good ever happens here.'),
    ]
    paragraphs = [DISCLAIMER, f'Interview transcript | Participant: {person} | Topic: {issue} | Location: {place}\nSpeaker labels: Interviewer and Participant ({person}). Bracketed pauses are fictional.']
    for question, response in exchanges:
        paragraphs.extend([f'Interviewer: {question}', f'Participant ({person}): {response}'])
    return '\n\n'.join(paragraphs)


def narrative(i, genre):
    if genre == 'Interview':
        return interview(i)
    topic, issue, place, organization, finding, context = topic_details[i%5]
    person = people[i%25]
    angle = ['cautious support', 'concern about access', 'conditional support', 'frustration with delays', 'hope for shared benefits'][i//5%5]
    paragraphs = [DISCLAIMER, f'{genre}: {issue.capitalize()}. Participant: {person}. Location: {place}.',
        f'The discussion begins with {context} The participant describes their position as {angle}, rather than simply supporting or rejecting the proposal.',
        f'{person}: The question for me is whether the plan works on an ordinary weekday. I can see the drawings, but I need to know how people get to work, collect children and keep appointments while the work is happening. A promise about the finished site does not answer what happens in between.',
        f'Researcher: What would count as a useful commitment? {person}: A named contact and a date for the next update. If the answer is still unknown, say so. I would rather hear that a decision is open than discover later that the meeting could not change anything.',
        f'{finding} At {place}, this was expressed as a practical concern about time and cost. The conversation moved from the appearance of the new development to the routines that might be interrupted.',
        f'A representative associated with {organization} argued that the work could improve the area if the transition was planned carefully. Another contribution questioned who would pay for the interim arrangements. No agreement on that cost was recorded in this source.',
        f'{person}: Some neighbors read every consultation document. Others only hear about it when the road closes. We should not mistake being quiet for being satisfied. People who cannot attend a meeting still have knowledge about how this place works.',
        'Research note: Separate claims about the proposed design from evidence about current conditions. The interview is not a representative survey, and one participant cannot speak for every resident. Record uncertainty rather than turning a preference into a settled community position.',
        f'Follow-up: compare this account with the {events[i%5]} record dated {event_dates[i%5]} and a source from another neighborhood. Ask whether the concern changes between daytime and evening use, and whether different households experience the same interruption.',
        f'Closing reflection: the account links {issue} to questions of trust and belonging. The participant does not reject change in principle; the conditions attached to their support are the most useful material for further comparison.']
    if i in (19, 29, 39):
        paragraphs += [f'Extended observation {k+1}: At {8+k%12:02}:{(k*7)%60:02}, the observer recorded {1+k%13} arrivals near {place}. Conditions varied between quieter periods and short queues. This repeated observation block is deliberately included for long-text performance testing; it is not an additional interview.' for k in range(220)]
    return '\n\n'.join(paragraphs)


def diagram(path, title, topic_index, scale=1):
    w,h = 1280*scale,720*scale
    im = Image.new('RGB',(w,h),'#F9F9F9');d=ImageDraw.Draw(im)
    font=lambda n: ImageFont.truetype('C:/Windows/Fonts/arial.ttf',n*scale)
    d.rectangle((0,0,w,100*scale),fill='#2C3E50')
    d.text((30*scale,20*scale),title[:65],font=font(28),fill='white')
    labels=[topic_details[topic_index][2],topic_details[topic_index][3], 'Everyday access', 'Questions for consultation']
    for n,label in enumerate(labels):
        x=(40+(n%2)*620)*scale;y=(140+(n//2)*235)*scale
        d.rounded_rectangle((x,y,x+580*scale,y+190*scale),radius=12*scale,outline=colors[topic_index],width=4*scale,fill='white')
        d.text((x+20*scale,y+20*scale),label,font=font(23),fill='#2C3E50')
        text=topic_details[topic_index][4] if n%2==0 else topic_details[topic_index][5]
        d.multiline_text((x+20*scale,y+65*scale),'\n'.join(textwrap.wrap(text,44)),font=font(19),fill='#2C3E50',spacing=5*scale)
    d.text((30*scale,670*scale),'SYNTHETIC MILLFIELD STUDY - schematic illustration, not a photograph',font=font(20),fill='#B04A33')
    im.save(path)
    return w,h


def pdf(path, title, text):
    # Minimal searchable PDF with explicit page geometry and an embedded text layer.
    lines=[]
    for p in (title+'\n\n'+text).splitlines():
        lines.extend(textwrap.wrap(p.encode('ascii','replace').decode(),88) or [''])
    pages=[lines[k:k+48] for k in range(0,len(lines),48)]
    objs=[b'',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    refs=[]
    for chunk in pages:
        page_id=len(objs)+1;stream_id=page_id+1;refs.append(f'{page_id} 0 R')
        stream='BT /F1 10 Tf 42 750 Td 14 TL\n'
        for line in chunk:
            escaped=line.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
            stream+=f'({escaped}) Tj T*\n'
        content=(stream+'ET').encode('ascii')
        objs += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {stream_id} 0 R >>'.encode(),b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream']
    objs[0]=b'<< /Type /Catalog /Pages 2 0 R >>';objs[1]=f'<< /Type /Pages /Kids [{" ".join(refs)}] /Count {len(pages)} >>'.encode()
    data=bytearray(b'%PDF-1.4\n');offsets=[0]
    for i,obj in enumerate(objs,1):
        offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
    xref=len(data);data+=f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:data+=f'{offset:010} 00000 n \n'.encode()
    data+=f'trailer << /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode();path.write_bytes(data)
    return len(pages)


speech=[]
for i in range(90):
    sid=f'SRC-{i+1:03}';topic=i%5
    kind='Text' if i<40 else 'Audio' if i<45 else 'Video' if i<55 else 'Image' if i<75 else 'PDF'
    genre=('Interview' if i<20 else 'Field note' if i<30 else 'Meeting transcript') if kind=='Text' else {'Audio':'Radio ad','Video':'Narrated briefing','Image':'Schematic noticeboard','PDF':'Community briefing'}[kind]
    title=f'{sid} | {genre}: {topic_details[topic][1]}'
    text=narrative(i,genre);ext={'Text':'txt','Audio':'mp3','Video':'mp4','Image':'png','PDF':'pdf'}[kind]
    file=FILES/f'{sid}.{ext}'
    metadata={}
    if kind=='Text':file.write_text(text,encoding='utf-8')
    elif kind=='Image':metadata['dimensions']=diagram(file,title,topic,3 if i==74 else 1)
    elif kind=='PDF':metadata['pages']=pdf(file,title,text)
    else:
        text=(f'This is a fictional Millfield {genre.lower()} for software testing. '
            f'Have your say about {topic_details[topic][1]} and the Old Mill redevelopment. '
            f'{topic_details[topic][5]} {topic_details[topic][4]} '
            'Visit the library consultation desk to read the plans, request a paper form, or ask for an accessible format. '
            'The plan is still a proposal, and comments about practical impacts are welcome. '
            'This synthetic announcement does not advertise a real development or event.')
        if kind=='Video':
            text+=' '+narrative(i,genre).split('\n\n')[3]
            diagram(FILES/f'{sid}-frame.png',title,topic)
        speech.append({'path':str(FILES/f'{sid}.wav'),'text':text,'voice':'Microsoft Zira Desktop' if i%2 else 'Microsoft David Desktop'})
    date=f'2026-{2+i%6:02}-{1+i%26:02}T12:00:00Z'
    row=add('sources',id=sid,source_kind=kind,title=title,original_file_name=file.name,storage_path='files/'+file.name,
        text_content=text,notes=DISCLAIMER+' Media is synthetic; images are schematics and videos are narrated slides.',created_at=date)
    links=[f'PERSON-{i%25+1:03}', f'ORGANIZATION-{i%10+1:03}', f'PLACE-{i%10+1:03}']
    if i%3==0:links.append(f'EVENT-{i%5+1:03}')
    for oid in links:add('source_objects',source_id=sid,object_id=oid)
    add('source_attribute_values',id=f'{sid}-DATE',source_id=sid,attribute_definition_id='SA-DATE',value=date)
    add('source_attribute_values',id=f'{sid}-TOPIC',source_id=sid,attribute_definition_id='SA-TOPIC',value=topic_details[topic][0])
    MANIFEST.append({'id':sid,'title':title,'kind':kind,'file':str(file.relative_to(OUT)).replace('\\','/'),'objects':links,'topic':topic_details[topic][0],**metadata})

(OUT/'speech-jobs.json').write_text(j(speech),encoding='utf-8')
ps='''param([string]$Jobs)
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice.Rate = 0
  foreach ($job in (Get-Content -Raw -Encoding UTF8 -LiteralPath $Jobs | ConvertFrom-Json)) {
    if (Test-Path -LiteralPath $job.path) { continue }
    $voice.SelectVoice($job.voice)
    $voice.SetOutputToWaveFile($job.path)
    $voice.Speak($job.text)
    $voice.SetOutputToNull()
  }
} finally { $voice.Dispose() }
'''
(OUT/'speak.ps1').write_text(ps,encoding='utf-8')
subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(OUT/'speak.ps1'),'-Jobs',str(OUT/'speech-jobs.json')],check=True)

assets=[]
for i,(source,meta) in enumerate(zip(TABLES['sources'],MANIFEST)):
    sid=source['id'];kind=source['source_kind'];file=OUT/meta['file']
    if kind in ('Audio','Video'):
        wav=FILES/f'{sid}.wav'
        with wave.open(str(wav)) as w: duration=w.getnframes()/w.getframerate()
        meta['durationMs']=int(duration*1000)
        if not file.exists() or kind=='Video':
            args=['ffmpeg','-hide_banner','-loglevel','error','-y']
            if kind=='Audio':args+=['-i',str(wav),'-codec:a','libmp3lame','-b:a','96k',str(file)]
            else:args+=['-loop','1','-framerate','2','-i',str(FILES/f'{sid}-frame.png'),'-i',str(wav),'-c:v','libx264','-preset','ultrafast','-tune','stillimage','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-shortest','-t',str(duration),'-movflags','+faststart',str(file)]
            subprocess.run(args,check=True)
    raw=file.read_bytes();digest=hashlib.sha256(raw).hexdigest();mime={'Text':'text/plain','Audio':'audio/mpeg','Video':'video/mp4','Image':'image/png','PDF':'application/pdf'}[kind]
    meta.update(bytes=len(raw),sha256=digest)
    add('source_files',id=f'FILE-{sid}',source_id=sid,storage_path=source['storage_path'],original_file_name=file.name,media_type=mime,file_size_bytes=len(raw),checksum_sha256=digest)
    assets.append({'collection':'project_storage_files','recordId':sid,'field':'storage_path','fileName':source['storage_path'],'mimeType':mime,'dataBase64':base64.b64encode(raw).decode()})
    for k in range(4):
        aid=f'ANN-{len(TABLES["annotations"])+1:04}'
        ann={'id':aid,'source_id':sid,'source_kind':kind,'note':f'Synthetic coding example {k+1}: compare stated priorities with implementation details.'}
        if kind=='Text':
            paragraphs=source['text_content'].split('\n\n')
            segment=([p for p in paragraphs if p.startswith('Participant (')][k+1] if i<20 else paragraphs[k+2])
            start=source['text_content'].index(segment)
            if k==1 and i>=20: start=max(0,start-25) # Deliberate overlap in observation sources.
            end=source['text_content'].index(segment)+len(segment)
            ann.update(anchor_kind='text_span',start_offset=start,end_offset=end,quote=source['text_content'][start:end])
        elif kind in ('Audio','Video'):
            length=meta['durationMs'];start=int(length*k/5);end=min(length,start+int(length/4))
            ann.update(anchor_kind='time_range',time_start_ms=start,time_end_ms=end,quote=f'Timed media interval {start/1000:.1f} to {end/1000:.1f} seconds')
        else:
            w,h=meta.get('dimensions',(612,792));x=(40+(k%2)*620)/1280*w if kind=='Image' else 40
            y=(140+(k//2)*235)/720*h if kind=='Image' else 90+k*130
            region={'x':x,'y':y,'width':580/1280*w if kind=='Image' else 530,'height':190/720*h if kind=='Image' else 100,'imageWidth':w,'imageHeight':h,'pageNumber':1 if kind=='PDF' else None}
            ann.update(anchor_kind='image_rect',start_offset=0,end_offset=0,region_selector_json=j(region),quote=f'{kind} region {k+1}')
        add('annotations',**ann)
        code=f'CODE-{(i%5)*4+1+(k%4):03}'
        add('annotation_codes',annotation_id=aid,code_id=code)
        add('annotation_objects',annotation_id=aid,object_id=meta['objects'][0])

for i in range(15):
    mid=f'MEMO-{i+1:03}';topic=topic_details[i%5]
    add('memos',id=mid,title=f'{topic[0].capitalize()} comparison {i//5+1}',body=f'{DISCLAIMER}\n\n{topic[4]}\n\nWorking interpretation: distinguish support for the final design from concerns about the transition. Compare individual accounts with organizational statements; a shared phrase is not proof of agreement.\n\nNegative case to seek: a participant who welcomes the change but rejects the proposed timetable. Follow up on who can attend consultations and whose costs are missing from the public documents.')
    add('memo_sources',memo_id=mid,source_id=f'SRC-{i+1:03}')
    add('memo_objects',memo_id=mid,object_id=f'PERSON-{i+1:03}')
    add('memo_codes',memo_id=mid,code_id=f'CODE-{(i%5)*4+1:03}')

for i in range(8):
    selected=TABLES['sources'] if i==0 else [s for n,s in enumerate(TABLES['sources']) if n%7==i-1]
    ids={s['id'] for s in selected};anns=[a for a in TABLES['annotations'] if a['source_id'] in ids]
    counts=Counter(link['code_id'] for link in TABLES['annotation_codes'] if link['annotation_id'] in {a['id'] for a in anns})
    settings={'kind':'frequencies','caseIds':[],'documentIds':sorted(ids),'relationshipIds':[],'caseAttributeIds':[],'documentAttributeIds':[],'codeIds':[c['id'] for c in TABLES['codes']],'userIds':[]}
    snapshot={'reportType':'code-report','kind':'frequencies','settings':settings,'caseItems':[], 'userItems':[], 'caseAttributeItems':[], 'documentAttributeItems':[], 'documents':[], 'codes':[], 'annotations':[], 'caseDocumentLinks':[], 'caseAttributeValues':[], 'documentAttributeValues':[],
        'frozenFrequencyRows':[{'section':'Codes','category':'All selected sources','values':[{'code':c['label'],'value':counts[c['id']]} for c in TABLES['codes']]}], 'description':DISCLAIMER+' Frozen counts from the generated annotations.'}
    snapshot.pop('frozenFrequencyRows')
    snapshot['documents']=[{'id':s['id'],'projectId':'millfield','name':s['title'],'type':s['source_kind'],'filePath':s['storage_path'],'importedAt':s['created_at']} for s in selected]
    snapshot['codes']=[{'id':c['id'],'projectId':'millfield','label':c['label'],'color':c['color'],'description':c['description'],'parentId':c.get('parent_code_id')} for c in TABLES['codes']]
    linked_codes={link['annotation_id']:link['code_id'] for link in TABLES['annotation_codes']}
    snapshot['annotations']=[{'id':a['id'],'documentId':a['source_id'],'codeId':linked_codes[a['id']], 'startOffset':a.get('start_offset',0),'endOffset':a.get('end_offset',0),'quote':a['quote'],'note':a['note'],'createdAt':a['created_at'],'createdBy':'','createdById':'','sourceKind':a['source_kind'],'timeStartMs':a.get('time_start_ms'),'timeEndMs':a.get('time_end_ms'),'imageRegion':json.loads(a.get('region_selector_json','null'))} for a in anns]
    add('reports',id=f'REPORT-{i+1:03}',title='Millfield code frequencies - '+('all sources' if i==0 else f'sample {i}'),report_type='code-report',settings_json=j(settings),content_json=j(snapshot),content_text='\n'.join(f'{c["label"]}: {counts[c["id"]]}' for c in TABLES['codes']))

rename_people(TABLES)
add_source_relationships(TABLES)
for source in MANIFEST:
    source['objects'] = [link['object_id'] for link in TABLES['source_objects'] if link['source_id'] == source['id']]
payload={'format':'kanqual-project-export','version':1,'project':{'name':'Life in Millfield','description':DESCRIPTION+' '+DISCLAIMER},'tables':[{'name':name,'rows':rows} for name,rows in TABLES.items()],'assets':assets}
target=OUT/'millfield-project.json';target.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
manifest={'project':payload['project'],'sourceCounts':dict(Counter(s['kind'] for s in MANIFEST)),'tableCounts':{t:len(r) for t,r in TABLES.items()},'sources':MANIFEST,'objects':TABLES['research_objects'],'relationships':TABLES['object_relationships'],'timeline':[{'event':n,'date':d} for n,d in zip(events,event_dates)],'jsonSha256':hashlib.sha256(target.read_bytes()).hexdigest()}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
assert len(TABLES['sources'])==90 and len(TABLES['research_objects'])==50
assert sum(r['from_entity_type'] == 'object' for r in TABLES['object_relationships']) == 150
assert len(TABLES['annotations'])==360
print(f'Created {target} ({target.stat().st_size/1024/1024:.1f} MiB)',flush=True)
print(j(manifest['tableCounts']),flush=True)
