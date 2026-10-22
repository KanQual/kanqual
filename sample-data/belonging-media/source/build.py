"""Rebuild PDFs, transcripts, captions, audio and video from content.json.
Requires Python 3, Pillow, numpy, pypdf, ffmpeg/ffprobe and Windows SAPI voices.
Run from the repository root. Image flier originals are generated separately.
"""
from pathlib import Path
import json, subprocess, wave, hashlib, zipfile, math
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TEMP = ROOT.parents[1] / '.tmp' / 'belonging'
TEMP.mkdir(parents=True, exist_ok=True)
C = json.loads((ROOT/'source/content.json').read_text(encoding='utf-8'))

def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)

def pdf(f):
    def color(h): return ' '.join(str(round(int(h[i:i+2],16)/255,4)) for i in (1,3,5))
    ops=[]
    def rect(x,y,w,h,c): ops.append(f'{color(c)} rg {x} {y} {w} {h} re f')
    def text(x,y,s,size=14,bold=False,c=None):
        s=s.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
        ops.append(f'BT /F{2 if bold else 1} {size} Tf {color(c or f["ink"])} rg 1 0 0 1 {x} {y} Tm ({s}) Tj ET')
    rect(0,0,612,792,f['bg']); rect(42,724,60,6,f['accent'])
    text(42,752,'ALDERBRIDGE UNIVERSITY',13,True)
    text(42,693,f['tag'],10,True)
    for i,t in enumerate(f['title']): text(38,602-i*74,t,64,True)
    text(42,481,f['subtitle'],18)
    rect(42,443,528,2,f['accent'])
    text(42,409,f['date'],16,True)
    text(42,381,f['location'],16)
    for i,t in enumerate(f['body']): text(42,330-i*24,t,15)
    for i,t in enumerate(f['details']): text(42,223-i*21,t,12)
    text(42,83,f['host'],11,True)
    rect(42,61,528,1,f['accent'])
    text(42,40,'FICTIONAL EVENT  |  AI-GENERATED KANQUAL DEMONSTRATION DATA',8)
    stream='\n'.join(ops).encode('cp1252')
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
    data=bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets=[0]
    for i,obj in enumerate(objects,1):
        offsets.append(len(data)); data.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
    start=len(data); data.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]: data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF'.encode())
    (ROOT/'pdfs'/f'{f["id"]}.pdf').write_bytes(data)
    (ROOT/'transcripts'/f'{f["id"]}.txt').write_text('\n'.join(['ALDERBRIDGE UNIVERSITY',f['tag'],*f['title'],f['subtitle'],f['date'],f['location'],*f['body'],*f['details'],f['host'],'Fictional event | AI-generated Kanqual demo']),encoding='utf-8')

def timestamp(t):
    ms=round(t*1000); return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def combine(paths, target):
    duration=0; segments=[]
    with wave.open(str(target),'wb') as out:
        for i,p in enumerate(paths):
            with wave.open(str(p),'rb') as w:
                if i==0: out.setparams(w.getparams())
                frames=w.readframes(w.getnframes()); n=w.getnframes()/w.getframerate()
                out.writeframes(frames); segments.append((duration,duration+n)); duration+=n
                gap=.35; out.writeframes(b'\0'*int(w.getframerate()*gap)*w.getsampwidth()*w.getnchannels()); duration+=gap
    return segments,duration

def prepare():
    for f in C['pdfs']: pdf(f)
    jobs=[]
    for d in C['diaries']:
        (ROOT/'transcripts'/f'{d["id"]}.txt').write_text(d['speaker']+' | '+d['profile']+'\n\n'+'\n\n'.join(d['paragraphs']),encoding='utf-8')
        for i,p in enumerate(d['paragraphs']):
            # Sentence chunks provide accurately timed captions without speech recognition.
            import re
            sentences=re.split(r'(?<=[.!?])\s+',p)
            for j,s in enumerate(sentences): jobs.append({'id':f'{d["id"]}-{i:02}-{j:02}','voice':d['voice'],'text':s,'group':d['id']})
    for i,s in enumerate(C['promo']): jobs.append({'id':f'promo-{i:02}','voice':'Zira','text':s['narration'],'group':'promo'})
    (TEMP/'speech-jobs.json').write_text(json.dumps(jobs),encoding='utf-8')
    return jobs

