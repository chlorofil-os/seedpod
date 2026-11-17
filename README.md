# Seedpod

**Your LXC machines, and the Docker running inside them, in one tree.**

Seedpod is a VS Code sidebar and an MCP server for people who run their dev environments as LXD system
containers: a machine per branch, per client, per experiment, each one with its own Docker Compose stack inside.

## Why Seedpod

LXD system containers are a great way to run many full dev machines on one host. They boot in seconds,
clone in seconds on btrfs or ZFS, and run systemd and Docker like a VM, at a fraction of the cost. But the tooling stops
at the machine boundary:

- **Container Tools only sees the host's Docker.** The compose stacks inside your LXD machines are invisible
  to it, so checking on them means `lxc exec <machine> -- docker ps`, again and again, one machine at a time.
- **`lxc` and `docker` are two separate worlds.** Is `web` down because the container stopped, or because
  the machine around it did? You end up asking both, by hand.
- **Agents get a shell or nothing.** Giving an AI assistant raw `lxc` access means it can delete anything.
  Giving it none means it can't help.

Seedpod puts both layers in one place:

- **One tree.** Machine → compose project → container, with live status, IPs and uptime, refreshed as LXD
  reports changes.
- **One right-click.** Start, stop, open a shell, read logs or snapshot at whichever level is broken, with
  a confirmation that names the target before anything destructive.
- **The same model for AI clients.** The MCP server gives assistants structured tools instead of a shell.
  Machines you list as protected can't be changed, there's a read-only mode, and there are no delete or
  restore tools at all.

## The extension

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
