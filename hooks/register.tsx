import { atom, read, update } from 'claude-code'
import type { PluginOptions, Register, StateDollar } from 'claude-code'

import type { Step, StepStatus, Task, TaskStatus, Timing } from '../types'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, [] as Task[])
const timing = atom({ plugin: 'task-progress', key: 'timing' } as const, {
  startedAt: null,
  now: 0,
  lastMs: null,
} as Timing)

/** 使用者手動切換的收合狀態；null 表示依任務狀態自動決定 */
const collapseOverride = atom({ plugin: 'task-progress', key: 'collapseOverride' } as const, null as boolean | null)

const steps = atom({ plugin: 'task-progress', key: 'steps' } as const, [] as Step[])

const BAR_WIDTH = 20
/** 步驟列表只列最近幾步，其餘摺疊 */
const RECENT_STEPS = 5
/** 步驟點狀進度最多畫幾個點 */
const MAX_DOTS = 20

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function bar(done: number, total: number): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

/** 依狀態變化補上開始／結束時間；直接跳到 completed 的任務沒有開始時間 */
export function transition(task: Task, status: TaskStatus, now: number): Task {
  if (status === task.status) return task
  if (status === 'in_progress') return { ...task, status, startedAt: task.startedAt ?? now, endedAt: undefined }
  if (status === 'completed') return { ...task, status, endedAt: now }
  return { ...task, status, startedAt: undefined, endedAt: undefined }
}

/** 任務耗時：已完成取 endedAt，進行中取 now；無開始時間回 null */
export function taskElapsed(task: Task, now: number): number | null {
  if (task.startedAt === undefined) return null
  if (task.status === 'completed') return (task.endedAt ?? now) - task.startedAt
  if (task.status === 'in_progress') return now - task.startedAt
  return null
}

const DEFAULT_FOLD_THRESHOLD = 8
const DEFAULT_KEEP_DONE = 3

/** 超過 foldThreshold 個任務時，已完成的只留最近 keepDone 筆（依完成時間），其餘摺疊 */
export function visibleTasks(
  list: readonly Task[],
  foldThreshold: number = DEFAULT_FOLD_THRESHOLD,
  keepDone: number = DEFAULT_KEEP_DONE,
): { rows: Task[]; hiddenDone: number } {
  if (list.length <= foldThreshold) return { rows: [...list], hiddenDone: 0 }
  const done = list.filter(t => t.status === 'completed')
  const kept = new Set(
    [...done]
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, keepDone)
      .map(t => t.id),
  )
  return {
    rows: list.filter(t => t.status !== 'completed' || kept.has(t.id)),
    hiddenDone: done.length - kept.size,
  }
}

/** 任務名稱長度上限的預設值；實際值由 userConfig `nameMax` 決定 */
const DEFAULT_NAME_MAX = 40

/** 從 userConfig 取出整數選項；缺值、非數字或小於 min 時用預設 */
function intOption(options: PluginOptions, key: string, fallback: number, min: number): number {
  const v = options[key]
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback
}

/** 收合／展開按鈕圖示：▸ 目前收合（按下展開）、▾ 目前展開（按下收合） */
export const TOGGLE_ICON = { collapsed: '▸', expanded: '▾' } as const

/** 進行中項目（不分語言），例如「▶ Running tests」 */
export const inProgress = (name: string): string => `▶ ${name}`

/** 已完成數（不分語言），例如「✓3/5」 */
export const doneCount = (done: number, total: number): string => `✓${done}/${total}`

export type Lang = 'zh-TW' | 'en'

/** 畫面文字；依 userConfig `language` 選用 */
export type Messages = {
  running: (elapsed: string) => string
  lastTurn: (elapsed: string) => string
  latest: (name: string) => string
  moreDone: (n: number) => string
}

