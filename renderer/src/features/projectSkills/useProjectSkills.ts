import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import type { ProjectSkillItem } from '@/types/app'

/**
 * 在智能体 / 快捷指令等界面使用的项目 skills 加载器。
 *
 * 背景：`currentProject.projectSkills` 只在用户打开过「Skills」管理面板触发扫描后才会
 * 被写回 store，且依赖持久化快照，容易滞后——新导入的 skills 或磁盘上新放置的 skills
 * 可能不会反映到斜杠命令里。
 *
 * 因此这里直接调用主进程的磁盘扫描（`scanProjectSkills`），并把「已持久化的启用状态」
 * 合并回扫描结果，从而保证：
 *  - 无论是否访问过 Skills 面板，内置 + 项目扩展 skills 都能立即在斜杠命令中列出；
 *  - 用户此前手动启用/停用的状态（已持久化在 project.projectSkills）不被重置。
 */
export function useProjectSkillsLoader() {
  const appStore = useAppStore()
  const skills = ref<ProjectSkillItem[]>([])
  const isLoading = ref(false)

  /** 当前项目已持久化的启用状态（用于合并，不覆盖用户手动开关）。 */
  const persisted = computed(() => appStore.currentProject?.projectSkills ?? [])

  async function refresh(): Promise<void> {
    const projectId = appStore.currentProject?.id
    if (!projectId) {
      skills.value = []
      return
    }
    if (isLoading.value) return
    isLoading.value = true
    try {
      const result = await window.characterArc.scanProjectSkills(projectId)
      const scanned = (result?.skills ?? []) as ProjectSkillItem[]
      const persistedMap = new Map(persisted.value.map((s) => [s.id, s]))
      skills.value = scanned.map((skill) => ({
        ...skill,
        enabled: skill.compatibility === 'external-only'
          ? false
          : (persistedMap.get(skill.id)?.enabled ?? skill.enabled),
        stageIds: persistedMap.get(skill.id)?.stageIds ?? skill.stageIds
      }))
    } catch {
      skills.value = persisted.value
    } finally {
      isLoading.value = false
    }
  }

  watch(
    () => appStore.currentProject?.id,
    () => { void refresh() },
    { immediate: true }
  )

  return { skills, isLoading, refresh }
}

/** 把扫描结果转换为斜杠命令可用的 skills 条目（含 scope，便于分组展示）。 */
export function toSlashSkills(skills: ReadonlyArray<ProjectSkillItem>): Array<{
  id: string
  name: string
  description: string
  category?: ProjectSkillItem['category']
  scope?: 'builtin' | 'project'
}> {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    scope: s.scope
  }))
}
