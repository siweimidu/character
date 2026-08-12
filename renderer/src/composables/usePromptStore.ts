import { ref, watch, type Ref } from 'vue'

/**
 * 常用提示词（Prompt Snippet）存储。
 *
 * 工作台智能体与章节创作智能体共用同一套"提示词库"，避免各自维护一份、
 * 重复造轮子。数据保存在 localStorage（按项目隔离），支持：
 *  - 新增：用户把常用的提示词存进去
 *  - 删除：移除不再使用的提示词
 *  - 选用：一键回填到输入框
 */

export interface SavedPrompt {
  id: string
  /** 提示词标题/名称，展示在快捷入口上。 */
  label: string
  /** 提示词正文，选中后回填到输入框。 */
  prompt: string
  createdAt: string
}

const STORAGE_PREFIX = 'arc-saved-prompts:'

function readStored(projectId: string): SavedPrompt[] {
  if (!projectId) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedPrompt[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStored(projectId: string, list: SavedPrompt[]): void {
  if (!projectId) return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(list))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级
  }
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建提示词存储实例。
 * @param projectIdRef 当前项目 ID 的响应式引用；切换项目时自动切换存储空间。
 */
export function usePromptStore(projectIdRef: Ref<string | null | undefined>): {
  prompts: Ref<SavedPrompt[]>
  savePrompt: (label: string, prompt: string) => boolean
  deletePrompt: (id: string) => void
  addPrompt: (label: string, prompt: string) => SavedPrompt
  updatePrompt: (id: string, label: string, prompt: string) => void
  load: () => void
} {
  const prompts = ref<SavedPrompt[]>([])

  function load(): void {
    prompts.value = readStored(projectIdRef.value ?? '')
  }

  // 项目切换时重新载入对应项目的提示词库
  watch(projectIdRef, () => load(), { immediate: true })

  function persist(): void {
    writeStored(projectIdRef.value ?? '', prompts.value)
  }

  /** 新增一条提示词；返回创建成功的对象，失败返回 null。 */
  function addPrompt(label: string, prompt: string): SavedPrompt {
    const item: SavedPrompt = {
      id: newId(),
      label: label.trim() || prompt.trim().slice(0, 12) || '未命名提示词',
      prompt: prompt.trim(),
      createdAt: new Date().toISOString()
    }
    prompts.value = [...prompts.value, item]
    persist()
    return item
  }

  /** 兼容旧调用：保存提示词，成功返回 true。 */
  function savePrompt(label: string, prompt: string): boolean {
    if (!prompt.trim()) return false
    addPrompt(label, prompt)
    return true
  }

  function deletePrompt(id: string): void {
    prompts.value = prompts.value.filter((p) => p.id !== id)
    persist()
  }

  /** 更新一条提示词的名称与内容。 */
  function updatePrompt(id: string, label: string, prompt: string): void {
    prompts.value = prompts.value.map((p) => (p.id === id ? { ...p, label, prompt } : p))
    persist()
  }

  return { prompts, savePrompt, deletePrompt, addPrompt, updatePrompt, load }
}
