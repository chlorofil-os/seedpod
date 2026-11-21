# Changelog

## 0.1.7

- MCP: every tool now sets all four annotation hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`) instead of leaving some to the MCP defaults. Two values changed: `machine_action`, `docker_action`
  and `compose_action` are no longer marked idempotent, since all three offer restart, and `exec` is now marked
  open-world, since it runs any command as root.

## 0.1.6

- Fix: hovers closed as soon as the mouse left the tree row, so their links could not be clicked. Every hover now ends
  with a row of actions, which also keeps it open: Shell, Remote-SSH, Log, Inspect and Copy IP on a machine; Logs, Shell
  and Inspect on a container; Start, Restart and Stop on a compose group. Hover links may run only those commands.

## 0.1.5

- Hovers like the Docker extension's. A Docker container shows its name and short ID, image, ports, volumes and
  networks from `docker inspect`, run when hovered. Published ports link to `http://<machine IP>:<port>`; ports bound
  to loopback inside the machine stay plain text. A machine shows its status, proxy ports, disks, NICs, limits and
  snapshots from the `lxc list` data already loaded. A compose group lists its services and their state.
- Grouping by stack: crmleaf, chlorofil and so on, from the `user.seedbed.project` key, a `user.<stack>.ip` key, a
  `<stack>-*` profile, then the name prefix. The toolbar button cycles stack, LXD project and no grouping, and
  `seedpod.groupBy` sets the default (`stack`).

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
