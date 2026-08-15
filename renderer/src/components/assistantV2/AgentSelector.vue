<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronDown, Pencil, Plus, Settings2, Trash2 } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import type { AgentProfile } from '@shared/assistant-runtime'
import { PRESET_AGENT_AVATARS, defaultRobotAvatarSvg } from '@shared/agent-avatars'
import AgentManagerDialog from './AgentManagerDialog.vue'

const props = defineProps<{
  /** 当前选中的智能体 ID。 */
  modelValue?: string
  /** 当前项目 ID（局部智能体归属）。 */
  projectId?: string
  /** 初始展示的作用范围：'local' 本小说 / 'global' 全局。缺省 'local'。 */
  defaultScope?: 'local' | 'global'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', agentId: string): void
  /** 同步当前选中智能体的作用范围，供上层在发送时明确传递 agentScope。 */
  (e: 'update:scope', scope?: 'local' | 'global'): void
}>()

/** 默认智能体的空串 ID：选中「默认」时 modelValue 为空串，调用方以 undefined 传给后端，
 *  由后端 getDefaultAgent 解析为默认全局/局部智能体（当前为 Solo）。 */
const DEFAULT_AGENT_ID = ''

const message = useMessage()
const agents = ref<AgentProfile[]>([])
const isOpen = ref(false)
const isLoaded = ref(false)
const showManager = ref(false)
const editingAgent = ref<AgentProfile | null>(null)
/** 当前查看的作用范围：'local' 只显示本项目局部智能体，'global' 只显示全局智能体。 */
// 默认展示「本小说智能体」（内置智能体已迁移到本小说智能体，全局默认含 Solo）。
const activeScope = ref<'local' | 'global'>(props.defaultScope ?? 'local')

/** 作用域内默认智能体（Solo，若被删除则回落到第一个）。 */
const defaultAgent = computed<AgentProfile | null>(
  () => agents.value.find((a) => a.id === 'builtin-solo') ?? agents.value[0] ?? null
)

/** 是否选中了「默认」智能体。 */
const isDefaultSelected = computed(() => !props.modelValue)

async function loadAgents(scope?: 'local' | 'global'): Promise<void> {
  try {
    const A = window.characterArc.assistant
    const list = await A.agentList({
      scope: scope ?? activeScope.value,
      projectId: scope === 'local' ? props.projectId : (activeScope.value === 'local' ? props.projectId : undefined)
    })
    agents.value = list as unknown as AgentProfile[]
    isLoaded.value = true
    // 若当前选中项在当前列表不存在（且不是默认项），则重置为「默认」，避免选中一个不属于当前作用域的智能体。
    const currentExists = props.modelValue
      ? agents.value.some((a) => a.id === props.modelValue)
      : true
    if (props.modelValue && !currentExists) {
      emit('update:modelValue', DEFAULT_AGENT_ID)
    }
  } catch (err) {
    console.error('加载智能体失败:', err)
    isLoaded.value = true
  }
}

function switchScope(scope: 'local' | 'global'): void {
  activeScope.value = scope
  void loadAgents(scope)
}

const currentAgent = computed(() =>
  props.modelValue
    ? agents.value.find((a) => a.id === props.modelValue) ?? agents.value[0] ?? null
    : defaultAgent.value
)

function avatarUrl(agent: AgentProfile): string {
  if (agent.avatarType === 'svg' && agent.avatar) {
    // data: URI 可直接作为 <img> 地址
    if (agent.avatar.startsWith('data:')) {
      return agent.avatar
    }
    // 裸 SVG 字符串（如随机机器人默认头像）需编码为 data URI，
    // 否则 <img :src> 加载失败会显示“未加载出来”的破碎头像。
    return `data:image/svg+xml,${encodeURIComponent(agent.avatar)}`
  }
  if (agent.avatarType === 'image' && agent.avatar) {
    return agent.avatar
  }
  // 没有自定义头像时使用预设头像
  if (agent.presetIndex !== undefined && agent.presetIndex >= 0) {
    const preset = PRESET_AGENT_AVATARS.find((p) => p.index === agent.presetIndex)
    if (preset) {
      return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${preset.inner}</svg>`
      )}`
    }
  }
  // 没有任何头像（未选择预设、未上传图片）时兜底使用默认机器人头像，
  // 避免显示空白/加载失败的占位，保证每个智能体都有头像可展示。
  // 注意：需编码为 data URI，避免 <img> 加载裸 SVG 失败。
  return `data:image/svg+xml,${encodeURIComponent(defaultRobotAvatarSvg())}`
}

