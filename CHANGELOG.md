# Changelog

## 0.1.4

- "Open in Remote-SSH Window" can set up VS Code on the machine first. `seedpod.remoteSsh.machineSettings` is merged into the
  machine's `~/.vscode-server/data/Machine/settings.json` (other keys kept, a file with comments left alone), and
  `seedpod.remoteSsh.folder` opens a folder such as `~/workspace` instead of an empty window.
- `seedpod.remoteSsh.user` sets the SSH user, which was fixed to `ubuntu`.

## 0.1.3

- Fix: the Containers view could show an old state. When two refreshes overlapped, a slower, older `lxc list` overwrote the newer one.
  Concurrent renders now share one `lxc list`, and a superseded result is dropped.
- Fix: Force stop was offered after any timeout-like error, including the client's own kill and `dial unix … i/o timeout`;
  now only after LXD reports that the stop timed out.
- Fix: instances in Error, Starting, Stopping or another transitional state showed as Stopped with only Start offered.
  They now show their own icon and keep log, inspect, snapshot and delete.
- Fix: the Networks view now refreshes on LXD lifecycle events, like the other views.
- Docker polling checks expanded machines in parallel, so one hung `dockerd` no longer delays the rest.
- MCP: `create_snapshot` refuses a second snapshot of the same machine while one runs (a client retry after its own
  timeout no longer starts a second copy); serverInfo version comes from package.json; error prefix is `seedpod-mcp`.

## 0.1.2

- Fix: snapshot create, restore and delete hung until timeout. `lxc` reads YAML from stdin when it is not a terminal, and the CLI runner left stdin open; it is now closed.
- Snapshot operations allow 10 minutes, since `dir` storage pools copy the whole filesystem.

## 0.1.1

- Fix: right-click menus in the Containers view were missing after the rename to Seedpod.
- CLI failures with no error output now say the exit code, signal or timeout.

## 0.1.0

- First release: Containers (with nested Docker), Images, Networks and Storage views, actions, and live refresh.
