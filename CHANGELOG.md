# Changelog

## 0.1.2

- Fix: snapshot create, restore and delete hung until timeout. `lxc` reads YAML from stdin when it is not a terminal, and the CLI runner left stdin open; it is now closed.
- Snapshot operations allow 10 minutes, since `dir` storage pools copy the whole filesystem.

## 0.1.1

- Fix: right-click menus in the Containers view were missing after the rename to Seedpod.
- CLI failures with no error output now say the exit code, signal or timeout.

## 0.1.0

- First release: Containers (with nested Docker), Images, Networks and Storage views, actions, and live refresh.