function handleSelect(agent: AgentProfile): void {
  emit('update:modelValue', agent.id)
  emit('update:scope', agent.scope)
  isOpen.value = false
}

/** 选择「默认」智能体（空串，由后端解析为默认 Solo）。 */
function selectDefault(): void {
  emit('update:modelValue', DEFAULT_AGENT_ID)
  isOpen.value = false
}

function toggleOpen(): void {
  if (!isLoaded.value) void loadAgents()
  isOpen.value = !isOpen.value
}

function handleSaved(agent: AgentProfile): void {
  // 刷新列表并选中新保存的智能体
  void loadAgents()
  emit('update:modelValue', agent.id)
  emit('update:scope', agent.scope)
  showManager.value = false
  editingAgent.value = null
}

function handleEdit(agent: AgentProfile): void {
  editingAgent.value = agent
  showManager.value = true
}

async function handleDelete(agent: AgentProfile): Promise<void> {
  if (!confirm(`确定删除智能体"${agent.name}"吗？此操作不可恢复。`)) return
  try {
    const A = window.characterArc.assistant
    const result = await A.agentDelete({ id: agent.id })
    if (result.ok) {
      message.success('智能体已删除')
      // loadAgents 内部会在当前选中项不在列表内时自动选中第一个并同步其作用范围，
      // 因此删除后无需在此重复 emit，避免 scope 同步不一致。
      await loadAgents()
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '删除失败')
  }
}

onMounted(() => {
  void loadAgents()
})

</script>

<template>
  <div class="agent-selector">
    <div class="selector-trigger" @click="toggleOpen">
      <div class="agent-avatar">
        <img v-if="currentAgent && avatarUrl(currentAgent)" :src="avatarUrl(currentAgent)" alt="头像" />
        <span v-else class="avatar-placeholder">✦</span>
      </div>
      <div class="agent-info">
        <div class="agent-name">{{ isDefaultSelected ? '默认 · ' : '' }}{{ currentAgent?.name ?? '智能体' }}</div>
        <div class="agent-desc">{{ currentAgent?.description || '选择创作助手' }}</div>
      </div>
      <ChevronDown :size="14" class="chevron" :class="{ open: isOpen }" />
    </div>

    <transition name="dropdown">
      <div v-if="isOpen" class="dropdown">
        <div class="dropdown-header">
          <span>选择智能体</span>
          <button class="manage-btn" @click="editingAgent = null; showManager = true">
            <Settings2 :size="13" />
            新建
          </button>
        </div>
        <div v-if="projectId" class="scope-tabs">
          <button
            type="button"
            :class="{ active: activeScope === 'local' }"
            @click="switchScope('local')"
          >
            本小说智能体
          </button>
          <button
            type="button"
            :class="{ active: activeScope === 'global' }"
            @click="switchScope('global')"
          >
            全局智能体
          </button>
        </div>
        <div class="agent-list">
          <div
            class="agent-row"
            :class="{ active: isDefaultSelected }"
          >
            <button type="button" class="agent-item" @click="selectDefault">
              <div class="item-avatar default-avatar">
                <img v-if="defaultAgent && avatarUrl(defaultAgent)" :src="avatarUrl(defaultAgent)" alt="头像" />
                <span v-else class="item-avatar-ph">✦</span>
              </div>
              <div class="item-info">
                <div class="item-name">
                  默认
                  <span class="builtin-tag">默认</span>
                </div>
                <div class="item-desc">{{ defaultAgent ? `跟随${activeScope === 'global' ? '全局' : '本小说'}默认（${defaultAgent.name}）` : '默认智能体' }}</div>
              </div>
            </button>
          </div>
          <div class="agent-divider" />
          <div
            v-for="agent in agents"
            :key="agent.id"
            class="agent-row"
            :class="{ active: agent.id === (currentAgent?.id) }"
          >
            <button type="button" class="agent-item" @click="handleSelect(agent)">
              <div class="item-avatar">
                <img v-if="avatarUrl(agent)" :src="avatarUrl(agent)" alt="头像" />
                <span v-else class="item-avatar-ph">✦</span>
              </div>
              <div class="item-info">
                <div class="item-name">
                  {{ agent.name }}
                  <span v-if="agent.isBuiltin" class="builtin-tag">内置</span>
                </div>
                <div class="item-desc">{{ agent.description }}</div>
              </div>
            </button>
            <div class="item-actions">
              <button type="button" class="action-btn" title="编辑" @click.stop="handleEdit(agent)">
                <Pencil :size="13" />
              </button>
              <button type="button" class="action-btn danger" title="删除" @click.stop="handleDelete(agent)">
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
          <button type="button" class="create-item" @click="editingAgent = null; showManager = true">
            <Plus :size="14" />
            <span>创建新智能体</span>
          </button>
        </div>
      </div>
    </transition>

    <AgentManagerDialog
      :visible="showManager"
      :agent="editingAgent"
      :project-id="projectId"
      @close="showManager = false; editingAgent = null"
      @saved="handleSaved"
    />
  </div>
