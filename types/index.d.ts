export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = {
  id: string
  subject: string
  status: TaskStatus
  activeForm?: string
  /** 進入 in_progress 的時間（epoch ms） */
  startedAt?: number
  /** 進入 completed 的時間（epoch ms） */
  endedAt?: number
}
export type StepStatus = 'running' | 'done' | 'failed'
/** 沒有任務清單時，以本輪每個工具呼叫當作一步 */
export type Step = { id: string; label: string; status: StepStatus; startedAt: number; endedAt?: number }
export type Timing = { startedAt: number | null; now: number; lastMs: number | null }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Task[]; timing: Timing; collapseOverride: boolean | null; steps: Step[] }
  }
}