export const MESSAGES: Readonly<Record<Lang, Messages>> = {
  'zh-TW': {
    running: d => `執行中 ${d}`,
    lastTurn: d => `上一輪耗時 ${d}`,
    latest: name => `，最近：${name}`,
    moreDone: n => `…另有 ${n} 項已完成`,
  },
  en: {
    running: d => `Running ${d}`,
    lastTurn: d => `Last turn ${d}`,
    latest: name => `, latest: ${name}`,
    moreDone: n => `…${n} more completed`,
  },
}

export type Settings = { nameMax: number; foldThreshold: number; keepDone: number; language: Lang }

/** 解析 userConfig 的所有選項 */
export function settingsFrom(options: PluginOptions): Settings {
  return {
    nameMax: intOption(options, 'nameMax', DEFAULT_NAME_MAX, 1),
    foldThreshold: intOption(options, 'foldThreshold', DEFAULT_FOLD_THRESHOLD, 1),
    keepDone: intOption(options, 'keepDone', DEFAULT_KEEP_DONE, 0),
    language: options.language === 'en' ? 'en' : 'zh-TW',
  }
}

/** 超過 max 個字（以 code point 計）時截斷並加上「…」 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

/** 收合時的摘要：已完成數與最近完成的任務 */
export function collapsedSummary(
  list: readonly Task[],
  nameMax: number = DEFAULT_NAME_MAX,
  m: Messages = MESSAGES['zh-TW'],
): string {
  const done = list.filter(t => t.status === 'completed')
  const latest = done.reduce<Task | undefined>(
    (best, t) => (best === undefined || (t.endedAt ?? 0) >= (best.endedAt ?? 0) ? t : best),
    undefined,
  )
  const head = doneCount(done.length, list.length)
  return latest === undefined ? head : `${head}${m.latest(truncate(latest.subject, nameMax))}`
}

/** 一律預設收合，只有手動按「展開」才展開（override === false） */
export function isCollapsedFor(override: boolean | null): boolean {
  return override ?? true
}

/** 更新任務清單 */
async function updateTasks($: StateDollar, change: (list: Task[]) => Task[]): Promise<void> {
  await update($, tasks, change)
}

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** 工具呼叫的簡短描述，例如「Read register.tsx」「Bash 執行測試」 */
export function stepLabel(tool: string, input: Readonly<Record<string, unknown>>): string {
  const str = (key: string): string | undefined => {
    const v = input[key]
    return typeof v === 'string' && v.trim() !== '' ? v.trim().split('\n')[0] : undefined
  }
  const path = str('file_path') ?? str('notebook_path')
  const detail =
    tool === 'Bash'
      ? (str('description') ?? str('command'))
      : path !== undefined
        ? basename(path)
        : (str('description') ?? str('pattern') ?? str('url') ?? str('query') ?? str('skill'))
  return detail === undefined ? tool : `${tool} ${detail}`
}

/** 點狀進度：完成（含失敗）為 ●、執行中為 ○，最多 MAX_DOTS 個 */
export function dots(list: readonly Step[]): string {
  const finished = list.filter(s => s.status !== 'running').length
  const running = list.length - finished
  const shownRunning = Math.min(running, MAX_DOTS)
  return '●'.repeat(Math.min(finished, MAX_DOTS - shownRunning)) + '○'.repeat(shownRunning)
}

/** 步驟計數（不分語言）：已結束／總數，例如「4/5」 */
export function stepCount(list: readonly Step[]): string {
  return `${list.filter(s => s.status !== 'running').length}/${list.length}`
}

/** 失敗步驟數（不分語言），例如「✗1」；沒有失敗時為空字串 */
export function stepFailures(list: readonly Step[]): string {
  const failed = list.filter(s => s.status === 'failed').length
  return failed > 0 ? `✗${failed}` : ''
}

