# Seedpod: LXC Explorer

A VS Code sidebar for local LXD containers, modelled on Microsoft's Container Tools view.

- **Containers**: LXD instances grouped by project, with status, OS, IP and uptime. Expanding a running
  machine lists the **Docker containers inside it**, grouped by compose project, plus its snapshots.
- **Images**, **Networks** and **Storage** views (collapsed by default).
- Right-click actions:
  - **Machines:** start / stop / restart / freeze, open a shell, show the log, inspect,
    snapshot / restore / delete, copy IP, open a Remote-SSH window, delete.
  - **Docker containers:** start / stop / restart / remove, view logs, attach a shell, inspect.
  - **Compose groups:** start / restart / stop all.
- Refreshes live from `lxc monitor`. Docker inside expanded machines is polled.

Every destructive action asks first, in a modal that names the target.

## Settings

| Setting | Default | |
|---|---|---|
| `seedpod.cliPath` | `lxc` | Path to the `lxc` binary. Setting it to `incus` is best effort and **untested**: snapshot verbs are mapped, other output is assumed compatible with LXD 5.21. |
| `seedpod.docker.pollInterval` | `10` | Seconds between Docker refreshes for expanded machines. `0` turns polling off. |
| `seedpod.networks.showUnmanaged` | `false` | Also list host bridges LXD does not manage (docker0, br-*). |

## Notes

- Only the local daemon is supported. Remote LXD servers are not.
- Docker is reached through `lxc exec <machine> -- docker …`, so the host needs no Docker socket access.
- "Open in Remote-SSH" connects as `ubuntu@<ip>`. Keys come from your SSH config.

## Build

```bash
npm install
npm test            # parser and tree tests (node --test)
npm run build       # esbuild → dist/extension.js
npm run package     # → seedpod-<version>.vsix
code --install-extension seedpod-0.1.0.vsix
```

## MCP server

The same code also ships as a stdio MCP server (`dist/mcp.js`, built by `npm run build`). It lets an AI client see and manage
the machines and the Docker containers inside them.

| Tool | Writes | |
|---|---|---|
| `list_machines` | | every instance: status, OS, IPv4, uptime, snapshots, protected flag |
| `machine_info`, `machine_log` | | expanded config + `lxc info`, and the LXC log |
| `list_docker` | | Docker containers inside a machine, grouped by compose project |
| `docker_logs`, `docker_inspect` | | bounded logs (no follow), and `docker inspect` |
| `list_resources` | | images, managed networks, storage pools |
| `machine_action` | ✔ | start / stop (100 s clean timeout, never forced) / restart / freeze / unfreeze |
| `create_snapshot` | ✔ | new snapshot (validated name) |
| `docker_action`, `compose_action` | ✔ | start / stop / restart a container or a whole compose project |
| `exec` | ✔ | run an argv inside a machine as root and return the exit code and output |

There are deliberately **no delete, restore or remove tools**.

| Env var | |
|---|---|
| `SEEDPOD_CLI` | path to `lxc` (default `lxc`) |
| `SEEDPOD_READONLY=1` | register the read-only tools only |
| `SEEDPOD_PROTECT=a,b` | machines no write tool (including `exec`) may touch |

To register it with Claude Code:

```bash
claude mcp add --scope user seedpod -e SEEDPOD_PROTECT=my-template -- node /path/to/seedpod/dist/mcp.js
```
