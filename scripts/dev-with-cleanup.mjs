import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const viteCommand = "npm run dev -- --host 127.0.0.1 --port 1420";
const parentPid = process.ppid;

let child = null;
let shuttingDown = false;

function isParentAlive(pid) {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killChildTree() {
  if (!child?.pid) return Promise.resolve();

  return new Promise((resolve) => {
    if (isWindows) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
      return;
    }

    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Best-effort only.
    }
    resolve();
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(parentWatch);
  await killChildTree();
  process.exit(code);
}

child = isWindows
  ? spawn("cmd.exe", ["/d", "/s", "/c", viteCommand], {
      stdio: "inherit",
      shell: false,
      windowsHide: false,
    })
  : spawn("sh", ["-c", viteCommand], {
      stdio: "inherit",
      shell: false,
      detached: true,
    });

child.on("exit", (code, signal) => {
  clearInterval(parentWatch);
  if (shuttingDown) return;
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", async (error) => {
  console.error("Failed to start Vite dev server:", error);
  await shutdown(1);
});

const parentWatch = setInterval(() => {
  if (!isParentAlive(parentPid)) {
    void shutdown(0);
  }
}, 2000);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}
