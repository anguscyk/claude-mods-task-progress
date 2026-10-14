import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { bar, collapsedSummary, dots, stepLabel, stepSummary, formatDuration, settingsFrom, truncate, isCollapsedFor, taskElapsed, transition, visibleTasks } from '../hooks/register'
import type { Task } from '../types'

/** 代表下層 plugin（如 next-steps）畫的內容 */
function answerBelow(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['BELOW'] }) as never)
}

async function band($: Engine): Promise<string> {
  const tree = await $.ui.render({
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never,
  })
  return JSON.stringify(tree)
}

test('格式化時間與進度條', () => {
  expect(formatDuration(5_000)).toBe('5s')
  expect(formatDuration(83_000)).toBe('1m23s')
  expect(formatDuration(3_723_000)).toBe('1h02m03s')
  expect(bar(0, 4)).toBe('░'.repeat(20))
  expect(bar(2, 4)).toBe('█'.repeat(10) + '░'.repeat(10))
  expect(bar(4, 4)).toBe('█'.repeat(20))
})

test('任務狀態轉換記錄耗時', () => {
  const t0: Task = { id: '1', subject: 'A', status: 'pending' }
  const running = transition(t0, 'in_progress', 1_000)
  expect(taskElapsed(running, 6_000)).toBe(5_000)
  const done = transition(running, 'completed', 63_000)
  expect(taskElapsed(done, 999_999)).toBe(62_000)
  expect(taskElapsed(transition(t0, 'completed', 5_000), 9_000)).toBe(null)
  expect(transition(running, 'in_progress', 9_000).startedAt).toBe(1_000)
})

test('超過 8 個任務時摺疊較早完成的', () => {
  const make = (i: number, status: Task['status'], endedAt?: number): Task => ({
    id: String(i),
    subject: `T${i}`,
    status,
    endedAt,
  })
  const eight = Array.from({ length: 8 }, (_, i) => make(i, 'completed', i))
  expect(visibleTasks(eight).hiddenDone).toBe(0)

  const nine = [...Array.from({ length: 6 }, (_, i) => make(i, 'completed', i * 10)), make(6, 'in_progress'), make(7, 'pending'), make(8, 'pending')]
  const { rows, hiddenDone } = visibleTasks(nine)
  expect(hiddenDone).toBe(3)
  expect(rows.map(t => t.subject)).toEqual(['T3', 'T4', 'T5', 'T6', 'T7', 'T8'])
})

test('預設收合，只有手動展開才展開', () => {
  expect(isCollapsedFor(null)).toBe(true)
  expect(isCollapsedFor(true)).toBe(true)
  expect(isCollapsedFor(false)).toBe(false)
})

test('收合摘要顯示完成數與最近完成的任務', () => {
  const list: Task[] = [
    { id: '1', subject: '建立 DTO', status: 'completed', endedAt: 200 },
    { id: '2', subject: '撰寫 Service', status: 'completed', endedAt: 100 },
    { id: '3', subject: '測試', status: 'pending' },
  ]
  expect(collapsedSummary(list)).toBe('已完成 2/3，最近：建立 DTO')
  expect(collapsedSummary([{ id: '1', subject: 'A', status: 'pending' }])).toBe('已完成 0/1')

  const long = '一二三四五六七八九十一二三四五六七八九十多出來的字'
  expect(collapsedSummary([{ id: '1', subject: long, status: 'completed', endedAt: 1 }], 20)).toBe(
    '已完成 1/1，最近：一二三四五六七八九十一二三四五六七八九十…',
  )
  expect(truncate('x'.repeat(20), 20)).toBe('x'.repeat(20))
  expect(truncate('x'.repeat(21), 20)).toBe(`${'x'.repeat(20)}…`)
})

test('TaskCreate / TaskUpdate 追蹤任務狀態', async ($, on) => {
  const clock = mock.clock(on)
  answerBelow(on)
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(++next), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'a' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'B', description: 'b' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  await clock.advance(62_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })

  // 有任務進行中也維持收合
  const before = await band($)
  expect(before).toContain('展開')
  expect(before).not.toContain('▶ B')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const drawn = await band($)
  expect(drawn).toContain('1/2 (50%)')
  expect(drawn).toContain('進行中：B')
  expect(drawn).toContain('✓ A  1m02s')
  expect(drawn).toContain('▶ B')
  expect(drawn).not.toContain('耗時')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  expect(await band($)).not.toContain('▶ B')

  // 任務結束不改變收合狀態
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
  expect(await band($)).toContain('展開')
  expect(await band($)).toContain('1/1')
})

