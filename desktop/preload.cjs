const { contextBridge, ipcRenderer } = require("electron");
const allowed = new Set([
  "state",
  "project:add",
  "project:open-editor",
  "project:tree",
  "editor:state",
  "editor:confirm-discard",
  "agent:create",
  "agent:start",
  "agent:mark",
  "ui:update",
  "files:list",
  "files:read",
  "files:save",
  "files:reload",
  "draft:save",
  "skills:list",
  "terminal:start",
  "terminal:recover",
  "terminal:bind",
  "terminal:write",
  "terminal:resize",
  "terminal:stop",
  "terminal:log",
  "chat:create",
  "chat:send",
  "chat:cancel",
  "settings:save",
  "usage:export",
]);
contextBridge.exposeInMainWorld("relay", {
  call(name, args = {}) {
    if (!allowed.has(name)) return Promise.reject(new Error("Unknown command"));
    return ipcRenderer.invoke(`relay:${name}`, args);
  },
  subscribe(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("relay:event", listener);
    return () => ipcRenderer.removeListener("relay:event", listener);
  },
});
