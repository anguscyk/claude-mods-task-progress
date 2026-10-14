# task-progress

Claude Code mod：在提示列上方顯示任務進度條、每個任務的耗時，以及本輪執行時間。

有任務清單時：

```
██████████░░░░░░░░░░ 2/4 (50%)  進行中：執行測試 [收合]  執行中 4m40s
  ✓ 建立 DTO  1m02s
  ✓ 撰寫 Service  3m15s
  ▶ 執行測試  12s
  ○ 更新文件
```

沒有任務清單時，以本輪的工具呼叫當作步驟：

```
●●●●○ 5 步 [收合]  執行中 42s
  ✓ Read register.tsx  0s
  ✓ Bash 執行測試  3s
  ✗ Bash 型別檢查  8s
  ▶ Edit register.tsx  1s
```

一輪結束後自動收合：

```
●●●●● 5 步 [展開]  上一輪耗時 1m10s  共 5 步，失敗 1
```

## 功能

- **步驟列表**：沒有任務清單時，改以本輪每個工具呼叫當作一步（●○ 點狀進度、✓ 成功／✗ 失敗／▶ 執行中與耗時），只列最近 5 步
- **進度條**：依 Claude 的任務清單（`TaskCreate` / `TaskUpdate` / `TodoWrite`）顯示完成數、百分比與目前進行中的任務
- **任務耗時**：每個任務從進行中到完成的時間；已完成打勾（✓）、進行中（▶）、未開始（○）
- **執行時間**：與進度列同一行，本輪進行中每秒更新，結束後顯示上一輪耗時（只計主對話，不含子代理）
- **收合／展開**：預設收合，有任務進行中時自動展開；每輪結束自動收合。可按按鈕手動切換
- **收合摘要**：收合時顯示「已完成 3/5，最近：建立 DTO」
- **摺疊**：任務數超過門檻時，較早完成的任務摺疊成「…另有 N 項已完成」
- **名稱截斷**：任務名稱超過上限時截斷並加「…」

## 安裝

在終端機的 Claude Code 提示列輸入：

```
/plugin install task-progress --marketplace anguscyk/claude-mods-task-progress
```

或在 shell 執行：

```
claude plugin install task-progress --marketplace anguscyk/claude-mods-task-progress
```

出現 `Add marketplace?` 時按 `y`，再選安裝範圍（預設 user）。

桌面版 App 不支援 `/plugin` 指令：點提示框旁的 +，選 Plugins → Add marketplace，填入 `anguscyk/claude-mods-task-progress`，再 Add plugin。

本 repository 為 GitHub 私人 repo：安裝者須先被加為 collaborator，且電腦上已設好 GitHub 的 git 憑證（SSH key，或 `gh auth login` 後執行 `gh auth setup-git`）；安裝過程不會詢問帳密。

## 設定

安裝後可在 `/config` 調整，或寫在 settings.json 的 `pluginConfigs["task-progress"].options`：

| 選項 | 說明 | 預設 | 範圍 |
|------|------|------|------|
| `nameMax` | 任務名稱長度上限，超過截斷加「…」 | 20 | 1–200 |
| `foldThreshold` | 任務數超過此值時摺疊較早完成的任務 | 8 | 1–200 |
| `keepDone` | 摺疊時保留最近完成的筆數（0 表示全部摺疊） | 3 | 0–200 |

不合法的值會改用預設值，小數無條件捨去。

## 開發

```
claude --plugin-dir .          # 以本資料夾載入 mod 啟動 session
claude plugin validate .       # 檢查 manifest 與 hooks
claude plugin test .           # 執行 tests/*.test.ts
```