def speech():
    script='''$ErrorActionPreference = 'Stop'
$jobs = Get-Content -LiteralPath '__JOBS__' -Raw | ConvertFrom-Json
$voice = New-Object -ComObject SAPI.SpVoice
$voice.Rate = 0
foreach ($job in $jobs) {
  $tokens = $voice.GetVoices()
  for ($i=0; $i -lt $tokens.Count; $i++) { if ($tokens.Item($i).GetDescription() -like ('*' + $job.voice + '*')) {$voice.Voice = $tokens.Item($i); break} }
  $stream = New-Object -ComObject SAPI.SpFileStream
  $stream.Format.Type = 22
  $stream.Open(('__TEMP__/' + $job.id + '.wav'), 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($job.text)
  $stream.Close()
}
'''.replace('__JOBS__',str(TEMP/'speech-jobs.json')).replace('__TEMP__',str(TEMP))
    (TEMP/'speech.ps1').write_text(script,encoding='utf-8')
    run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(TEMP/'speech.ps1')])

def audio(jobs):
    for d in C['diaries']:
        js=[j for j in jobs if j['group']==d['id']]
        wav=TEMP/f'{d["id"]}.wav'; times,duration=combine([TEMP/(j['id']+'.wav') for j in js],wav)
        run(['ffmpeg','-y','-v','error','-i',str(wav),'-af','loudnorm=I=-18:TP=-2:LRA=7','-ar','44100','-ac','1','-codec:a','libmp3lame','-b:a','128k',str(ROOT/'audio'/f'{d["id"]}.mp3')])
        (ROOT/'transcripts'/f'{d["id"]}.srt').write_text('\n\n'.join(f'{i+1}\n{timestamp(a)} --> {timestamp(b)}\n{j["text"]}' for i,((a,b),j) in enumerate(zip(times,js))),encoding='utf-8')
        print(d['id'],round(duration,1),'seconds',flush=True)

FONT='C:/Windows/Fonts/arial.ttf'; BOLD='C:/Windows/Fonts/arialbd.ttf'
def font(n,bold=False): return ImageFont.truetype(BOLD if bold else FONT,n)
def wrap(draw,text,f,maxwidth):
    lines=[]; line=''
    for word in text.split():
        test=(line+' '+word).strip()
        if draw.textlength(test,font=f)>maxwidth and line: lines.append(line); line=word
        else: line=test
    if line: lines.append(line)
    return lines