export const register: Register = (on, options) => {
  const { nameMax, foldThreshold, keepDone, language } = settingsFrom(options)
  const m = MESSAGES[language]

  on('session.start', async ($, e, next) => {
    // 每秒刷新一次計時（僅在執行中才寫入，避免閒置時重繪）
    $.clock.every(1000, async () => {
      const t = await read($, timing)
      if (t.startedAt === null) return
      const now = await $.clock.now()
      await update($, timing, prev => ({ ...prev, now }))
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 送出提示（含斜線指令）即取消手動展開，回到預設收合
    await update($, collapseOverride, () => null)
    // 新一輪開始時，若上一批任務皆已完成則清掉
    await updateTasks($, list =>
      list.length > 0 && list.every(t => t.status === 'completed') ? [] : list,
    )
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, timing, prev => (prev.startedAt === null ? { ...prev, startedAt: now, now } : prev))
      // 新一輪取消手動切換，回到預設收合
      await update($, collapseOverride, () => null)
      await update($, steps, () => [])
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, timing, prev => ({
        startedAt: null,
        now,
        lastMs: prev.startedAt === null ? e.durationMs : now - prev.startedAt,
      }))
      // 一輪結束即收合，即使仍有任務標為進行中
      await update($, collapseOverride, () => true)
    }
    return next(e)
  })

  // 主對話的每個工具呼叫記為一步（子代理內部的呼叫不計）
  let stepSeq = 0
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const id = `step-${++stepSeq}`
    const label = stepLabel(e.tool, e as unknown as Readonly<Record<string, unknown>>)
    const startedAt = await $.clock.now()
    const step: Step = { id, label, status: 'running', startedAt }
    await update($, steps, list => [...list, step])
    let failed = true
    try {
      const ran = await next(e)
      failed = ran.deny !== undefined || ran.isError === true
      return ran
    } finally {
      const endedAt = await $.clock.now()
      const status: StepStatus = failed ? 'failed' : 'done'
      await update($, steps, list => list.map(s => (s.id === id ? { ...s, status, endedAt } : s)))
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const now = await $.clock.now()
      // TodoWrite 每次送整份清單，以內容比對沿用先前的計時
      await updateTasks($, prev =>
        e.todos.map((t, i) => {
          const base: Task = prev.find(p => p.subject === t.content) ?? {
            id: `todo-${i}`,
            subject: t.content,
            status: 'pending',
          }
          return transition({ ...base, id: `todo-${i}`, activeForm: t.activeForm }, t.status, now)
        }),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const task: Task = { id: ran.result.task.id, subject: e.subject, status: 'pending', activeForm: e.activeForm }
      await updateTasks($, list => [...list.filter(t => t.id !== task.id), task])
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result.success) {
      const { status } = e
      const now = await $.clock.now()
      await updateTasks($, list =>
        status === 'deleted'
          ? list.filter(t => t.id !== e.taskId)
          : list.map(t =>
              t.id === e.taskId
                ? transition(
                    { ...t, subject: e.subject ?? t.subject, activeForm: e.activeForm ?? t.activeForm },
                    status ?? t.status,
                    now,
                  )
                : t,
            ),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // 一律先取得下層（其他 mod 如 next-steps、引擎預設）的內容，與自己的區塊疊在一起
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const list = await read($, tasks)
    const t = await read($, timing)
    const stepList = await read($, steps)
    const running = t.startedAt !== null
    if (list.length === 0 && stepList.length === 0 && !running && t.lastMs === null) return below

    const override = await read($, collapseOverride)
    const { Box, Button, Text } = $.ui.resolve(e)

    const elapsedLine = running
      ? m.running(formatDuration(t.now - (t.startedAt ?? t.now)))
      : t.lastMs !== null
        ? m.lastTurn(formatDuration(t.lastMs))
        : null

    // 沒有任務清單：改以本輪工具呼叫當作步驟顯示
    if (list.length === 0) {
      const stepsCollapsed = isCollapsedFor(override)
      // 同時有多個執行中（平行呼叫）時取最後開始的那一步
      const currentStep = [...stepList].reverse().find(step => step.status === 'running')
      const hiddenSteps = Math.max(0, stepList.length - RECENT_STEPS)
      return (
        <Box flexDirection="column">
          {stepList.length === 0 && elapsedLine !== null && <Text dimColor>{elapsedLine}</Text>}
          {stepList.length > 0 && (
            <Box>
              <Button
                key="toggle-tasks"
                plain
                label={stepsCollapsed ? TOGGLE_ICON.collapsed : TOGGLE_ICON.expanded}
                onPress={() => update($, collapseOverride, () => !stepsCollapsed)}
              />
              <Text> </Text>
              <Text color="green">{dots(stepList)}</Text>
              <Text>{` ${stepCount(stepList)}`}</Text>
              {stepFailures(stepList) !== '' && <Text color="red">{` ${stepFailures(stepList)}`}</Text>}
              {stepsCollapsed && currentStep && <Text dimColor>{`  ${inProgress(currentStep.label)}`}</Text>}
              {elapsedLine !== null && <Text dimColor>{`  ${elapsedLine}`}</Text>}
            </Box>
          )}
          {!stepsCollapsed && hiddenSteps > 0 && <Text dimColor>{`  … +${hiddenSteps}`}</Text>}
          {!stepsCollapsed &&
            stepList.slice(hiddenSteps).map(step => {
              const name = truncate(step.label, nameMax)
              const time = formatDuration((step.endedAt ?? Math.max(t.now, step.startedAt)) - step.startedAt)
              if (step.status === 'done') return <Text key={step.id} color="green">{`  ✓ ${name}  ${time}`}</Text>
              if (step.status === 'failed') return <Text key={step.id} color="red">{`  ✗ ${name}  ${time}`}</Text>
              return <Text key={step.id} color="yellow">{`  ▶ ${name}  ${time}`}</Text>
            })}
          {below}
        </Box>
      )
    }

    const collapsed = isCollapsedFor(override)
    const done = list.filter(x => x.status === 'completed').length
    const current = list.find(x => x.status === 'in_progress')
    const pct = list.length === 0 ? 0 : Math.round((done / list.length) * 100)

    const { rows, hiddenDone } = visibleTasks(list, foldThreshold, keepDone)

    return (
      <Box flexDirection="column">
        {list.length > 0 && (
          <Box>
            <Button
              key="toggle-tasks"
              plain
              label={collapsed ? TOGGLE_ICON.collapsed : TOGGLE_ICON.expanded}
              onPress={() => update($, collapseOverride, () => !collapsed)}
            />
            <Text> </Text>
            <Text color="green">{bar(done, list.length)}</Text>
            <Text>{` ${done}/${list.length} (${pct}%)`}</Text>
            {current && <Text dimColor>{`  ${inProgress(current.activeForm ?? current.subject)}`}</Text>}
            {elapsedLine !== null && <Text dimColor>{`  ${elapsedLine}`}</Text>}
            {collapsed && <Text dimColor>{`  ${collapsedSummary(list, nameMax, m)}`}</Text>}
          </Box>
        )}
        {!collapsed && hiddenDone > 0 && <Text dimColor>{`  ${m.moreDone(hiddenDone)}`}</Text>}
        {!collapsed && rows.map(task => {
          const name = truncate(task.subject, nameMax)
          const ms = taskElapsed(task, t.now)
          const time = ms === null ? '' : `  ${formatDuration(ms)}`
          if (task.status === 'completed') {
            return <Text key={task.id} color="green">{`  ✓ ${name}${time}`}</Text>
          }
          if (task.status === 'in_progress') {
            return <Text key={task.id} color="yellow">{`  ▶ ${name}${time}`}</Text>
          }
          return <Text key={task.id} dimColor>{`  ○ ${name}`}</Text>
        })}
        {below}
      </Box>
    )
  })
}
