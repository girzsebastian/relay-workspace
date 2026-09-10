// The source control menu, declared once. Each entry says which git arguments
// it runs, whether it needs a value from the user, and whether it destroys
// work — the interface reads those flags rather than hard-coding its own list.
const COMMANDS = {
  // Pull, push and fetch
  sync: { group: "Pull, Push", label: "Sync", special: "sync" },
  pull: {
    group: "Pull, Push",
    label: "Pull",
    args: () => ["pull", "--ff-only"],
  },
  "pull-rebase": {
    group: "Pull, Push",
    label: "Pull (Rebase)",
    args: () => ["pull", "--rebase"],
  },
  push: { group: "Pull, Push", label: "Push", special: "push" },
  "push-to": {
    group: "Pull, Push",
    label: "Push to…",
    input: { label: "Remote name", placeholder: "origin" },
    args: (input, state) => ["push", input, state.branch],
  },
  fetch: { group: "Pull, Push", label: "Fetch", args: () => ["fetch"] },
  "fetch-prune": {
    group: "Pull, Push",
    label: "Fetch (Prune)",
    args: () => ["fetch", "--prune"],
  },
  "fetch-all": {
    group: "Pull, Push",
    label: "Fetch From All Remotes",
    args: () => ["fetch", "--all", "--prune"],
  },

  // Commit
  "commit-staged": {
    group: "Commit",
    label: "Commit Staged",
    input: { label: "Commit message", multiline: true },
    args: (input) => ["commit", "-m", input],
  },
  "commit-all": {
    group: "Commit",
    label: "Commit All",
    input: { label: "Commit message", multiline: true },
    args: (input) => ["commit", "--all", "-m", input],
  },
  "commit-amend": {
    group: "Commit",
    label: "Commit Staged (Amend)",
    input: { label: "New commit message", multiline: true },
    args: (input) => ["commit", "--amend", "-m", input],
    destructive: true,
  },
  "commit-signed": {
    group: "Commit",
    label: "Commit All (Signed Off)",
    input: { label: "Commit message", multiline: true },
    args: (input) => ["commit", "--all", "--signoff", "-m", input],
  },
  "undo-commit": {
    group: "Commit",
    label: "Undo Last Commit",
    // Soft: the commit disappears, its changes stay in the working tree.
    args: () => ["reset", "--soft", "HEAD~1"],
    destructive: true,
  },

  // Changes
  "stage-all": {
    group: "Changes",
    label: "Stage All Changes",
    args: () => ["add", "--all"],
  },
  "unstage-all": {
    group: "Changes",
    label: "Unstage All Changes",
    args: () => ["reset"],
  },
  "discard-all": {
    group: "Changes",
    label: "Discard All Changes",
    // Tracked files only; git cannot bring back an untracked file.
    args: () => ["checkout", "--", "."],
    destructive: true,
  },

  // Branch
  "create-branch": {
    group: "Branch",
    label: "Create Branch…",
    input: { label: "New branch name" },
    args: (input) => ["checkout", "-b", input],
  },
  "create-branch-from": {
    group: "Branch",
    label: "Create Branch From…",
    input: {
      label: "New branch, then start point",
      placeholder: "name origin/main",
    },
    args: (input) => ["checkout", "-b", ...input.split(/\s+/).filter(Boolean)],
  },
  "rename-branch": {
    group: "Branch",
    label: "Rename Branch…",
    input: { label: "New name for the current branch" },
    args: (input) => ["branch", "-m", input],
  },
  "delete-branch": {
    group: "Branch",
    label: "Delete Branch…",
    input: { label: "Branch to delete" },
    // -d refuses to drop unmerged work; -D would not.
    args: (input) => ["branch", "-d", input],
    destructive: true,
  },
  merge: {
    group: "Branch",
    label: "Merge…",
    input: { label: "Branch to merge into this one" },
    args: (input) => ["merge", input],
  },
  rebase: {
    group: "Branch",
    label: "Rebase Branch…",
    input: { label: "Branch to rebase onto" },
    args: (input) => ["rebase", input],
    destructive: true,
  },
  "publish-branch": {
    group: "Branch",
    label: "Publish Branch",
    args: (input, state) => ["push", "--set-upstream", "origin", state.branch],
  },

  // Remote
  "add-remote": {
    group: "Remote",
    label: "Add Remote…",
    input: {
      label: "Name and URL",
      placeholder: "origin git@host:me/repo.git",
    },
    args: (input) => ["remote", "add", ...input.split(/\s+/).filter(Boolean)],
  },
  "remove-remote": {
    group: "Remote",
    label: "Remove Remote",
    input: { label: "Remote to remove", placeholder: "origin" },
    args: (input) => ["remote", "remove", input],
    destructive: true,
  },

  // Stash
  stash: {
    group: "Stash",
    label: "Stash",
    args: () => ["stash", "push"],
  },
  "stash-untracked": {
    group: "Stash",
    label: "Stash (Include Untracked)",
    args: () => ["stash", "push", "--include-untracked"],
  },
  "stash-staged": {
    group: "Stash",
    label: "Stash Staged",
    args: () => ["stash", "push", "--staged"],
  },
  "apply-stash": {
    group: "Stash",
    label: "Apply Latest Stash",
    args: () => ["stash", "apply"],
  },
  "pop-stash": {
    group: "Stash",
    label: "Pop Latest Stash",
    args: () => ["stash", "pop"],
  },
  "drop-stash": {
    group: "Stash",
    label: "Drop Latest Stash",
    args: () => ["stash", "drop"],
    destructive: true,
  },
  "list-stashes": {
    group: "Stash",
    label: "View Stashes",
    args: () => ["stash", "list"],
    output: true,
  },

  // Tags
  "create-tag": {
    group: "Tags",
    label: "Create Tag…",
    input: { label: "Tag name" },
    args: (input) => ["tag", input],
  },
  "delete-tag": {
    group: "Tags",
    label: "Delete Tag…",
    input: { label: "Tag to delete" },
    args: (input) => ["tag", "-d", input],
    destructive: true,
  },
  "delete-remote-tag": {
    group: "Tags",
    label: "Delete Remote Tag…",
    input: { label: "Tag to delete on origin" },
    args: (input) => ["push", "origin", `:refs/tags/${input}`],
    destructive: true,
  },
  "list-tags": {
    group: "Tags",
    label: "View Tags",
    args: () => ["tag", "--list", "--sort=-creatordate"],
    output: true,
  },

  // Worktrees
  "list-worktrees": {
    group: "Worktrees",
    label: "View Worktrees",
    args: () => ["worktree", "list"],
    output: true,
  },
  "add-worktree": {
    group: "Worktrees",
    label: "Add Worktree…",
    input: {
      label: "Path, then branch",
      placeholder: "../review feature/login",
    },
    args: (input) => ["worktree", "add", ...input.split(/\s+/).filter(Boolean)],
  },
  "remove-worktree": {
    group: "Worktrees",
    label: "Delete Worktree…",
    input: { label: "Worktree path to remove" },
    args: (input) => ["worktree", "remove", input],
    destructive: true,
  },

  // Diagnostics
  "git-output": {
    group: "Other",
    label: "Show Git Output",
    args: () => ["status", "--long"],
    output: true,
  },
};