def video():
    scenes=C['promo']; paths=[TEMP/f'promo-{i:02}.wav' for i in range(len(scenes))]
    times,total=combine(paths,TEMP/'promo.wav')
    (ROOT/'transcripts/09-university-promotion.txt').write_text('Fictional institutional promotional voice; not evidence about a real institution.\n\n'+'\n\n'.join(s['narration'] for s in scenes),encoding='utf-8')
    captions=[]
    for (a,b),s in zip(times,scenes):
        words=s['narration'].split(); chunks=[' '.join(words[i:i+11]) for i in range(0,len(words),11)]
        weights=[len(c.split()) for c in chunks]; cursor=a
        for c,n in zip(chunks,weights):
            end=cursor+(b-a)*n/sum(weights); captions.append((cursor,end,c)); cursor=end
    (ROOT/'transcripts/09-university-promotion.srt').write_text('\n\n'.join(f'{i+1}\n{timestamp(a)} --> {timestamp(b)}\n{c}' for i,(a,b,c) in enumerate(captions)),encoding='utf-8')
    # Original, gentle synthesized underscore, with no borrowed music.
    with wave.open(str(TEMP/'promo.wav'),'rb') as w:
        sr=w.getframerate(); voice=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float64)/32768
    t=np.arange(len(voice))/sr; music=np.zeros_like(t)
    chords=[(130.81,164.81,196),(110,130.81,164.81),(87.31,110,130.81),(98,123.47,146.83)]
    for k in range(math.ceil(total/4)):
        a=int(k*4*sr); b=min(len(t),int((k+1)*4*sr)); local=t[a:b]-k*4
        env=np.minimum(local/.6,1)*np.minimum((4-local)/.8,1)
        for hz in chords[k%4]: music[a:b]+=0.008*np.sin(2*np.pi*hz*local)*env
    mixed=np.clip(voice*.88+music,-.98,.98)
    with wave.open(str(TEMP/'promo-mix.wav'),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes((mixed*32767).astype('<i2').tobytes())
    out=ROOT/'video/09-alderbridge-university-promotion.mp4'
    cmd=['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','24','-i','-','-i',str(TEMP/'promo-mix.wav'),'-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-shortest',str(out)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    bgpath=ROOT/'source/campus-backdrop.png'
    backdrop=Image.open(bgpath).convert('RGB') if bgpath.exists() else None
    for frame in range(math.ceil(total*24)):
        now=frame/24; idx=next((i for i,(a,b) in enumerate(times) if now<b+.35),len(scenes)-1)
        a,b=times[idx]; progress=max(0,min(1,(now-a)/(b-a+.35))); s=scenes[idx]
        im=Image.new('RGB',(1280,720),'#103D3C')
        if backdrop:
            scale=max(1280/backdrop.width,720/backdrop.height)*(1+.055*progress)
            resized=backdrop.resize((int(backdrop.width*scale),int(backdrop.height*scale)),Image.Resampling.BILINEAR)
            im.paste(resized,((1280-resized.width)//2,(720-resized.height)//2))
        overlay=Image.new('RGBA',(1280,720),(6,26,29,140)); im=Image.alpha_composite(im.convert('RGBA'),overlay)
        d=ImageDraw.Draw(im)
        d.rectangle((0,0,1280,112),fill=(8,31,33,215))
        d.text((64,42),'ALDERBRIDGE  /  UNIVERSITY',font=font(22,True),fill='#FFF3DB')
        d.text((865,46),'FICTIONAL  |  KANQUAL DEMO',font=font(16),fill='#FFF3DB')
        # Moving accent and a soft entrance create restrained motion graphics.
        x=64+int(18*(1-min(1,progress*5))); d.rectangle((x,205,x+85+int(progress*95),211),fill='#E6B46C')
        lines=wrap(d,s['title'],font(66,True),1130)
        for j,line in enumerate(lines): d.text((x,240+j*77),line,font=font(66,True),fill='#FFF5E4')
        d.text((x,420),s['line'],font=font(29),fill='#F1D9B2')
        cap=next((c for ca,cb,c in captions if ca<=now<cb),'')
        if cap:
            lines=wrap(d,cap,font(26),1110); top=590 if len(lines)<2 else 565
            d.rectangle((44,top-14,1236,top+len(lines)*35+12),fill=(4,16,19,235))
            for j,line in enumerate(lines):
                width=d.textlength(line,font=font(26));d.text(((1280-width)/2,top+j*35),line,font=font(26),fill='white')
        d.rectangle((64,689,1216,693),fill='#54706B'); d.rectangle((64,689,64+int(1152*now/total),693),fill='#E6B46C')
        proc.stdin.write(im.convert('RGB').tobytes())
    proc.stdin.close()
    if proc.wait()!=0: raise RuntimeError('Video encoding failed')
    print('promotion',round(total,1),'seconds',flush=True)

def manifest():
    entries=[]
    for folder in ['images','pdfs','audio','video']:
        for p in sorted((ROOT/folder).iterdir()):
            e={'file':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'synthetic':True}
            if folder in ['audio','video']:
                probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)]))
                e['duration_seconds']=float(probe['format']['duration']); e['codecs']=[s['codec_name'] for s in probe['streams']]
            entries.append(e)
    (ROOT/'manifest.json').write_text(json.dumps({'dataset':'Alderbridge student belonging','version':'1.0','fictional':True,'assets':entries},indent=2),encoding='utf-8')

if __name__=='__main__':
    jobs=prepare(); speech(); audio(jobs); video(); manifest()
