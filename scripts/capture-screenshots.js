const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const screenshotsDir = path.join(root, "screenshots");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskflow-shot-"));
const port = 4100 + Math.floor(Math.random() * 400);

async function waitReady() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Server did not start in time.");
}

(async () => {
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, "store.json") },
    stdio: "ignore",
  });

  try {
    await waitReady();

    const browser = await chromium.launch({
      executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.fill('input[name="email"]', "admin@example.com");
    await page.fill('input[name="password"]', "Admin@123");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".board");
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-board.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 920 });
    await page.screenshot({ path: path.join(screenshotsDir, "mobile-board.png"), fullPage: true });
    await browser.close();
  } finally {
    server.kill();
  }
})();
