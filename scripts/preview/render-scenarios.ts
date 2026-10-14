// 示意圖情境：由 scripts/gen-preview.sh 複製成暫存 plugin 的 tests/render.test.ts 執行，
// 以 @@<名稱>@@<JSON> 輸出 task-progress 在各情境實際繪出的 AbovePrompt 樹。

import { mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

async function dump($: Engine, name: string): Promise<void> {
  const tree = await $.ui.render({
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: true, maxRows: 20 } as never,
  })
  console.log(`@@${name}@@${JSON.stringify(tree)}`)
}

test('tasks', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: [''] }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(++n), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (const s of ['建立 DTO', '撰寫 Service', '執行測試', '更新文件']) await $.tool.call({ tool: 'TaskCreate', subject: s, description: s, activeForm: s === '執行測試' ? 'Running tests' : s })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  await clock.advance(62_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
  await clock.advance(195_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' })
  await clock.advance(23_000)
  await dump($, 'tasks-collapsed')
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  await dump($, 'tasks-expanded')
})

test('steps', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: [''] }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Read' }, async () => { await clock.advance(400); return { result: {} } as never })
  on('tool.call', { tool: 'Edit' }, async () => { await clock.advance(1_200); return { result: {} } as never })
  let fail = false
  on('tool.call', { tool: 'Bash' }, async () => { await clock.advance(fail ? 8_000 : 3_000); return fail ? { deny: 'x' } : ({ result: {} } as never) })
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const inFlight = new Promise<void>(r => { entered = r })
  on('tool.call', { tool: 'Grep' }, () => { entered(); return new Promise(r => { release = () => r({ result: {} } as never) }) })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/register.tsx' })
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test .', description: '執行測試' })
  fail = true
  await $.tool.call({ tool: 'Bash', command: 'tsc -p .', description: '型別檢查' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/register.tsx', old_string: 'a', new_string: 'b' })
  const pending = $.tool.call({ tool: 'Grep', pattern: 'collapseOverride' })
  await inFlight
  await clock.advance(30_000)
  await dump($, 'steps-collapsed-running')
  await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
  await dump($, 'steps-expanded')
  release()
  await pending
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
  await dump($, 'steps-after-turn')
})
