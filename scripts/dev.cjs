const { spawn } = require("node:child_process");
const path = require("node:path");
const server = spawn(
  process.execPath,
  [path.join(__dirname, "../node_modules/vite/bin/vite.js")],
  { stdio: "inherit" },
);
let desktop;
const poll = setInterval(async () => {
  try {
    if (!(await fetch("http://127.0.0.1:5178")).ok) return;
    clearInterval(poll);
    desktop = spawn(require("electron"), ["."], {
      stdio: "inherit",
      env: { ...process.env, RELAY_DEV_URL: "http://127.0.0.1:5178/" },
    });
    desktop.on("exit", () => server.kill());
  } catch {}
}, 300);
server.on("exit", () => {
  clearInterval(poll);
  desktop?.kill();
});
process.on("SIGINT", () => {
  clearInterval(poll);
  server.kill();
  desktop?.kill();
});
