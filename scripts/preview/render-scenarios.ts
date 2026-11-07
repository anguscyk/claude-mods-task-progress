// 示意圖情境：由 scripts/gen-preview.sh 複製成暫存 plugin 的 tests/render.test.ts 執行，
// 以 @@<語系>:<名稱>@@<JSON> 輸出 task-progress 在各情境實際繪出的 AbovePrompt 樹。
// 每個情境依 NAMES 的語系各跑一次（zh → docs/preview.svg、en → docs/preview.en.svg）；
// 畫面本身不分語言，差別只在模擬的任務與步驟名稱。

import { mock, test } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

import { contentAfterEdit } from '../hooks/register'

type Names = {
  /** 4 個任務；第 3 個為進行中 */
  tasks: readonly [string, string, string, string]
  tasksActive: string
  /** 10 個任務；前 6 個完成、第 7 個進行中 */
  manyTasks: readonly string[]
  manyActive: string
  stepTest: string
  stepTypeCheck: string
  /** markdown issue 檔的 5 個核取項目 */
  checklist: readonly [string, string, string, string, string]
}

const NAMES: Readonly<Record<'zh' | 'en', Names>> = {
  zh: {
    tasks: ['建立 DTO', '撰寫 Service', '執行測試', '更新文件'],
    tasksActive: 'Running tests',
    manyTasks: [
      '建立 Entity', '建立 Repository', '建立 DTO', '撰寫 Service', '撰寫 Controller',
      '補上驗證', '撰寫單元測試', '執行整合測試', '更新 API 文件', '更新 README',
    ],
    manyActive: 'Writing unit tests',
    stepTest: '執行測試',
    stepTypeCheck: '型別檢查',
    checklist: ['打 tag season-1', '建置封存版', '確認 service worker 不攔截', '加上封存版測試', '更新 CLAUDE.md'],
  },
  en: {
    tasks: ['Create DTO', 'Write service', 'Run tests', 'Update docs'],
    tasksActive: 'Running tests',
    manyTasks: [
      'Create entity', 'Create repository', 'Create DTO', 'Write service', 'Write controller',
      'Add validation', 'Write unit tests', 'Run integration tests', 'Update API docs', 'Update README',
    ],
    manyActive: 'Writing unit tests',
    stepTest: 'Run tests',
    stepTypeCheck: 'Type check',
    checklist: ['Tag season-1', 'Build the archive', 'Check the service worker skips it', 'Add archive tests', 'Update CLAUDE.md'],
  },
}

async function dump($: Engine, name: string): Promise<void> {
  const tree = await $.ui.render({
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: true, maxRows: 20 } as never,
  })
  console.log(`@@${name}@@${JSON.stringify(tree)}`)
}

/** 各情境共用：下層內容、turn/session 事件與 Task 工具的模擬回應 */
function baseHooks(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: [''] }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let n = 0
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(++n), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
}

async function startTurn($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
}

for (const locale of ['zh', 'en'] as const) {
  const names = NAMES[locale]

  test(`tasks ${locale}`, async ($, on) => {
    const clock = mock.clock(on)
    baseHooks(on)
    await startTurn($)
    for (const s of names.tasks) {
      await $.tool.call({ tool: 'TaskCreate', subject: s, description: s, activeForm: s === names.tasks[2] ? names.tasksActive : s })
    }
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await clock.advance(62_000)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
    await clock.advance(195_000)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' })
    await clock.advance(23_000)
    await dump($, `${locale}:tasks-collapsed`)
    await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
    await dump($, `${locale}:tasks-expanded`)
  })

  test(`tasks-many ${locale}`, async ($, on) => {
    const clock = mock.clock(on)
    baseHooks(on)
    await startTurn($)
    for (const s of names.manyTasks) {
      await $.tool.call({ tool: 'TaskCreate', subject: s, description: s, activeForm: s === names.manyTasks[6] ? names.manyActive : s })
    }
    // 前 6 項依序完成（超過 8 個任務時，只留最近 3 筆已完成，其餘摺疊）
    const durations = [41_000, 37_000, 52_000, 128_000, 96_000, 33_000]
    for (const [i, ms] of durations.entries()) {
      await $.tool.call({ tool: 'TaskUpdate', taskId: String(i + 1), status: 'in_progress' })
      await clock.advance(ms)
      await $.tool.call({ tool: 'TaskUpdate', taskId: String(i + 1), status: 'completed' })
    }
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })
    await clock.advance(18_000)
    await dump($, `${locale}:tasks-many-collapsed`)
    await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
    await dump($, `${locale}:tasks-many-expanded`)
  })

  test(`checklist ${locale}`, async ($, on) => {
    const clock = mock.clock(on)
    baseHooks(on)
    // 虛擬的 issue 檔：Edit 依編輯前內容與替換字串回傳結果
    const path = '/repo/.scratch/issues/01-archive.md'
    let file = ['# 01', '', ...names.checklist.map(item => `- [ ] ${item}`)].join('\n')
    on('tool.call', { tool: 'Edit' }, (_$, e) => {
      const result = { filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: file, structuredPatch: [], userModified: false, replaceAll: false }
      file = contentAfterEdit(result) ?? file
      return { result } as never
    })
    const tick = (item: string): Promise<unknown> =>
      $.tool.call({ tool: 'Edit', file_path: path, old_string: `- [ ] ${item}`, new_string: `- [x] ${item}` })

    await startTurn($)
    // 第一次勾選時才開始追蹤，該項沒有耗時；之後每項從成為進行中算到勾起
    await clock.advance(45_000)
    await tick(names.checklist[0])
    await clock.advance(130_000)
    await tick(names.checklist[1])
    await clock.advance(20_000)
    await dump($, `${locale}:checklist-collapsed`)
    await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
    await dump($, `${locale}:checklist-expanded`)
  })

  test(`steps ${locale}`, async ($, on) => {
    const clock = mock.clock(on)
    baseHooks(on)
    on('tool.call', { tool: 'Read' }, async () => { await clock.advance(400); return { result: {} } as never })
    on('tool.call', { tool: 'Edit' }, async () => { await clock.advance(1_200); return { result: {} } as never })
    let fail = false
    on('tool.call', { tool: 'Bash' }, async () => {
      await clock.advance(fail ? 8_000 : 3_000)
      return fail
        ? ({ isError: true, result: undefined, text: "Exit code 2\nerror TS2322: Type 'string' is not assignable to type 'number'." } as never)
        : ({ result: {} } as never)
    })
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const inFlight = new Promise<void>(r => { entered = r })
    on('tool.call', { tool: 'Grep' }, () => { entered(); return new Promise(r => { release = () => r({ result: {} } as never) }) })

    await startTurn($)
    await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/register.tsx' })
    await $.tool.call({ tool: 'Bash', command: 'claude plugin test .', description: names.stepTest })
    fail = true
    await $.tool.call({ tool: 'Bash', command: 'tsc -p .', description: names.stepTypeCheck })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/register.tsx', old_string: 'a', new_string: 'b' })
    const pending = $.tool.call({ tool: 'Grep', pattern: 'collapseOverride' })
    await inFlight
    await clock.advance(30_000)
    await dump($, `${locale}:steps-collapsed-running`)
    await $.ui.press({ plugin: 'task-progress', key: 'toggle-tasks' })
    await dump($, `${locale}:steps-expanded`)
    release()
    await pending
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
    await dump($, `${locale}:steps-after-turn`)
  })
}
