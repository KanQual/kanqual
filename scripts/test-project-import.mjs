import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import ts from "typescript";

async function moduleUrl(file) {
  const source = await readFile(file, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
const exportUrl = await moduleUrl("src/lib/projectExport.ts");
const { makeProjectBackupJson, makeRefiQdaProject } = await import(exportUrl);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries, compress = true) {
  const locals = [], directory = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name), plain = Buffer.from(value);
    const packed = compress ? deflateRawSync(plain) : plain;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(crc32(plain), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(crc32(plain), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

const payload = {
  format: "kanqual-project-export", version: 1, exportedAt: "2026-10-08T12:00:00Z",
  project: { id: "old-project", name: "Round trip", description: "Research" },
  tables: [
    { name: "documents", rows: [{ id: "s", name: "Interview", content: "Hello 😀 world" }] },
    { name: "codes", rows: [{ id: "c", name: "Theme", parent: "" }] },
    { name: "annotations", rows: [{ id: "a", document: "s", code: "c", start_offset: 6, end_offset: 8 }] },
  ],
  assets: [{ collection: "project_storage_files", recordId: "old-project", field: "storage_path", fileName: "sources/file.bin", mimeType: "application/octet-stream", dataBase64: "AAECAwQ=" }],
  postgresTables: [{ name: "sources", rows: [{ id: "s", title: "Interview", text_content: "Hello 😀 world", waveform_peaks_json: "[1,2]" }] }],
};
const xml = `<?xml version="1.0"?><Project xmlns="urn:QDA-XML:project:1.0" name="External project">
<Users><User guid="u" name="Researcher"/></Users>
<CodeBook><Codes><Code guid="c" name="Parent"><Code guid="child" name="Child"/></Code></Codes></CodeBook>
<Variables><Variable guid="v" name="Age" typeOfVariable="Integer"/></Variables>
<Sources><TextSource guid="s" name="Interview" plainTextPath="internal://interview.txt">
<PlainTextSelection guid="a" startPosition="1" endPosition="2" creatingUser="u"><Description>Emoji</Description><Coding guid="coding"><CodeRef targetGUID="child"/></Coding></PlainTextSelection>
</TextSource><AudioSource guid="audio" name="Recording" path="internal://sound.wav"><AudioSelection guid="clip" begin="1000" end="2000"><Coding><CodeRef targetGUID="c"/></Coding></AudioSelection></AudioSource></Sources>
<Cases><Case guid="case" name="Participant"><SourceRef targetGUID="s"/><VariableValue><VariableRef targetGUID="v"/><IntegerValue>42</IntegerValue></VariableValue></Case></Cases>
<Notes><Note guid="memo" name="Memo" creatingUser="u"><PlainTextContent>Some notes</PlainTextContent></Note></Notes></Project>`;
const entries = [["project.qde", xml], ["Sources/interview.txt", "A😀B"], ["Sources/sound.wav", Buffer.from([0, 1, 2])]];
const legacyExport = structuredClone(payload);
legacyExport.tables[0].rows[0].storage_path = "sources/file.bin";
legacyExport.tables.push({ name: "source_files", rows: [{ id: "file", source_id: "s", storage_path: "sources/file.bin", original_file_name: "file.bin" }] });
const legacyFiles = readStoredZip(makeRefiQdaProject(legacyExport));
legacyFiles.delete("kanqual-project.json");
const pictureXml = xml.replace("</Sources>", '<PictureSource guid="picture" name="Picture" path="internal://pixel.png"><PictureSelection guid="region" firstX="0" firstY="0" secondX="1" secondY="1"><Coding><CodeRef targetGUID="c"/></Coding></PictureSelection></PictureSource></Sources>');
const fixtures = {
  picture: [...zip([["project.qde", pictureXml], ...entries.slice(1), ["Sources/pixel.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")]])],
  olderExport: [...zip([...legacyFiles])],
  standard: [...zip(entries)],
  missing: [...zip(entries.slice(0, 1))],
  external: [...zip([["project.qde", xml.replace("internal://interview.txt", "absolute://not-present.txt").replace(/<PlainTextSelection.*?<\/PlainTextSelection>/s, "")], entries[2]])],
  malformed: [...zip([["project.qde", "<Project><broken></Project>"]])],
  doctype: [...zip([["project.qde", '<!DOCTYPE Project [<!ENTITY x "oops">]><Project/>']])],
  legacyKanqual: [...zip([["project.qde", xml.replace('name="External project"', 'name="External project" origin="Kanqual"').replace('endPosition="2"', 'endPosition="3"')], ...entries.slice(1)])],
};

const temp = path.resolve(".tmp/project-import-tests/fixtures");
await mkdir(temp, { recursive: true });
for (const [name, bytes] of Object.entries(fixtures)) await writeFile(path.join(temp, `${name}.qdpx`), new Uint8Array(bytes));
await writeFile(path.join(temp, "plain.json"), JSON.stringify(payload));
await writeFile(path.join(temp, "wrapped.json"), makeProjectBackupJson(payload));
await writeFile(path.join(temp, "native.qdpx"), makeRefiQdaProject(payload));
await writeFile(path.join(temp, "invalid-version.json"), JSON.stringify({ ...payload, version: 2 }));
await writeFile(path.join(temp, "duplicate-tables.json"), JSON.stringify({ ...payload, tables: [payload.tables[0], payload.tables[0]] }));
await writeFile(path.join(temp, "traversal.qdpx"), zip([["../escape", "bad"]]));
await writeFile(path.join(temp, "duplicate.qdpx"), zip([["a", "one"], ["a", "two"]]));
const corrupt = zip([["a", "content"]], false); corrupt[31] ^= 1;
await writeFile(path.join(temp, "corrupt.qdpx"), corrupt);
await new Promise((resolve, reject) => {
  const child = spawn("cargo", ["test", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "project_import_stream::tests::generated_fixtures", "--lib", "--", "--ignored"], { windowsHide: true, stdio: "inherit", env: { ...process.env, KANQUAL_IMPORT_FIXTURES: temp } });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Native import fixtures failed (${code})`)));
});

// The existing exporter produces stored ZIP entries. This helper only prepares legacy test fixtures.
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map(); let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const length = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    files.set(name, bytes.slice(start, start + length)); offset = start + length;
  }
  return files;
}
