#!/bin/sh
# Fake `lxc` for provider tests. State lives in $FAKE_DIR:
#   list.json          output of `list`
#   docker.out / docker.err / docker.code   reply to `exec … docker ps`
#   exec.out / exec.code  reply to any other `exec`
#   monitor.N          script body for the Nth `monitor` invocation (default: sleep)
# Every call is appended to calls.log.
echo "$*" >> "$FAKE_DIR/calls.log"
case "$1" in
  list) cat "$FAKE_DIR/list.json" ;;
  exec)
    case "$*" in *" -- docker ps "*) ;; *)
      if [ -f "$FAKE_DIR/exec.out" ]; then cat "$FAKE_DIR/exec.out"; exit "$(cat "$FAKE_DIR/exec.code" 2>/dev/null || echo 0)"; fi ;;
    esac
    cat "$FAKE_DIR/docker.out" 2>/dev/null
    cat "$FAKE_DIR/docker.err" 1>&2 2>/dev/null
    exit "$(cat "$FAKE_DIR/docker.code" 2>/dev/null || echo 0)" ;;
  monitor)
    n=$(($(cat "$FAKE_DIR/monitor.count" 2>/dev/null || echo 0) + 1)); echo $n > "$FAKE_DIR/monitor.count"
    if [ -f "$FAKE_DIR/monitor.$n" ]; then . "$FAKE_DIR/monitor.$n"; else exec sleep 30; fi ;;
  fail-silent) exit 5 ;;
  *) exit 0 ;;
esac
