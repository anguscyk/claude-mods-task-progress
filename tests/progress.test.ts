import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bar, collapsedSummary, formatDuration, settingsFrom, truncate, isCollapsedFor, taskElapsed, transition, visibleTasks } from '../hooks/register'
import type { Task } from '../types'

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

test('有任務進行中時自動展開', () => {
  const pending: Task = { id: '1', subject: 'A', status: 'pending' }
  const running: Task = { ...pending, status: 'in_progress' }
  expect(isCollapsedFor([pending], null)).toBe(true)
  expect(isCollapsedFor([running], null)).toBe(false)
  expect(isCollapsedFor([running], true)).toBe(true)
  expect(isCollapsedFor([pending], false)).toBe(false)
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
  expect(collapsedSummary([{ id: '1', subject: long, status: 'completed', endedAt: 1 }])).toBe(
    '已完成 1/1，最近：一二三四五六七八九十一二三四五六七八九十…',
  )
  expect(truncate('x'.repeat(20), 20)).toBe('x'.repeat(20))
  expect(truncate('x'.repeat(21), 20)).toBe(`${'x'.repeat(20)}…`)
})

test('TaskCreate / TaskUpdate 追蹤任務狀態', async ($, on) => {
  const clock = mock.clock(on)
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

  const drawn = await band($)
  expect(drawn).toContain('1/2 (50%)')
  expect(drawn).toContain('進行中：B')
  expect(drawn).toContain('✓ A  1m02s')
  expect(drawn).toContain('▶ B')
  expect(drawn).not.toContain('耗時')

  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  expect(await band($)).not.toContain('▶ B')

  // 進行中的任務結束：自動行為重新接手（維持收合）
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
  expect(await band($)).toContain('展開')
  expect(await band($)).toContain('1/1')
})

test('TodoWrite 取代整份清單', async ($, on) => {
  mock.clock(on)
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

test('每輪結束自動收合，下一輪有任務進行中再展開', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'a' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  expect(await band($)).toContain('▶ A')

  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  const afterTurn = await band($)
  expect(afterTurn).toContain('展開')
  expect(afterTurn).not.toContain('▶ A')

  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await band($)).toContain('▶ A')
})

test('展開列表的任務名稱超過 20 字時截斷', async ($, on) => {
  mock.clock(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  const long = 'abcdefghijklmnopqrstuvwxyz'
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: long, status: 'in_progress', activeForm: 'Working on 0123456789ABCDEF' },
      { content: 'short', status: 'pending', activeForm: 'S' },
    ],
  })
  const drawn = await band($)
  expect(drawn).toContain('▶ abcdefghijklmnopqrst…')
  expect(drawn).not.toContain('uvwxyz')
  expect(drawn).toContain('○ short')
  expect(drawn).toContain('進行中：Working on 012345678…')
  expect(drawn).not.toContain('ABCDEF')
})

test('userConfig 不合法時回預設值', () => {
  expect(settingsFrom({})).toEqual({ nameMax: 20, foldThreshold: 8, keepDone: 3 })
  expect(settingsFrom({ nameMax: 0, foldThreshold: 0, keepDone: -1 })).toEqual({ nameMax: 20, foldThreshold: 8, keepDone: 3 })
  expect(settingsFrom({ nameMax: 'x', foldThreshold: '5', keepDone: true })).toEqual({ nameMax: 20, foldThreshold: 8, keepDone: 3 })
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
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'A' },
      { content: 'b', status: 'completed', activeForm: 'B' },
      { content: 'c', status: 'in_progress', activeForm: 'C' },
    ],
  })
  const drawn = await band($)
  expect(drawn).toContain('…另有 1 項已完成')
  expect(drawn).toContain('▶ c')
})

test('userConfig nameMax 調整截斷長度', { options: { nameMax: 5 } }, async ($, on) => {
  mock.clock(on)
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'abcdefgh', status: 'in_progress', activeForm: 'Working hard' }],
  })
  const drawn = await band($)
  expect(drawn).toContain('▶ abcde…')
  expect(drawn).toContain('進行中：Worki…')
})
