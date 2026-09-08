const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
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
fs.mkdirSync(path.join(project, ".agents/skills/review"), { recursive: true });
fs.writeFileSync(
  path.join(project, ".agents/skills/review/SKILL.md"),
  "# Review\nCheck correctness and explain tradeoffs.\n",
);
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
    await launch();
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "app.ts", exact: true }).click();
    await page.locator(".cm-content").waitFor();
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
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
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
    // Closing a window leaves the same PTY alive.
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
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
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
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
    // IDE tabs preserve distinct drafts; both editor groups can show the same buffer.
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    assert.equal(
      await page
        .getByRole("tablist", { name: "Files in editor 1" })
        .getByRole("tab")
        .count(),
      2,
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
      assert.equal(await page.locator(selector).count(), 0);
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
    await page.screenshot({ path: path.join(root, "artifacts/workspace.png") });
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
      await page
        .getByRole("combobox", {
          name: `Session in pane ${i + 1}`,
          exact: true,
        })
        .selectOption("");
    }
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("combobox", {
          name: `Session in pane ${i + 1}`,
          exact: true,
        })
        .selectOption(shells[i].id);
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
    assert.equal(await page.locator(".terminal-canvas").count(), 4);
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
    assert.equal(await page.locator(".terminal-tile:visible").count(), 1);
    await page
      .getByRole("button", { name: "Restore grid", exact: true })
      .click();
    assert.equal(await page.locator(".terminal-tile:visible").count(), 4);
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
    await page
      .getByRole("combobox", { name: "Session in pane 1", exact: true })
      .selectOption(shell.id);
    await checkViewport();
    await page.screenshot({
      path: path.join(root, "artifacts/terminal-grid.png"),
    });
    await page
      .getByRole("button", { name: "6 terminal panes", exact: true })
      .click();
    assert.equal(await page.locator(".terminal-tile:visible").count(), 6);
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
    await page.screenshot({
      path: path.join(root, "artifacts/agent-board.png"),
    });
    await page.getByRole("button", { name: "Usage", exact: true }).click();
    await page.getByText("Build history", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, "artifacts/usage.png") });
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
        .items.find((i) => i.label === "View")
        .submenu.items.find((i) => i.label === "Editor")
        .click(),
    );
    await page.locator(".editor-group").first().waitFor();
    await until(async () => (await api("state")).ui.view === "workspace");
    const savedUi = (await api("state")).ui;
    const child = desktop.process();
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    desktop = null;
    await launch();
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
    if (page && !page.isClosed()) {
      console.error(
        "UI alerts:",
        await page.getByRole("alert").allTextContents(),
      );
      console.error("Renderer errors:", errors);
      await page
        .screenshot({ path: path.join(root, "artifacts/failure.png") })
        .catch(() => {});
    }
    throw error;
  } finally {
    if (desktop) await desktop.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
