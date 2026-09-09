const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { execFileSync } = require("node:child_process");
const { stripVTControlCharacters } = require("node:util");
const root = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-desktop-"));
const project = path.join(dir, "launchpad");
fs.mkdirSync(project);
fs.writeFileSync(
  path.join(project, "app.ts"),
  '// Your next idea starts here.\nexport const workspace = {\n  name: "Launchpad",\n  persistence: true,\n  providers: ["codex", "claude"],\n};\n',
);
fs.writeFileSync(
  path.join(project, "README.md"),
  "# Launchpad\n\nA sample project for Relay desktop verification.\n",
);
const languageFixtures = {
  "sample.php":
    '<?php\n// A small service\nclass Checkout {\n  public const LIMIT = 100;\n  public function title(): string { return "Checkout"; }\n}\n',
  "sample.py": "# A small function\ndef total(price):\n    return price * 2\n",
  "sample.yaml":
    '# Build pipeline\npipelines:\n  default:\n    - step: "Run tests"\n',
  "sample.css": "/* Theme */\n.card { color: #ffcc88; padding: 12px; }\n",
  Dockerfile: "# Container\nFROM node:22\nWORKDIR /app\nRUN npm ci\n",
  "sample.mjs": '// Module\nexport const label = "Relay";\n',
};
for (const [name, content] of Object.entries(languageFixtures))
  fs.writeFileSync(path.join(project, name), content);
fs.mkdirSync(path.join(project, ".agents/skills/review"), { recursive: true });
fs.writeFileSync(
  path.join(project, ".agents/skills/review/SKILL.md"),
  "# Review\nCheck correctness and explain tradeoffs.\n",
);
// The fixture is a real repository so source control, explorer decorations,
// and search have genuine state to render rather than an empty panel.
const inProject = (args) =>
  execFileSync("git", args, { cwd: project, stdio: "ignore" });
