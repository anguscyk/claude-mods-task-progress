# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

task-progress 是一個 Claude Code mod（function-hooks plugin），在提示列上方（`AbovePrompt`）顯示任務進度條、各任務耗時、本輪工具呼叫步驟與執行時間。沒有 build 步驟、沒有 package.json：`hooks/hooks.json` 直接載入 `hooks/register.tsx`，由 Claude Code 執行。

## 指令

```bash
claude --plugin-dir .          # 以本資料夾載入 mod 啟動 session（手動驗證畫面）
claude plugin validate .       # 檢查 manifest 與 hooks
claude plugin test .           # 執行 tests/*.test.ts（沒有篩選單一測試的參數，一律跑整個資料夾）
scripts/gen-preview.sh         # 重新產生 docs/preview.svg 與 docs/preview.en.svg（需 claude 與 python3）
```

`tsconfig.json` 繼承 `.claude-plugin/types/tsconfig.json`，該目錄被 `.gitignore` 排除、不在 repo 內。

## 架構

- `hooks/register.tsx`：全部邏輯。上半部是 export 的純函式（`formatDuration`、`visibleTasks`、`truncate`／`displayWidth`、`stepLabel`、`errorSummary`、`settingsFrom` 等），供測試直接匯入；下半部 `register` 註冊各 hook。
- 狀態以 `atom({ plugin: 'task-progress', key })` 存在 session state：`tasks`、`timing`、`steps`、`collapseOverride`。新增 atom 時要同步更新 `types/index.d.ts` 裡 `declare module 'claude-code'` 的 `PluginState`。
- Hook 分工：
  - `tool.call`（不帶篩選）：主對話的每個呼叫記為一個 step；`e.agentId !== undefined`（子代理）一律略過。
  - `tool.call` 對 `TodoWrite`／`TaskCreate`／`TaskUpdate`：呼叫成功後才更新任務清單。TodoWrite 每次送整份清單，以 `subject` 比對沿用舊的計時。
  - `turn.start`／`turn.complete`／`prompt.submit`：計時、每輪清空 steps、重設收合狀態；`session.start` 用 `$.clock.every(1000)` 只在執行中刷新 `timing.now`。
  - `ui.render`（`AbovePrompt`）：有任務清單時畫進度條模式，否則畫步驟模式。
- 不變條件（README「運作方式」與 marketplace 審核都依賴這些）：
  - hook 只觀察：一律 `return next(e)` 或回傳 `next` 的結果，不修改輸入、不攔截、不改寫結果；每個 hook 都掛 `.catch(($, e, next) => next(e))`。
  - `ui.render` 一定先 `await next(e)` 取得下層內容並放進自己的區塊，否則會蓋掉其他 mod（如 next-steps）。
  - 收合狀態：`collapseOverride` 為 `null` 時一律收合，只有手動按鈕才展開；每輪開始／結束與送出提示時重設。
  - 畫面文字只用不分語言的符號（✓ ✗ ▶ ○ ⟳ ◷ `[ + ]`），不要加入需翻譯的文字；避免 ⏲／⏱ 等 emoji 寬字元。
  - 名稱截斷以終端機顯示寬度計算（`displayWidth`，CJK 佔 2 格），不是字元數。
- `userConfig`（`nameMax`／`foldThreshold`／`keepDone`）定義在 `.claude-plugin/plugin.json`，經 `settingsFrom` 解析；不合法值退回預設、小數捨去。新增選項時要同時改 plugin.json、`settingsFrom` 與兩份 README 的設定表。

## 測試

`tests/progress.test.ts` 使用 `claude-code/testing`：純函式直接測，hook 行為用 `test(name, { options }, async ($, on) => …)` 取得 Engine，以 `$.ui.render({ component: 'AbovePrompt', … })` 繪出樹後對 JSON 字串比對。`answerBelow(on)` 模擬下層 mod 的內容。

`scripts/preview/render-scenarios.ts` 不是一般測試：`gen-preview.sh` 把它複製到暫存 plugin 的 `tests/` 執行，從輸出擷取 `@@<語系>:<名稱>@@<JSON>` 再由 `tree2svg.py` 轉成 SVG。畫面改版後要重新產生示意圖。

## Marketplace 審核限制

- 不要用 `h` 當變數名稱（JSX 編譯後的元素工廠，審核要求只用於呼叫）。
- repo 內任何文字（含 README、腳本）都不要指名圖示檔路徑；會讀取憑證的腳本不納入版本控制。發布腳本 `scripts/release.sh` 與圖示腳本 `scripts/make-icon.py` 是維護者本機檔案，已被 `.gitignore` 排除。

## 文件與版本慣例

- 程式註解、commit 訊息、README 以繁體中文為主；commit 採 `feat:`／`fix:`／`docs:`／`chore:` 前綴。
- `README.md`（中文）與 `README.en.md`（英文）需同步更新，包含「變更紀錄」段落。
- 版本號在 `.claude-plugin/plugin.json` 的 `version`；發布後兩份 README 的版本標題會補上 GitHub Release 連結。
