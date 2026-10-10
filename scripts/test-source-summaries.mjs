import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const bin = path.resolve(process.env.PROJECT_IMPORT_POSTGRES_BIN || "src-tauri/resources/runtime/postgresql-17/bin");
const executable = (name) => path.join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
await mkdir(".tmp", { recursive: true });
const root = await mkdtemp(path.resolve(".tmp/source-summary-test-"));
const data = path.join(root, "data");
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
async function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}
await run(executable("initdb"), ["-D", data, "-U", "source_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
let started = false;
try {
  await run(executable("pg_ctl"), ["-D", data, "-l", path.join(root, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1`, "-w", "start"]);
  started = true;
  await run(executable("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "source_test", "kanqual_source_summary_test"]);
  for (const mode of ["setup", "verify", "image-verify", "page-verify", "full", "summary", "page"]) {
    const output = await run("cargo", ["test", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "source_queries::tests::source_summary_database_regression", "--lib", "--", "--ignored", "--nocapture"], {
      ...process.env, KANQUAL_SOURCE_TEST_URL: `host=127.0.0.1 port=${port} user=source_test dbname=kanqual_source_summary_test`,
      KANQUAL_SOURCE_TEST_ROOT: root, KANQUAL_SOURCE_TEST_MODE: mode,
    });
    console.log(output.trim());
  }
  const metrics = [];
  for (const mode of ["full", "summary", "page"]) {
    const nodeMetrics = JSON.parse(await run(process.execPath, ["--expose-gc", "-e", `
      const fs=require('node:fs');global.gc();const before=process.memoryUsage();const start=performance.now();
      const raw=fs.readFileSync(process.argv[1], 'utf8');const rows=JSON.parse(raw);
      const elapsed=performance.now()-start;const after=process.memoryUsage();
      console.log(JSON.stringify({readAndParseMs:elapsed,heapDeltaBytes:after.heapUsed-before.heapUsed,rssDeltaBytes:after.rss-before.rss,sources:Array.isArray(rows)?rows.length:rows.sources.length}));
    `, path.join(root, `${mode}.json`)]));
    metrics.push({ ...JSON.parse(await readFile(path.join(root, `${mode}.metrics.json`), "utf8")), frontend: nodeMetrics });
  }
  assert.ok(metrics[2].payloadBytes < metrics[1].payloadBytes / 3);
  assert.equal(metrics[2].frontend.sources, 50);
  assert.ok(metrics[1].payloadBytes < metrics[0].payloadBytes / 100);
  await writeFile(path.join(root, "results.json"), JSON.stringify(metrics, null, 2));

  // Run the actual frontend data APIs and exporter against the database fixtures.
  const summaries = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
  const detail = JSON.parse(await readFile(path.join(root, "detail.json"), "utf8"));
  const expected = JSON.parse(await readFile(path.join(root, "expected.json"), "utf8"));
  assert.equal(detail.textContent.slice(expected.start, expected.end), expected.quote);
  const calls = [];
  globalThis.__sourceTestInvoke = async (command, args) => {
    calls.push({command,args});
    if (command === "list_source_page_command") return JSON.parse(await readFile(path.join(root, "page.json"), "utf8"));
    if (command === "list_source_summaries_command") return summaries;
    if (command === "list_postgres_experiment_sources_command") return [detail];
    if (command === "get_source_details_command") { assert.equal(args.sourceId, detail.id); return detail; }
    if (command === "export_postgres_experiment_project_lossless_bundle_command") return { tables: [], assets: [] };
    return [];
  };
  for (const module of ["postgres", "postgresProjectWorkspace", "postgresProjectExport", "postgresReportAdapters"]) {
    let source = await readFile(`src/lib/${module}.ts`, "utf8");
    source = source.replace('import { invoke } from "@tauri-apps/api/core";', 'const invoke = globalThis.__sourceTestInvoke;');
    source = source.replaceAll('"./postgres"', '"./postgres.mjs"').replaceAll('"./postgresProjectWorkspace"', '"./postgresProjectWorkspace.mjs"');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    await writeFile(path.join(root, `${module}.mjs`), compiled);
  }
  const api = await import(pathToFileURL(path.join(root, "postgres.mjs")));
  const workspace = await import(pathToFileURL(path.join(root, "postgresProjectWorkspace.mjs")));
  const reports = await import(pathToFileURL(path.join(root, "postgresReportAdapters.mjs")));
  const exporter = await import(pathToFileURL(path.join(root, "postgresProjectExport.mjs")));
  const page = await api.listPostgresSourcePage("project", { query: "", kinds: [], kind: "", sort: "name", descending: false, offset: 0, all: false });
  assert.equal(page.total, 257); assert.equal(page.sources.length, 50);
  assert.equal(calls.length, 1); assert.equal(calls[0].command, "list_source_page_command");
  const snapshot = await workspace.loadPostgresProjectWorkspaceSnapshot("project");
  assert.equal(snapshot.sources.length,257);
  assert.ok(!calls.some(call=>call.command==="list_postgres_experiment_sources_command"));
  assert.equal((await api.getPostgresSource("project", detail.id)).textContent, expected.text);
  assert.deepEqual(api.toSourceSummary(detail), summaries.find(source=>source.id===detail.id));
  const report = await reports.loadPostgresReportBuilderData("project");
  assert.ok(report.documents.every(source=>!Object.hasOwn(source,"content")));
  assert.ok(!calls.some(call=>call.command==="list_postgres_experiment_sources_command"));
  const exported = await exporter.fetchPostgresProjectExportData({id:"project",name:"Test"});
  const document = exported.tables.find(table=>table.name==="documents").rows[0];
  assert.equal(document.content,expected.text);
  assert.equal(document.structured_content_json,expected.structured);
  assert.ok(calls.some(call=>call.command==="list_postgres_experiment_sources_command"));
  console.log(JSON.stringify(metrics,null,2));
  console.log(`Payload, UTF-16 offsets, opaque source details, search, summary consumers, and export checks passed. Results: ${path.join(root,"results.json")}`);
  await unlink(path.join(root,"full.json"));

} finally {
  if (started) await run(executable("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
