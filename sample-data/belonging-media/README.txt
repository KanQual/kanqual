ALDERBRIDGE: STUDENT BELONGING / KANQUAL SAMPLE MEDIA
Version 1.0 | Created October 21, 2026

Nine primary assets: 3 searchable PDFs, 3 illustrated PNG fliers,
2 synthetic student audio diaries (MP3), and 1 narrated promotion (MP4).
Open index.html to preview and download the files locally or on a static host.

FICTIONAL DEMONSTRATION DATA
All people, organizations, events, institutional claims and experiences in
this package are invented. Alderbridge is a fictional university label,
not an identification of the institution in the supplied interviews.
This material is for software demonstrations and qualitative-analysis
practice. It is not research evidence or real student testimony.

CONTEXT AND PROVENANCE
The supplied AI-generated interviews informed the themes: first-generation
belonging, financial barriers, commuter schedules, peer support, identity,
institutional visibility, and the gap between publicity and lived experience.
Nineteen DOCX filenames were supplied; interview 8.docx was empty, leaving
18 readable documents. The originals are not copied into this package.
Maya and Eli are new fictional characters, not recordings of interviewees.
Events are set in a fictional fall 2026 term; this is a thematic companion,
not a claim that the spring interviews describe these later events.
Document content was treated as source material, not operational instructions.

FILES
images/01-a-seat-at-the-table.png: first-generation lunch; low social threshold.
images/02-stories-after-hours.png: arts open mic; free but late-evening access.
images/03-grow-something-together.png: garden welcome; shared activity.
pdfs/04-between-classes.pdf: commuter lunch; practical scheduling and access.
pdfs/05-founders-evening.pdf: formal alumni event; cost and cultural expectations.
pdfs/06-make-room.pdf: listening session; voice and institutional accountability.
audio/07-maya-finding-a-place.mp3: belonging through peers, with financial limits.
audio/08-eli-at-the-edges.mp3: time and transport barriers, with a positive counterexample.
video/09-alderbridge-university-promotion.mp4: optimistic institutional narrative.

USING THE DATA IN KANQUAL
Create a demonstration project and add the nine assets through the appropriate
source-upload tabs. These formats are recognized by the repository's upload
code. This folder is source media, not an importable Kanqual project backup.
The workflow was not exercised in a running Kanqual session.
Plain-text companions and SRT captions are in transcripts/. They are optional
reference materials, not additional independent participant observations.
The PDFs have selectable text. The image fliers support visual/OCR workflows.
The video is H.264/AAC, 1280x720 at 24 fps, with burned-in captions.
Video caption chunk timing is proportionally estimated within measured scenes.
Audio captions use measured synthesized-sentence boundaries.

OPTIONAL ANALYSIS QUESTIONS
What makes an invitation feel actionable rather than merely welcoming?
How do price, clothing, transport and timing affect participation?
Where do the two diaries agree with or complicate the university promotion?
How do the artifacts distribute responsibility for creating belonging?
These questions are prompts, not predetermined correct coding results.

GENERATION AND REBUILDING
PNG fliers and the video background: built-in image generation tool.
Exact prompts: source/image-prompts.json and source/video-image-prompt.txt.
PDFs: deterministic vector/text layout in source/build.py.
Audio: AI-written scripts rendered with installed Microsoft Zira and David
desktop speech voices. These sound synthetic; no student voice was cloned.
Video: illustrated motion graphics, synthetic narration and an original
programmatically synthesized musical underscore. No live-action footage.
Scripts and copy: source/content.json. Rebuilder: source/build.py.
The build requires Windows SAPI, Python, Pillow, numpy, ffmpeg and ffprobe.
Validation additionally used pypdf and the repository's PDF.js renderer.
Speech synthesis may require execution outside a restricted sandbox.
Artwork generation is not repeated by the build script.

HOSTING
Upload this directory to a static host while preserving its relative paths.
Serve index.html as the landing page. No application server, analytics,
external fonts, account credentials or remote scripts are required.
Use application/pdf, image/png, audio/mpeg and video/mp4 MIME types.
HTTP byte-range support is recommended for seeking in media.
The adjacent belonging-media.zip contains this directory for distribution.
No live hosting configuration or deployment was changed during creation.
manifest.json lists the nine primary assets, sizes, hashes and media durations.

KEEP THE DISCLOSURE
When sharing or adapting, retain the fictional/synthetic-data disclosure.
Do not describe the recordings as consented interviews with real students.
