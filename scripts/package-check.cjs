const { _electron: electron } = require("playwright");
const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { initialState } = require("../desktop/store.cjs");
const root = path.resolve(__dirname, "..");
const executablePath =
  process.platform === "darwin"
    ? path.join(root, "release/mac-arm64/Relay.app/Contents/MacOS/Relay")
    : path.join(root, "release/win-unpacked/Relay.exe");
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-package-"));
  const projectDir = path.join(dataDir, "fixture");
  fs.mkdirSync(projectDir);
  fs.writeFileSync(
    path.join(projectDir, "sample.php"),
    "<?php\nclass Checkout { public const LIMIT = 100; }\n",
  );
  const fixture = initialState();
  const projectId = randomUUID();
  fixture.projects.push({
    id: projectId,
    name: "Package fixture",
    path: projectDir,
    createdAt: Date.now(),
  });
  fixture.ui.projectId = projectId;
  fixture.ui.view = "workspace";
  fs.writeFileSync(
    path.join(dataDir, "workspace.json"),
    JSON.stringify(fixture),
  );
  const env = { ...process.env, RELAY_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    const state = await page.evaluate(() => window.relay.call("state"));
    assert.equal(state.projects[0].id, projectId);
    await page.getByRole("button", { name: "sample.php", exact: true }).click();
    await page
      .locator('.code-editor[data-language="PHP"] .tok-keyword')
      .first()
      .waitFor();
    assert.deepEqual(errors, []);
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    console.log(
      "PASS: packaged application starts; renderer, preload, IPC, native module loading, and packaged PHP language chunks work.",
    );
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
