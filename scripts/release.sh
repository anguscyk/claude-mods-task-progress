#!/usr/bin/env bash
# 發布新版本：改 plugin.json 版本 → 驗證與測試 → commit/push → 打 tag → 建立中英並列的 GitHub Release
# → 把兩份 README 的版本標題補成 Release 連結並 commit/push。
#
# 用法：scripts/release.sh <版本> [--dry-run]
#   例：scripts/release.sh 1.2.3
#
# 事前準備：先在 README.md 與 README.en.md 的「變更紀錄／Changelog」寫好該版本段落，標題格式為
#   README.md     ### X.Y.Z（YYYY-MM-DD）
#   README.en.md  ### X.Y.Z (YYYY-MM-DD)
# 段落可以尚未 commit；除了這兩份 README 與 plugin.json，工作區不可有其他未提交的改動。
#
# GitHub 憑證：優先使用環境變數 GITHUB_TOKEN，否則向 git credential（如 macOS 鑰匙圈）取 github.com 的憑證。
# 憑證只放在記憶體與 curl 的標頭，不會輸出或寫入檔案。
#
# 需求：git、curl、python3、claude CLI
set -euo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "錯誤：$*" >&2; exit 1; }

VERSION=""
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage 0 ;;
    -*) die "未知選項：$arg" ;;
    *) [ -z "${VERSION}" ] || die "只能指定一個版本"; VERSION="$arg" ;;
  esac
done
[ -n "${VERSION}" ] || usage 1
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本格式須為 X.Y.Z：${VERSION}"
TAG="v${VERSION}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

run() {
  if ${DRY_RUN}; then echo "[dry-run] $*"; else "$@"; fi
}

# 從 origin 網址取出 owner/repo
REMOTE_URL="$(git remote get-url origin)"
REPO="$(printf '%s' "${REMOTE_URL}" | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
[[ "${REPO}" =~ ^[^/]+/[^/]+$ ]] || die "無法從 origin 取得 GitHub owner/repo：${REMOTE_URL}"
RELEASE_URL="https://github.com/${REPO}/releases/tag/${TAG}"

# ---- 事前檢查 ----
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "請在 main 分支執行"
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "本機 main 與 origin/main 不一致，請先同步"
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || git ls-remote --exit-code --tags origin "${TAG}" >/dev/null 2>&1; then
  die "tag ${TAG} 已存在"
fi
OTHER_CHANGES="$(git status --porcelain | grep -v -E '^.. (README\.md|README\.en\.md|\.claude-plugin/plugin\.json)$' || true)"
[ -z "${OTHER_CHANGES}" ] || die "工作區有其他未提交的改動：
${OTHER_CHANGES}"

ZH_HEADING_PREFIX="### ${VERSION}（"
EN_HEADING_PREFIX="### ${VERSION} ("
# 只認行首的標題：README 內文（例如開發段落的說明）也可能出現同樣字樣
has_heading() { awk -v h="$2" 'index($0, h) == 1 { found = 1 } END { exit !found }' "$1"; }
has_heading README.md "${ZH_HEADING_PREFIX}" || die "README.md 找不到「${ZH_HEADING_PREFIX}…）」變更紀錄段落"
has_heading README.en.md "${EN_HEADING_PREFIX}" || die "README.en.md 找不到「${EN_HEADING_PREFIX}…)」變更紀錄段落"

# 取出某份 README 指定標題下的條列內容（到下一個標題為止）
section() {
  awk -v h="$2" 'index($0, h) == 1 { f = 1; next } /^#/ { f = 0 } f' "$1" \
    | sed '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}
ZH_NOTES="$(section README.md "${ZH_HEADING_PREFIX}")"
EN_NOTES="$(section README.en.md "${EN_HEADING_PREFIX}")"
[ -n "${ZH_NOTES}" ] || die "README.md 的 ${VERSION} 段落是空的"
[ -n "${EN_NOTES}" ] || die "README.en.md 的 ${VERSION} 段落是空的"
BODY="$(printf '## 中文\n\n%s\n\n## English\n\n%s' "${ZH_NOTES}" "${EN_NOTES}")"

echo "準備發布 ${REPO} ${TAG}"
echo "----- Release 內容 -----"
printf '%s\n' "${BODY}"
echo "------------------------"

# ---- 取得 GitHub 憑證（dry-run 不需要）----
TOKEN=""
if ! ${DRY_RUN}; then
  TOKEN="${GITHUB_TOKEN:-}"
  if [ -z "${TOKEN}" ]; then
    TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
  fi
  [ -n "${TOKEN}" ] || die "找不到 GitHub 憑證：請設定 GITHUB_TOKEN，或先以 git 登入 github.com"
fi

# ---- 1. 改版本、驗證、commit、push ----
run python3 -I - "${ROOT}/.claude-plugin/plugin.json" "${VERSION}" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as f:
    manifest = json.load(f)
manifest['version'] = version
with open(path, 'w', encoding='utf-8') as f:
    f.write(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
PY
run claude plugin validate .
run claude plugin test .
run git add .claude-plugin/plugin.json README.md README.en.md
run git commit -q -m "chore: ${TAG}" -m "plugin.json 版本 ${VERSION}；README.md 與 README.en.md 變更紀錄新增 ${VERSION}。"
run git push -q origin main

# ---- 2. 打 tag 並 push ----
run git tag -a "${TAG}" -m "task-progress ${TAG}"
run git push -q origin "${TAG}"

# ---- 3. 建立 GitHub Release ----
PAYLOAD="$(python3 -I -c 'import json, sys; print(json.dumps({"tag_name": sys.argv[1], "name": "task-progress " + sys.argv[1], "body": sys.argv[2], "draft": False, "prerelease": False, "make_latest": "true"}))' "${TAG}" "${BODY}")"
if ${DRY_RUN}; then
  echo "[dry-run] POST https://api.github.com/repos/${REPO}/releases（${TAG}，設為 Latest）"
else
  RESPONSE="$(curl -sS -w '\n%{http_code}' -X POST \
    -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/releases" -d "${PAYLOAD}")"
  STATUS="${RESPONSE##*$'\n'}"
  [ "${STATUS}" = "201" ] || die "建立 Release 失敗（HTTP ${STATUS}）；tag ${TAG} 已推送，可修正後手動建立 Release"
fi
TOKEN=""

# ---- 4. README 標題補上 Release 連結，commit、push ----
run python3 -I - "${ROOT}" "${VERSION}" "${RELEASE_URL}" <<'PY'
import re, sys
root, version, url = sys.argv[1:4]
for name, prefix in (('README.md', f'### {version}（'), ('README.en.md', f'### {version} (')):
    path = f'{root}/{name}'
    with open(path, encoding='utf-8') as f:
        text = f.read()
    linked = f'### [{version}]({url})' + prefix[len(f'### {version}'):]
    # 只替換行首的標題，不動內文中出現的同樣字樣
    pattern = re.compile('^' + re.escape(prefix), re.MULTILINE)
    if len(pattern.findall(text)) != 1:
        sys.exit(f'{name}: 找不到唯一的 {prefix} 標題')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(pattern.sub(lambda _: linked, text))
PY
run git add README.md README.en.md
run git commit -q -m "docs: 兩份 README 的 ${VERSION} 標題補上 Release 連結"
run git push -q origin main

if ${DRY_RUN}; then echo "dry-run 結束，未做任何變更"; else echo "完成：${RELEASE_URL}"; fi
