#!/usr/bin/env bash
# 重新產生 docs/preview.svg（中文任務名稱）與 docs/preview.en.svg（英文任務名稱）：
# 在暫存複本中執行示意圖情境，取得 task-progress 實際繪出的內容後轉成 SVG。
# 需求：claude CLI、python3
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/plugin"
rsync -a --exclude .git --exclude tests --exclude docs --exclude scripts "$ROOT/" "$WORK/plugin/"
mkdir -p "$WORK/plugin/tests"
cp "$ROOT/scripts/preview/render-scenarios.ts" "$WORK/plugin/tests/render.test.ts"

claude plugin test "$WORK/plugin" > "$WORK/test-output.txt" 2>&1 || {
  cat "$WORK/test-output.txt" >&2
  exit 1
}
grep -o '@@.*' "$WORK/test-output.txt" > "$WORK/trees.txt"

mkdir -p "$ROOT/docs"
python3 -I "$ROOT/scripts/preview/tree2svg.py" "$WORK/trees.txt" "$ROOT/docs/preview.svg" zh > /dev/null
python3 -I "$ROOT/scripts/preview/tree2svg.py" "$WORK/trees.txt" "$ROOT/docs/preview.en.svg" en > /dev/null
echo "已更新 docs/preview.svg、docs/preview.en.svg"
