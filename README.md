# SourceControl

A dark & green desktop Git client in the spirit of GitKraken and Sourcetree, with Git Flow built in.
Built with Electron, React and TypeScript on top of the `git` command line, so it behaves exactly like
git does on your machine: same config, credential helpers, SSH keys and hooks.

## Running

```sh
npm install
npm run dev        # development with hot reload
npm run build      # production build into out/
npm start          # run the production build
npm run dist       # package installers (AppImage/rpm on Linux, dmg on macOS, nsis on Windows) into dist/
npm test           # backend integration tests against real temporary repos
npm run typecheck
```

Requires `git` on your `PATH`. The `git-flow` extension is **not** needed.

## Features

**History**
- Commit graph with coloured lanes, author avatars, and branch/tag pills. It's virtualised, so large histories stay fast.
- Search commits by message, author, SHA or ref (`Ctrl+F`, `Enter` / `Shift+Enter` to step through matches).
- Commit details with changed files and line stats. Ctrl+click a second commit to compare any two.
- File history and blame views.

**Working tree**
- Stage or unstage whole files, **individual hunks, or individual lines** (click line numbers, Shift+click for ranges).
- Discard files, hunks or lines. Ignore files or extensions via `.gitignore` from the context menu.
- Unified and split diff views, with an ignore-whitespace toggle.
- Commit, amend, or commit & push. Summary length counter. `Ctrl+Enter` to commit.

**Branching & history rewriting**
- Create, checkout (including tracking remote branches), rename and delete branches (local and remote). Set upstream.
- Merge (fast-forward, `--no-ff`, ff-only, squash), rebase, cherry-pick, revert, reset (soft/mixed/hard).
- Undo last commit, edit the last commit message.
- **Interactive rebase**: reorder, pick, reword, squash, fixup, drop.
- Merge/rebase/cherry-pick in-progress banner with Continue / Skip / Abort.
- **Conflict editor**: choose ours / theirs / both per conflict, then save & mark resolved.

**Remotes**
- Fetch (with prune), pull (merge / rebase / ff-only), push (with set-upstream; offers force-with-lease when rejected).
- Add, edit, rename and remove remotes. Push and delete tags.
- Credential prompts (HTTPS passwords/tokens, SSH passphrases, host-key confirmation) appear as in-app dialogs.

**Git Flow** (native, compatible with git-flow AVH config)
- Initialise with custom branch names and prefixes.
- Start / finish / publish **feature, bugfix, release, hotfix**; start **support** branches.
- Release and hotfix finish tag the version and back-merge the tag into `develop` (hotfixes go into an open release branch if there is one).
- If a finish stops on a merge conflict, resolve it, commit, and click Finish again to carry on.

**GitHub** (optional, needs a personal access token with `repo` scope in Settings)
- Browse and clone your repositories.
- Create pull requests (draft supported), with base branch defaulting to `develop` for Git Flow branches.
- The token also authenticates HTTPS pushes to github.com. It's stored encrypted with your OS keychain.

**Other**
- Multiple repositories in tabs, recent repositories, auto-refresh when the repo changes.
- Stashes (save with untracked / keep-index, apply, pop, drop, inspect files).
- Git console showing every command the app runs (bottom-right of the status bar).
- Open in terminal / file manager / external editor.

## Project layout

```
src/main/        Electron main process
  runner.ts      spawns git, logs commands to the console
  git.ts         all git operations + output parsing
  gitflow.ts     native Git Flow implementation
  github.ts      GitHub REST API (repos, pull requests)
  askpass.ts     relays git/ssh credential prompts to the UI
  store.ts       settings + encrypted token storage
src/preload/     IPC bridge (single typed `api` channel)
src/shared/      types and the Api interface shared by both sides
src/renderer/    React UI
  src/repo.tsx       per-repository state, refresh & busy handling
  src/actions.tsx    every user action and context menu
  src/lib/graph.ts   commit graph lane layout
  src/lib/diff.ts    diff parsing, hunk/line patch building, conflict parsing
  src/components/    views, panels and dialogs
test/            backend integration tests
```

Keyboard: `F5` refresh · `Ctrl+F` search · `↑/↓` move through commits · `Esc` close diff/blame/history · `F12` dev tools.
