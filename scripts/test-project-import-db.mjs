import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const bin = path.resolve(process.env.PROJECT_IMPORT_POSTGRES_BIN || "src-tauri/resources/runtime/postgresql-17/bin");
const executable = (name) => path.join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
await mkdir(".tmp", { recursive: true });
const root = await mkdtemp(path.resolve(".tmp/import-db-test-"));
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
await run(executable("initdb"), ["-D", data, "-U", "import_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
let started = false;
try {
  await run(executable("pg_ctl"), ["-D", data, "-l", path.join(root, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1`, "-w", "start"]);
  started = true;
  await run(executable("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "import_test", "kanqual_import_test"]);
  const output = await run("cargo", ["test", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "project_import::tests::imports_into_postgres", "--lib", "--", "--ignored"], {
    ...process.env, KANQUAL_IMPORT_TEST_URL: `host=127.0.0.1 port=${port} user=import_test dbname=kanqual_import_test`,
  });
  console.log(output.trim());
} finally {
  if (started) await run(executable("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