const GROUP_ORDER = [
  "Pull, Push",
  "Commit",
  "Changes",
  "Branch",
  "Remote",
  "Stash",
  "Tags",
  "Worktrees",
  "Other",
];

// The interface asks for this instead of duplicating the table in TypeScript.
function menu() {
  return GROUP_ORDER.map((group) => ({
    group,
    items: Object.entries(COMMANDS)
      .filter(([, command]) => command.group === group)
      .map(([id, command]) => ({
        id,
        label: command.label,
        input: command.input || null,
        destructive: !!command.destructive,
        output: !!command.output,
      })),
  })).filter((section) => section.items.length);
}

function buildArgs(id, input, state) {
  const command = COMMANDS[id];
  if (!command) throw new Error("Unknown git command.");
  const value = String(input || "").trim();
  if (command.input && !value)
    throw new Error(`${command.input.label} is required.`);
  // A typed value must never smuggle in a flag: "--force" as a branch name
  // would change what the command does rather than name something.
  if (command.input && value.split(/\s+/).some((part) => part.startsWith("-")))
    throw new Error("Values cannot start with a dash.");
  const args = command.args?.(value, state || {});
  if (!args?.length) throw new Error("That command produced nothing to run.");
  // A value that begins with a dash would be read as a flag.
  for (const value of args)
    if (typeof value !== "string" || !value.length)
      throw new Error("That command has an empty argument.");
  return args;
}

module.exports = { COMMANDS, GROUP_ORDER, menu, buildArgs };