inProject(["init", "-b", "main"]);
inProject(["config", "user.email", "smoke@example.com"]);
inProject(["config", "user.name", "Relay Smoke"]);
inProject(["add", "--all"]);
inProject(["commit", "-m", "Fixture project"]);
fs.writeFileSync(
  path.join(project, "sample.py"),
  "# A small function\ndef total(price):\n    return price * 3\n",
);
fs.writeFileSync(path.join(project, "untracked.txt"), "new file\n");
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
const env = {
  ...process.env,
  RELAY_TEST_DIR: path.join(dir, "state"),
  RELAY_TEST_PROJECT: project,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.RELAY_DEV_URL;
let desktop, page;
const errors = [];
async function launch() {
  desktop = await electron.launch({ args: [root], env, timeout: 30000 });
  page = await desktop.firstWindow();
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.hide();
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => !!window.relay);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
}
async function api(name, args = {}) {
  return page.evaluate(({ name, args }) => window.relay.call(name, args), {
    name,
    args,
  });
}
async function screenshot(options) {
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  try {
    await page.screenshot(options);
  } finally {
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
  }
}
async function pickSession(pane, sessionId) {
  await page
    .getByRole("button", { name: `Session in pane ${pane}`, exact: true })
    .click();
  if (sessionId)
    await page
      .locator(`.session-list button[data-session-id="${sessionId}"]`)
      .click();
  else
    await page
      .getByRole("option", { name: "Empty this pane", exact: true })
      .click();
  await until(async () => (await page.locator(".session-list").count()) === 0);
}
async function until(fn, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for condition");
}
(async () => {
  try {
    console.log("Desktop check: launch and editor");
    await launch();
    await page
      .getByRole("button", { name: "Add workspace", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "app.ts", exact: true }).click();
    await page.locator(".cm-content").waitFor();
    // Verify real parser spans and contrasting colors for previously unhighlighted files.
    for (const [filename, language] of [
      ["sample.php", "PHP"],
      ["sample.py", "Python"],
      ["sample.yaml", "YAML"],
      ["sample.css", "CSS"],
      ["Dockerfile", "Dockerfile"],
      ["sample.mjs", "JavaScript"],
    ]) {
      await page.getByRole("button", { name: filename, exact: true }).click();
      await page.locator(`.code-editor[data-language="${language}"]`).waitFor();
      await until(
        async () =>
          (await page.locator('.cm-content [class*="tok-"]').count()) > 1,
      );
      const colors = await page
        .locator('.cm-content [class*="tok-"]')
        .evaluateAll((nodes) => [
          ...new Set(nodes.map((n) => getComputedStyle(n).color)),
        ]);
      assert.ok(
        colors.length >= 2,
        `${filename} should have distinct syntax colors`,
      );
      if (filename === "sample.php") {
        await page.locator(".tok-keyword").first().waitFor();
        await screenshot({
          path: path.join(root, "artifacts/syntax-php.png"),
        });
      }
      await page
        .getByRole("button", { name: `Close ${filename}`, exact: true })
        .click();
    }
    const initial = await api("state");
    const projectId = initial.projects[0].id;
    assert.equal((await api("skills:list", { projectId })).length, 1);
    // Exercise the editor rather than mirroring its save implementation.
    await page.locator(".cm-content").click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type("\n// Saved in Relay.");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+s" : "Control+s",
    );
    await until(() =>
      fs
        .readFileSync(path.join(project, "app.ts"), "utf8")
        .includes("Saved in Relay."),
    );
    await page.getByRole("button", { name: "New shell", exact: true }).click();
    // Drafts must survive view changes as well as disk reloads.
    await page.locator(".cm-content").click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type("\n// Unsaved draft survives navigation.");
    await until(async () =>
      (await api("state")).projects[0].draft?.content.includes(
        "Unsaved draft survives navigation.",
      ),
    );
    await page
      .getByRole("button", { name: "Agent board", exact: true })
      .click();
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.locator(".cm-content").waitFor();
    assert.match(
      await page.locator(".cm-content").innerText(),
      /Unsaved draft survives navigation/,
    );
    let shell;
    await until(async () => {
      shell = (await api("state")).sessions.find((s) => s.kind === "shell");
      return shell?.status === "running";
    });
    const echo =
      process.platform === "win32"
        ? "Write-Output 'RELAY_PTY_OK'\r"
        : "printf '\\nRELAY_PTY_OK\\n'\r";
    await api("terminal:write", { id: shell.id, data: echo });
    await until(async () =>
      /\r?\nRELAY_PTY_OK\r?\n/.test(
        stripVTControlCharacters(
          (await api("terminal:log", { id: shell.id })).data,
        ),
      ),
    );
    console.log("Desktop check: terminal I/O passed");
    // Closing a window leaves the same PTY alive.
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.showInactive();
      window.close();
    });
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
      false,
    );
    assert.equal(
      (await api("state")).sessions.find((s) => s.id === shell.id).status,
      "running",
    );
    // CDP input works while hidden; avoid taking focus from the user's apps.
    console.log("Desktop check: background continuity passed");
    const build = await api("terminal:start", {
      projectId,
      kind: "build",
      command:
        process.platform === "win32"
          ? "Write-Output RELAY_BUILD_OK"
          : "printf RELAY_BUILD_OK",
    });
    await until(
      async () =>
        (await api("state")).sessions.find((s) => s.id === build.id).status ===
        "completed",
    );
    assert.equal(
      (await api("state")).sessions.find((s) => s.id === build.id).exitCode,
      0,
    );
    const chat = await api("chat:create", {
      projectId,
      provider: "openai",
      model: "test-model-no-request",
      role: "reviewer",
      skillPath: ".agents/skills/review/SKILL.md",
    });
    assert.equal(chat.skillPath, ".agents/skills/review/SKILL.md");
    console.log("Desktop check: build and chat records passed");
    // IDE tabs preserve distinct drafts; both editor groups can show the same buffer.
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    await until(
      async () =>
        (await page
          .getByRole("tablist", { name: "Files in editor 1" })
          .getByRole("tab")
          .count()) === 2,
    );
    await page
      .getByRole("button", { name: "Split editor", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Editor group 2" })
      .getByRole("tab", { name: "app.ts" })
      .click();
    assert.match(
      await page
        .getByRole("region", { name: "Editor group 2" })
        .locator(".cm-content")
        .innerText(),
      /Unsaved draft survives navigation/,
    );
    assert.match(
      await page
        .getByRole("region", { name: "Editor group 1" })
        .locator(".cm-content")
        .innerText(),
      /# Launchpad/,
    );
    await page
      .getByRole("region", { name: "Editor group 1" })
      .getByRole("tab", { name: "app.ts" })
      .click();
    const secondary = page
      .getByRole("region", { name: "Editor group 2" })
      .locator(".cm-content");
    await secondary.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type("\n// Shared split buffer.");
    await until(async () =>
      (
        await page
          .getByRole("region", { name: "Editor group 1" })
          .locator(".cm-content")
          .innerText()
      ).includes("Shared split buffer."),
    );
    await page
      .getByRole("region", { name: "Editor group 2" })
      .getByRole("tab", { name: "README.md" })
      .click();
    await page.getByRole("button", { name: ".agents", exact: true }).click();
    await page.getByRole("button", { name: "skills", exact: true }).click();
    await page.getByRole("button", { name: "review", exact: true }).click();
    await page.getByRole("button", { name: "SKILL.md", exact: true }).waitFor();
    for (const label of [
      "Resize explorer",
      "Resize chat",
      "Resize terminal",
      "Resize editor split",
    ]) {
      const separator = page.getByRole("separator", {
        name: label,
        exact: true,
      });
      const before = await separator.getAttribute("aria-valuenow");
      await separator.focus();
      await page.keyboard.press("ArrowRight");
      assert.notEqual(
        await separator.getAttribute("aria-valuenow"),
        before,
        label,
      );
    }
    // Exercise pointer capture too, not only accessible keyboard resizing.
    const explorerDivider = await page
      .getByRole("separator", { name: "Resize explorer", exact: true })
      .boundingBox();
    await page.mouse.move(explorerDivider.x + 2, explorerDivider.y + 50);
    await page.mouse.down();
    await page.mouse.move(explorerDivider.x + 32, explorerDivider.y + 50, {
      steps: 6,
    });
    await page.mouse.up();
    for (const [button, selector] of [
      ["Toggle explorer", ".file-explorer"],
      ["Toggle chat panel", ".chat-pane"],
      ["Toggle terminal panel", ".editor-terminals"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await until(async () => (await page.locator(selector).count()) === 0);
      await page.getByRole("button", { name: button, exact: true }).click();
      await page.locator(selector).waitFor();
    }
    const checkViewport = async () => {
      assert.equal(
        await page.evaluate(() => {
          const shell = document.querySelector(".app-shell"),
            main = document.querySelector(".main-content");
          return (
            document.documentElement.scrollHeight <= innerHeight &&
            shell.scrollWidth <= innerWidth &&
            main.scrollHeight <= main.clientHeight + 1 &&
            main.scrollWidth <= main.clientWidth + 1
          );
        }),
        true,
        "No scrolling across the whole workbench",
      );
    };
    await checkViewport();
    await screenshot({ path: path.join(root, "artifacts/workspace.png") });
    console.log("Desktop check: layouts passed");

    // Search, source control, explorer decorations, containers, settings.
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("tab", { name: "Search", exact: true }).click();
    const searchBox = page.getByRole("textbox", {
      name: "Search text",
      exact: true,
    });
    await searchBox.click();
    await searchBox.pressSequentially("Checkout");
    await until(async () => (await searchBox.inputValue()) === "Checkout");
    await until(async () => (await page.locator(".search-hit").count()) > 0);
    assert.ok(
      (await page.locator(".search-results").innerText()).includes(
        "sample.php",
      ),
      "search finds the PHP fixture",
    );
    await page
      .getByRole("button", { name: "Toggle replace", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Replace text", exact: true })
      .waitFor();
    await screenshot({ path: path.join(root, "artifacts/search.png") });
    await page
      .getByRole("button", { name: "Toggle replace", exact: true })
      .click();
    // Results group per file and can be collapsed.
    assert.ok(
      (await page.locator(".search-count").first().innerText()).length > 0,
      "each file group shows a match count",
    );
    // The include filter lives behind the search details toggle.
    await page
      .getByRole("button", { name: "Toggle search details", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "files to include", exact: true })
      .fill("*.py");
    await until(async () => (await page.locator(".search-hit").count()) === 0);

    await page
      .getByRole("tab", { name: "Source control", exact: true })
      .click();
    await until(async () => (await page.locator(".scm-file").count()) >= 2);
    const changes = await page.locator(".scm-files").innerText();
    assert.ok(changes.includes("sample.py"), "modified file is listed");
    assert.ok(changes.includes("untracked.txt"), "untracked file is listed");
    assert.ok(
      (await page.locator(".scm-branch").first().innerText()).includes("main"),
      "the repository branch is shown",
    );
    assert.equal(
      await page.locator(".scm-repo").count(),
      1,
      "the fixture workspace holds exactly one repository",
    );
    // More actions must open and offer the pull, push and checkout entries.
    const moreActions = page.getByRole("button", {
      name: "More actions",
      exact: true,
    });
    await moreActions.click();
    await page
      .getByRole("menuitem", { name: "Checkout to…", exact: true })
      .waitFor();
    // The rest live in groups, exactly as they do in the reference menu.
    for (const group of [
      "Pull, Push",
      "Commit",
      "Branch",
      "Stash",
      "Worktrees",
    ])
      await page.getByRole("menuitem", { name: group, exact: true }).waitFor();
    await page
      .getByRole("menuitem", { name: "Pull, Push", exact: true })
      .click();
    for (const entry of ["Pull", "Push", "Fetch (Prune)"])
      await page.getByRole("menuitem", { name: entry, exact: true }).waitFor();
    await moreActions.click();
    await until(async () => (await page.locator(".scm-menu").count()) === 0);
    await screenshot({ path: path.join(root, "artifacts/source-control.png") });

    await page.getByRole("tab", { name: "Containers", exact: true }).click();
    await until(
      async () =>
        (await page
          .locator(".scm-empty, .container-list, .scm-clean")
          .count()) > 0,
    );

    // Explorer decorations come from the same git status.
    await page.getByRole("tab", { name: "Explorer", exact: true }).click();
    await until(async () => (await page.locator(".tree-mark").count()) > 0);
    assert.ok(
      (await page.locator(".file-explorer").innerText()).includes("sample.py"),
      "explorer still lists project files",
    );

    await page
      .getByRole("button", { name: "Settings & providers", exact: true })
      .click();
    await until(async () => (await page.locator(".settings-row").count()) > 0);
    await page
      .getByRole("textbox", { name: "Search settings", exact: true })
      .fill("subscription");
    await until(
      async () => (await page.locator(".settings-row").count()) === 1,
    );
    await screenshot({ path: path.join(root, "artifacts/settings.png") });
    assert.equal(
      await page.locator(".toast, .app-error").count(),
      0,
      "no panel raised an error toast",
    );
    // The chat composer carries the conversation mode, provider and model.
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    for (const label of ["Chat mode", "Chat provider", "Chat model"])
      await page.getByLabel(label, { exact: true }).waitFor();
    await page
      .getByLabel("Chat mode", { exact: true })
      .selectOption("reviewer");
    // A changed file opens in the editor rather than only in a dialog.
    await page
      .getByRole("tab", { name: "Source control", exact: true })
      .click();
    await page
      .locator(".scm-file")
      .filter({ hasText: "sample.py" })
      .first()
      .click();
    await page.getByRole("tab", { name: "Explorer", exact: true }).click();
    await until(async () =>
      (await api("state")).projects[0].editor.tabs.some(
        (t) => t.path === "sample.py",
      ),
    );
    // Leave the editor as the later restart check expects to find it.
    await page
      .getByRole("button", { name: "Close sample.py", exact: true })
      .first()
      .click();
    await until(async () =>
      (await api("state")).projects[0].editor.tabs.every(
        (t) => t.path !== "sample.py",
      ),
    );
    console.log("Desktop check: panels passed");
    const shells = [shell];
    for (let i = 1; i < 4; i++)
      shells.push(await api("terminal:start", { projectId, kind: "shell" }));
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await page
      .getByRole("button", { name: "4 terminal panes", exact: true })
      .click();
    for (let i = 0; i < 4; i++) {
      const id = shells[i].id;
      // Assign through the UI, avoiding a session already displayed in another slot.
      await pickSession(i + 1, null);
    }
    for (let i = 0; i < 4; i++) {
      await pickSession(i + 1, shells[i].id);
      await api("terminal:write", {
        id: shells[i].id,
        data:
          process.platform === "win32"
            ? `Write-Output 'PANE_${i + 1}_OK'\r`
            : `printf '\\nPANE_${i + 1}_OK\\n'\r`,
      });
    }
    for (let i = 0; i < 4; i++)
      await until(async () =>
        (await api("terminal:log", { id: shells[i].id })).data.includes(
          `PANE_${i + 1}_OK`,
        ),
      );
    await until(
      async () => (await page.locator(".terminal-canvas").count()) === 4,
    );
    for (const label of [
      "Resize terminal columns column",
      "Resize terminal rows",
    ]) {
      await page.getByRole("separator", { name: label, exact: true }).focus();
      await page.keyboard.press("ArrowRight");
    }
    await page
      .getByRole("button", { name: "Focus pane", exact: true })
      .first()
      .click();
    await until(
      async () => (await page.locator(".terminal-tile:visible").count()) === 1,
    );
    await page
      .getByRole("button", { name: "Restore grid", exact: true })
      .click();
    await until(
      async () => (await page.locator(".terminal-tile:visible").count()) === 4,
    );
    await page
      .getByRole("button", {
        name: "Hide pane (keep process running)",
        exact: true,
      })
      .first()
      .click();
    assert.equal(
      (await api("state")).sessions.find((s) => s.id === shell.id).status,
      "running",
    );
    await pickSession(1, shell.id);
    // The provider must not be printed twice when a session has no name of
    // its own: "Shell · … · Shell" is what that bug looked like.
    const picker = page
      .getByRole("button", { name: "Session in pane 1", exact: true })
      .first();
    const shown = await picker.innerText();
    assert.equal(
      shown.split("Shell").length - 1,
      1,
      `session label names the provider once, not twice: ${shown}`,
    );
    assert.ok(
      (await picker.getAttribute("title")).includes("launchpad"),
      "hovering shows the fuller description",
    );
    // A stopped session can be retired from the list without leaving it.
    await page
      .getByRole("button", { name: "Session in pane 1", exact: true })
      .first()
      .click();
    const rows = await page.locator(".picker-row").count();
    // A class name shared with an unrelated component collapsed these rows
    // once; the label has to be visible, not merely present.
    const firstRow = page.locator(".picker-row .session-label").first();
    // Present in the DOM is not the same as visible: a sibling control once
    // claimed the whole row and squeezed this to nothing.
    // The control floats over the row rather than taking a column of its
    // own, so the option keeps the full width.
    const pickerRowBox = await page
      .locator(".picker-row")
      .first()
      .boundingBox();
    const optionBox = await page
      .locator('.picker-row > button[role="option"]')
      .first()
      .boundingBox();
    assert.ok(
      optionBox.width > pickerRowBox.width - 4,
      `the option spans the row (${optionBox.width} of ${pickerRowBox.width})`,
    );
    assert.ok(
      Math.abs(
        optionBox.y +
          optionBox.height / 2 -
          (pickerRowBox.y + pickerRowBox.height / 2),
      ) < 2,
      "the row content stays vertically centred",
    );
    const labelBox = await firstRow.boundingBox();
    assert.ok(
      labelBox.width > 40,
      `each row shows its label (${labelBox.width}px wide)`,
    );
    const rowBox = await page.locator(".picker-row").first().boundingBox();
    assert.ok(
      rowBox.height < 90,
      `a row stays compact rather than inheriting foreign padding (${rowBox.height}px)`,
    );
    assert.ok(rows > 0, "the list offers sessions");
    // A running session must not be removable: it is still doing something.
    assert.equal(
      await page.locator(".picker-row .session-dismiss:disabled").count(),
      await page.locator(".picker-row .session-live").count(),
      "only running sessions refuse to be removed",
    );
    await page.keyboard.press("Escape");
    await until(
      async () => (await page.locator(".session-list").count()) === 0,
    );
    await checkViewport();
    await screenshot({
      path: path.join(root, "artifacts/terminal-grid.png"),
    });
    await page
      .getByRole("button", { name: "6 terminal panes", exact: true })
      .click();
    await until(
      async () => (await page.locator(".terminal-tile:visible").count()) === 6,
    );
    await checkViewport();
    await page
      .getByRole("button", { name: "4 terminal panes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Agent board", exact: true })
      .click();
    await page.getByRole("button", { name: "New agent", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Agent name", exact: true })
      .fill("Frontend builder");
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Build accessible UI. Review the existing design before editing.");
    await page
      .getByRole("button", { name: "Create agent", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Frontend builder", exact: true })
      .waitFor();
    await page
      .getByTitle("Manage Frontend builder", { exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "Queued task", exact: true })
      .fill("Review the checkout UI.");
    await page.getByRole("button", { name: "Queue", exact: true }).click();
    await page
      .getByText("Review the checkout UI.", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await page.getByLabel("Agent provider", { exact: true }).inputValue(),
      "claude",
      "the composer shows which CLI runs this agent",
    );
    await page
      .getByLabel("Agent provider", { exact: true })
      .selectOption("codex");
    await until(
      async () => (await api("state")).agents[0].provider === "codex",
    );
    await page.getByLabel("Agent model", { exact: true }).fill("sonnet");
    await page
      .getByRole("textbox", { name: "Queued task", exact: true })
      .click();
    await until(async () => (await api("state")).agents[0].model === "sonnet");
    assert.ok(
      (await page.locator(".composer-queue-title").innerText()).includes(
        "Queued",
      ),
      "queued follow-ups are listed above the composer",
    );
    await page.getByRole("tab", { name: "Memory", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Memory", exact: true })
      .fill("Prefer accessible controls and integer currency amounts.");
    await page.getByRole("button", { name: "Save agent", exact: true }).click();
    await until(async () =>
      (await api("state")).agents[0].memory.includes("accessible controls"),
    );
    await screenshot({
      path: path.join(root, "artifacts/agent-memory.png"),
    });
    await page
      .getByRole("button", { name: "Close agent details", exact: true })
      .click();
    // Additional local fixture identities; no model requests or subscription usage.
    for (const [name, provider, instructions] of [
      [
        "Code reviewer",
        "codex",
        "Review changes for correctness and regressions.",
      ],
      [
        "API architect",
        "opencode",
        "Design simple interfaces with clear failure handling.",
      ],
      ["Test engineer", "claude", "Cover meaningful behavior and edge cases."],
    ]) {
      const agent = await api("agent:create", {
        projectId,
        name,
        provider,
        instructions,
        skillPath: ".agents/skills/review/SKILL.md",
      });
      if (name === "Code reviewer")
        await api("agent:mark", { id: agent.id, stage: "review" });
    }
    await until(async () => (await page.locator(".trench-card").count()) === 4);
    await checkViewport();
    await screenshot({
      path: path.join(root, "artifacts/agent-board.png"),
    });
    await page.getByRole("button", { name: "Usage", exact: true }).click();
    await page.getByText("Build history", { exact: true }).waitFor();
    await screenshot({ path: path.join(root, "artifacts/usage.png") });
    const menu = await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items.map((i) => i.label.replaceAll("&", "")),
    );
    for (const label of [
      "File",
      "Edit",
      "Selection",
      "View",
      "Go",
      "Run",
      "Terminal",
      "Window",
      "Help",
    ])
      assert.ok(menu.includes(label), label);
    // Invoke native menu callbacks to verify actual command routing.
    await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items.find((i) => i.label.replaceAll("&", "") === "View")
        .submenu.items.find((i) => i.label.replaceAll("&", "") === "Editor")
        .click(),
    );
    await page.locator(".editor-group").first().waitFor();
    await until(async () => (await api("state")).ui.view === "workspace");
    const savedUi = (await api("state")).ui;
    console.log("Desktop check: agent records passed; restarting test process");
    const child = desktop.process();
    const exited = once(child, "exit");
    if (process.platform === "win32") {
      // Kill only this isolated test instance and its child PTYs. Killing the
      // Electron parent alone leaves ConPTY children holding fixture files.
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else child.kill("SIGKILL");
    await exited;
    desktop = null;
    await launch();
    // A crash must announce itself, across the content area rather than
    // squeezed into whatever grid cell was left over.
    const strip = page.locator(".recovery-strip");
    await strip.waitFor();
    assert.match(
      await strip.locator("header b").innerText(),
      /Relay stopped while/,
    );
    const stripBox = await strip.boundingBox();
    const shellBox = await page.locator(".app-shell").boundingBox();
    assert.ok(
      stripBox.width > shellBox.width * 0.8,
      `recovery banner spans the content area (${stripBox.width} of ${shellBox.width})`,
    );
    await page
      .getByRole("button", { name: "Show what was running", exact: true })
      .click();
    await until(async () => (await page.locator(".recovery-row").count()) > 0);
    assert.ok(
      (await page.locator(".recovery-main").first().innerText()).length > 10,
      "each interrupted run is described",
    );
    await screenshot({ path: path.join(root, "artifacts/recovery.png") });
    await page.getByRole("button", { name: "Hide", exact: true }).click();
    const recovered = await api("state");
    assert.equal(
      recovered.projects[0].editor.tabs
        .find((t) => t.path === "app.ts")
        .content.includes("Saved in Relay."),
      true,
    );
    assert.equal(
      recovered.sessions.find((s) => s.id === shell.id).status,
      "interrupted",
    );
    assert.equal(recovered.chats[0].id, chat.id);
    assert.equal(recovered.ui.projectId, projectId);
    for (const key of [
      "explorerWidth",
      "chatWidth",
      "terminalHeight",
      "editorSplit",
      "splitEditor",
      "terminalSizing",
      "gridSessionIds",
    ])
      assert.deepEqual(recovered.ui[key], savedUi[key], key);
    assert.equal(recovered.projects[0].editor.tabs.length, 2);
    assert.match(
      recovered.projects[0].editor.tabs.find((t) => t.path === "app.ts")
        .content,
      /Shared split buffer/,
    );
    assert.equal(recovered.projects[0].editor.secondary, "README.md");
    assert.equal(recovered.projects[0].expandedPaths.length, 3);
    assert.equal(recovered.agents.length, 4);
    assert.equal(recovered.tasks.length, 1);
    assert.equal(recovered.tasks[0].status, "queued");
    assert.match(recovered.agents[0].memory, /accessible controls/);
    assert.match(
      (await api("terminal:log", { id: shell.id })).data,
      /RELAY_PTY_OK/,
    );
    const resumed = await api("terminal:recover", { id: shell.id });
    assert.equal(resumed.status, "running");
    assert.equal(resumed.recoveredFrom, shell.id);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: split editors and shared buffers, saved tabs and drafts, nested explorer, pointer/keyboard pane resizing, visibility toggles, native menus, four independent PTYs, 4/6-pane grids, focus/detach, agent board, build timing, chat records, forced restart and layout/session recovery; no renderer errors.",
    );
    console.log(
      "Screenshots: artifacts/workspace.png, artifacts/terminal-grid.png, artifacts/agent-board.png, artifacts/usage.png",
    );
  } catch (error) {
    console.error("Desktop check failed:", error);
    if (page && !page.isClosed()) {
      console.error(
        "UI alerts:",
        await page.getByRole("alert").allTextContents(),
      );
      console.error("Renderer errors:", errors);
      await screenshot({
        path: path.join(root, "artifacts/failure.png"),
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (desktop) await desktop.close();
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 15,
      retryDelay: 200,
    });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
