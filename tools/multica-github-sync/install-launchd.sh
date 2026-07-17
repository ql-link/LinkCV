#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_BIN=${NODE_BIN:-/opt/homebrew/bin/node}
MULTICA_CLI=${MULTICA_CLI:-/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica}
LABEL=ai.multica.linkcv-github-issue-sync
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/Multica"
INSTALL_DIR="$HOME/Library/Application Support/LinkCV Sync"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
USER_DOMAIN="gui/$(id -u)"

mkdir -p "$PLIST_DIR" "$LOG_DIR" "$INSTALL_DIR"
cp "$SCRIPT_DIR/sync.mjs" "$INSTALL_DIR/sync.mjs"

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/sync.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>MULTICA_WORKSPACE_ID</key>
    <string>b85cd8e8-3eb1-4980-a083-9223d3b8c847</string>
    <key>MULTICA_WORKSPACE_SLUG</key>
    <string>linkcv</string>
    <key>MULTICA_GITHUB_ISSUE_PROPERTY_ID</key>
    <string>c47cf58b-ee99-4b7e-8f14-6543be1d4c5d</string>
    <key>MULTICA_GITHUB_SYNC_PROPERTY_ID</key>
    <string>a1be15e8-2049-4a06-9351-3a7d51f9b3ba</string>
    <key>MULTICA_GITHUB_SYNCED_OPTION_ID</key>
    <string>b3c9e162-22b8-4248-ad83-8f796723a8d9</string>
    <key>MULTICA_CONFIG_PATH</key>
    <string>$HOME/.multica/config.json</string>
    <key>MULTICA_CLI</key>
    <string>$MULTICA_CLI</string>
    <key>GITHUB_REPOSITORY</key>
    <string>ql-link/LinkCV</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/linkcv-github-sync.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/linkcv-github-sync.error.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST_PATH"
launchctl bootout "$USER_DOMAIN" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "$USER_DOMAIN" "$PLIST_PATH"
launchctl enable "$USER_DOMAIN/$LABEL"
launchctl kickstart -k "$USER_DOMAIN/$LABEL"

echo "Installed and started $LABEL"
echo "Program: $INSTALL_DIR/sync.mjs"
echo "Logs: $LOG_DIR/linkcv-github-sync.log"
