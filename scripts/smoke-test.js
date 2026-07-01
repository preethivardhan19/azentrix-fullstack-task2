const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskflow-"));
const dataFile = path.join(tempDir, "store.json");
const port = 3400 + Math.floor(Math.random() * 500);

function startServer() {
  return spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function request(pathname, options = {}, cookie = "") {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${pathname}`);
  return { data, cookie: response.headers.get("set-cookie") || cookie };
}

async function waitUntilReady() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      await fetch(`http://127.0.0.1:${port}`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Server did not start in time.");
}

(async () => {
  const server = startServer();
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitUntilReady();

    const login = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@example.com", password: "Admin@123" }),
    });
    const cookie = login.cookie.split(";")[0];

    const board = await request("/api/board", {}, cookie);
    if (board.data.cards.length < 3) throw new Error("Expected starter cards.");

    const created = await request(
      "/api/cards",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Smoke test card",
          description: "Created by automated smoke test",
          column: "todo",
          assigneeId: board.data.currentUser.id,
          dueDate: "2026-07-10",
          priority: "high",
        }),
      },
      cookie,
    );

    await request(
      `/api/cards/${created.data.card.id}/move`,
      {
        method: "PATCH",
        body: JSON.stringify({ column: "progress", position: 1 }),
      },
      cookie,
    );

    await request(
      "/api/users",
      {
        method: "PATCH",
        body: JSON.stringify({ userId: board.data.users.find((user) => user.role === "member").id, role: "member", active: true }),
      },
      cookie,
    );

    console.log("Smoke test passed.");
  } finally {
    server.kill();
    if (stderr) process.stderr.write(stderr);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