test('TodoWrite 取代整份清單', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'x', status: 'completed', activeForm: 'X-ing' },
      { content: 'y', status: 'pending', activeForm: 'Y-ing' },
    ],
  })
  expect(await band($)).not.toContain('✓ x')
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const drawn = await band($)
  expect(drawn).toContain('1/2 (50%)')
  expect(drawn).not.toContain('Y-ing')
  expect(drawn).toContain('✓ x')
  expect(drawn).toContain('○ y')
})

test('按鈕收合與展開任務列表', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'x', status: 'completed', activeForm: 'X-ing' },
      { content: 'y', status: 'pending', activeForm: 'Y-ing' },
    ],
  })

  // 沒有進行中的任務：預設收合
  const collapsed = await band($)
  expect(collapsed).toContain('展開')
  expect(collapsed).toContain('已完成 1/2，最近：x')
  expect(collapsed).toContain('1/2 (50%)')
  expect(collapsed).not.toContain('○ y')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const expanded = await band($)
  expect(expanded).toContain('收合')
  expect(expanded).toContain('○ y')
  expect(expanded).not.toContain('最近：')
})

test('執行中也維持收合；手動展開後於每輪結束收回', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'a' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  expect(await band($)).not.toContain('▶ A')
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  expect(await band($)).toContain('▶ A')

  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const afterTurn = await band($)
  expect(afterTurn.indexOf('上一輪耗時')).toBeGreaterThan(afterTurn.indexOf('toggle-tasks'))
  expect(afterTurn).toContain('展開')
  expect(afterTurn).not.toContain('▶ A')

  // 下一輪仍有任務進行中，也不會自動展開
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await band($)).not.toContain('▶ A')
})

test('展開列表的任務名稱超過 nameMax 時截斷', { options: { nameMax: 20 } }, async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  const long = 'abcdefghijklmnopqrstuvwxyz'
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: long, status: 'in_progress', activeForm: 'Working on 0123456789ABCDEF' },
      { content: 'short', status: 'pending', activeForm: 'S' },
    ],
  })
  await band($)
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const drawn = await band($)
  expect(drawn).toContain('▶ abcdefghijklmnopqrst…')
  expect(drawn).not.toContain('uvwxyz')
  expect(drawn).toContain('○ short')
  // 進度條那行的「進行中」不截斷
  expect(drawn).toContain('進行中：Working on 0123456789ABCDEF')
})

test('userConfig 不合法時回預設值', () => {
  expect(settingsFrom({})).toEqual({ nameMax: 40, foldThreshold: 8, keepDone: 3 })
  expect(settingsFrom({ nameMax: 0, foldThreshold: 0, keepDone: -1 })).toEqual({ nameMax: 40, foldThreshold: 8, keepDone: 3 })
  expect(settingsFrom({ nameMax: 'x', foldThreshold: '5', keepDone: true })).toEqual({ nameMax: 40, foldThreshold: 8, keepDone: 3 })
  expect(settingsFrom({ nameMax: 8.7, foldThreshold: 4.2, keepDone: 0 })).toEqual({ nameMax: 8, foldThreshold: 4, keepDone: 0 })
})

test('自訂摺疊門檻與保留筆數', () => {
  const list: Task[] = [
    ...Array.from({ length: 3 }, (_, i): Task => ({ id: String(i), subject: `T${i}`, status: 'completed', endedAt: i })),
    { id: '9', subject: 'P', status: 'pending' },
  ]
  expect(visibleTasks(list, 3, 1)).toEqual({ rows: [list[2]!, list[3]!], hiddenDone: 2 })
  expect(visibleTasks(list, 3, 0).hiddenDone).toBe(3)
  expect(visibleTasks(list, 4, 0).hiddenDone).toBe(0)
})

test('userConfig 摺疊設定套用到畫面', { options: { foldThreshold: 2, keepDone: 1 } }, async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'A' },
      { content: 'b', status: 'completed', activeForm: 'B' },
      { content: 'c', status: 'in_progress', activeForm: 'C' },
    ],
  })
  await band($)
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const drawn = await band($)
  expect(drawn).toContain('…另有 1 項已完成')
  expect(drawn).toContain('▶ c')
})

test('userConfig nameMax 調整截斷長度', { options: { nameMax: 5 } }, async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'abcdefgh', status: 'in_progress', activeForm: 'Working hard' }],
  })
  await band($)
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const drawn = await band($)
  expect(drawn).toContain('▶ abcde…')
  expect(drawn).toContain('進行中：Working hard')
})

test('保留下層 plugin 的內容（例如 next-steps）', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  // 尚無資料時只回下層
  const idle = await band($)
  expect(idle).toContain('BELOW')
  expect(idle).not.toContain('task-progress')
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'in_progress', activeForm: 'A' }] })
  const drawn = await band($)
  expect(drawn).toContain('進行中：A')
  expect(drawn).toContain('BELOW')
})

