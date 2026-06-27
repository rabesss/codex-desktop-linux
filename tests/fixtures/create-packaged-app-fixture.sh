#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="${1:-codex-app}"

mkdir -p \
    "$app_dir/content/webview" \
    "$app_dir/resources/node-runtime/bin" \
    "$app_dir/resources/plugins/openai-bundled/plugins/browser/.codex-plugin" \
    "$app_dir/resources/plugins/openai-bundled/plugins/chrome/.codex-plugin" \
    "$app_dir/resources/plugins/openai-bundled/plugins/computer-use/.codex-plugin" \
    "$app_dir/resources/plugins/openai-bundled/plugins/computer-use/bin" \
    "$app_dir/resources/plugins/openai-bundled/.agents/plugins"

printf '%s\n' '#!/usr/bin/env bash' 'echo "codex desktop fixture"' > "$app_dir/start.sh"
chmod +x "$app_dir/start.sh"

printf '%s\n' '<!doctype html><title>Codex fixture</title>' > "$app_dir/content/webview/index.html"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$app_dir/electron"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$app_dir/resources/node_repl"
chmod +x "$app_dir/electron" "$app_dir/resources/node_repl"

for binary in node npm npx; do
    cat > "$app_dir/resources/node-runtime/bin/$binary" <<'SCRIPT'
#!/usr/bin/env bash
case "$(basename "$0")" in
    node)
        case "${1:-}" in
            -e)
                case "${2:-}" in
                    'process.stdout.write("ok")') printf 'ok'; exit 0 ;;
                    'process.stdout.write("codex-node-runtime-ok:" + process.versions.node)') printf 'codex-node-runtime-ok:22.22.2'; exit 0 ;;
                esac
                ;;
            -v|--version)
                echo v22.22.2
                exit 0
                ;;
        esac
        real_node="$(command -v node || true)"
        if [ -n "$real_node" ] && [ "$real_node" != "$0" ]; then
            exec "$real_node" "$@"
        fi
        echo v22.22.2
        ;;
    *) echo 10.9.7 ;;
esac
SCRIPT
    chmod +x "$app_dir/resources/node-runtime/bin/$binary"
done

cat > "$app_dir/resources/codex-linux-build-info.json" <<'JSON'
{
  "upstreamDmg": {
    "appVersion": "0.0.0-fixture"
  },
  "electronVersion": "42.1.0",
  "linuxFeatures": {
    "enabled": []
  }
}
JSON

cat > "$app_dir/resources/plugins/openai-bundled/.agents/plugins/marketplace.json" <<'JSON'
{"plugins":[{"name":"browser"},{"name":"chrome"},{"name":"computer-use"}]}
JSON

for plugin in browser chrome computer-use; do
    cat > "$app_dir/resources/plugins/openai-bundled/plugins/$plugin/.codex-plugin/plugin.json" <<JSON
{"name":"$plugin","version":"0.0.0-fixture"}
JSON
done
