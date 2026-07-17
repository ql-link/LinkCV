# Multica → GitHub Issue sync

This bridge keeps Multica as the source of truth and mirrors every Issue in the
`linkcv` workspace to `ql-link/LinkCV`.

## Semantics

- `issue:created` and `issue:updated` WebSocket events sync immediately.
- A full reconciliation runs at startup and every five minutes to recover
  events missed while the machine or network was offline.
- `backlog`, `todo`, `in_progress`, `in_review`, and `blocked` map to an open
  GitHub Issue.
- `done` and `cancelled` close the GitHub Issue. Moving the Multica Issue back
  to a non-terminal state reopens it.
- A hidden Multica workspace/Issue marker is the idempotency key. The bridge
  also writes the GitHub number and URL into Multica metadata and visible
  `GitHub Issue` / `GitHub Sync` properties.
- GitHub title, body, and open/closed state are mirror fields. Manual edits to
  them can be overwritten by the next Multica sync. Labels other than the
  bridge-owned `multica` label are preserved.

## Local commands

```sh
MULTICA_WORKSPACE_ID=b85cd8e8-3eb1-4980-a083-9223d3b8c847 \
  npm run sync:multica-github -- --once

npm run test:multica-github-sync
```

The bridge reads the existing Multica token from `~/.multica/config.json` and
uses the authenticated GitHub CLI. It does not copy either token into the
repository or LaunchAgent plist.

On macOS, `install-launchd.sh` installs the per-user service
`ai.multica.linkcv-github-issue-sync`, copies the executable to
`~/Library/Application Support/LinkCV Sync`, and stores logs under
`~/Library/Logs/Multica`. Re-running the installer updates the installed copy
and restarts the service.
