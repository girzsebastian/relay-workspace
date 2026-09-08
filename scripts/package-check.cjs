const { _electron: electron } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const executablePath =
  process.platform === "darwin"
    ? path.join(root, "release/mac-arm64/Relay.app/Contents/MacOS/Relay")
    : path.join(root, "release/win-unpacked/Relay.exe");
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-package-"));
  const env = { ...process.env, RELAY_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    const state = await page.evaluate(() => window.relay.call("state"));
    assert.ok(Array.isArray(state.projects));
    assert.deepEqual(errors, []);
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    console.log(
      "PASS: packaged application starts; renderer, preload, IPC, and native module loading work.",
    );
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