test('步驟描述、點狀進度與摘要', () => {
  expect(stepLabel('Read', { file_path: '/a/b/register.tsx' })).toBe('Read register.tsx')
  expect(stepLabel('Bash', { command: 'npm test', description: '執行測試' })).toBe('Bash 執行測試')
  expect(stepLabel('Bash', { command: 'ls -la\nmore' })).toBe('Bash ls -la')
  expect(stepLabel('Grep', { pattern: 'foo' })).toBe('Grep foo')
  expect(stepLabel('TaskList', {})).toBe('TaskList')

  const s = (status: 'running' | 'done' | 'failed') => ({ id: status, label: status, status, startedAt: 0 })
  expect(dots([s('done'), s('failed'), s('running')])).toBe('●●○')
  expect(dots(Array.from({ length: 30 }, () => s('done')))).toBe('●'.repeat(20))
  expect(stepSummary([s('done'), s('failed')])).toBe('共 2 步，失敗 1')
  expect(stepSummary([s('done')])).toBe('共 1 步')
})

test('沒有任務清單時，以本輪工具呼叫當作步驟顯示', async ($, on) => {
  const clock = mock.clock(on)
  answerBelow(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Read' }, async () => {
    await clock.advance(2_000)
    return { result: { type: 'text', file: { filePath: '/x/a.ts', content: '', numLines: 0, startLine: 1, totalLines: 0 } } } as never
  })
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'nope' }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/x/a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'false', description: '跑測試' })

  // 執行中也維持收合
  const running = await band($)
  expect(running).toContain(' 2 步')
  expect(running).not.toContain('✓ Read')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const drawn = await band($)
  expect(drawn).toContain('●●')
  // 執行中也在同一行，且在步驟列之前
  expect(drawn.indexOf('執行中')).toBeGreaterThan(drawn.indexOf('toggle-tasks'))
  expect(drawn.indexOf('執行中')).toBeLessThan(drawn.indexOf('✓ Read'))
  expect(drawn).toContain(' 2 步')
  expect(drawn).toContain('✓ Read a.ts  2s')
  expect(drawn).toContain('✗ Bash 跑測試')
  expect(drawn).toContain('BELOW')

  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = await band($)
  expect(after).toContain('共 2 步，失敗 1')
  // 耗時與進度列同一行：在按鈕之後
  expect(after).toContain('  上一輪耗時 2s')
  expect(after.indexOf('上一輪耗時')).toBeGreaterThan(after.indexOf('toggle-tasks'))
  expect(after).not.toContain('✓ Read')

  // 新一輪重新計算
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await band($)).not.toContain('步')
})

test('沒有步驟也沒有任務時，耗時單獨一行', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const drawn = await band($)
  expect(drawn).toContain('上一輪耗時')
  expect(drawn).not.toContain('toggle-tasks')
})

test('預設名稱上限為 40 字', () => {
  const long = 'x'.repeat(45)
  expect(collapsedSummary([{ id: '1', subject: long, status: 'completed', endedAt: 1 }])).toBe(
    `已完成 1/1，最近：${'x'.repeat(40)}…`,
  )
})

test('手動展開後，下一次送出提示即取消', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => e as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }) as never)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/x/a.ts' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await band($)).toContain('展開')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  expect(await band($)).toContain('✓ Read a.ts')

  await $.prompt.submit({ text: '/reload-plugins' } as never)
  const after = await band($)
  expect(after).toContain('展開')
  expect(after).not.toContain('✓ Read a.ts')
})

test('步驟列表收合時，進度列顯示執行中的步驟', async ($, on) => {
  mock.clock(on)
  answerBelow(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const inFlight = new Promise<void>(resolve => { entered = resolve })
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }) as never)
  on('tool.call', { tool: 'Bash' }, () => {
    entered()
    return new Promise(resolve => { release = () => resolve({ result: {} } as never) })
  })

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/x/a.ts' })
  const pending = $.tool.call({ tool: 'Bash', command: 'npm test', description: '執行整個專案的單元測試與整合測試並輸出報告' })
  await inFlight

  const collapsed = await band($)
  expect(collapsed).toContain('展開')
  // 完整名稱，不截斷
  expect(collapsed).toContain('進行中：Bash 執行整個專案的單元測試與整合測試並輸出報告')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  const expanded = await band($)
  expect(expanded).not.toContain('進行中：')
  expect(expanded).toContain('▶ Bash')

  release()
  await pending
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  expect(await band($)).not.toContain('進行中：')
})