</template>

<style scoped>
.agent-selector {
  position: relative;
  width: 100%;
}
.selector-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  border-radius: 14px;
  cursor: pointer;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.selector-trigger:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  background: var(--arc-bg-surface-hover);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--arc-primary) 8%, transparent);
}
.agent-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--arc-bg-weak);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
}
.agent-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-placeholder {
  font-size: 14px;
  color: var(--arc-text-hint);
}
.agent-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.agent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-desc {
  font-size: 11px;
  color: var(--arc-text-hint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.chevron {
  color: var(--arc-text-hint);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.chevron.open {
  transform: rotate(180deg);
}
.dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 100;
  width: 320px;
  max-height: 420px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  border-radius: 16px;
  box-shadow: 0 12px 40px color-mix(in srgb, var(--arc-text-primary) 12%, transparent);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--arc-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}
.manage-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  border-radius: 6px;
}
.manage-btn:hover {
  background: var(--arc-primary-soft);
}
.scope-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.scope-tabs button {
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.scope-tabs button:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.scope-tabs button.active {
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}
.agent-list {
  overflow-y: auto;
  flex: 1;
  padding: 8px;
}
.agent-divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--arc-border);
}
.agent-row {
  display: flex;
  align-items: center;
  border-radius: 10px;
  transition: background 0.15s ease;
}
.agent-row:hover {
  background: var(--arc-bg-weak);
}
.agent-row.active {
  background: var(--arc-primary-soft);
}
.agent-row.active:hover {
  background: var(--arc-primary-soft);
}
.agent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 10px 6px 10px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
  flex-shrink: 0;
}
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
}
.action-btn:hover {
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.action-btn.danger:hover {
  color: var(--arc-danger);
  background: var(--arc-danger-soft);
}
.item-avatar {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
}
.item-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.item-avatar-ph {
  font-size: 14px;
  color: var(--arc-text-hint);
}
.item-info {
  flex: 1;
  min-width: 0;
}
.item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--arc-text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.builtin-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 500;
}
.item-desc {
  font-size: 11px;
  color: var(--arc-text-hint);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.create-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border: none;
  background: transparent;
  border-top: 1px solid var(--arc-border);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s ease;
}
.create-item:hover {
  background: var(--arc-primary-soft);
}
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
