<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Upload, X } from 'lucide-vue-next'
import { NButton, NDrawer, NDrawerContent, NInput, NForm, NFormItem, NCheckboxGroup, NCheckbox } from 'naive-ui'
import type { AgentProfile } from '@shared/assistant-runtime'
import { PRESET_AGENT_AVATARS, defaultRobotAvatarSvg, randomRobotAvatarSvg } from '@shared/agent-avatars'
import type { ProjectSkillItem } from '@/types/app'
import { useMessage } from 'naive-ui'

const message = useMessage()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', agent: AgentProfile): void
}>()

const props = defineProps<{
  visible: boolean
  /** 编辑模式：传入已有智能体。 */
  agent?: AgentProfile | null
  /** 当前项目 ID（局部智能体归属）。 */
  projectId?: string
}>()

// ============ 表单状态 ============
const name = ref('')
const description = ref('')
const systemPrompt = ref('')
const avatarType = ref<'svg' | 'image' | 'none'>('svg')
const presetIndex = ref(0)
const avatarDataUri = ref('')
/** 随机生成的机器人默认头像（完整 SVG 字符串）。新建时自动生成，颜色随机。 */
const robotSvgAvatar = ref('')
const scope = ref<'local' | 'global'>('global')
const selectedSkillIds = ref<string[]>([])
const availableSkills = ref<ProjectSkillItem[]>([])
const skillsLoading = ref(false)
const isSaving = ref(false)
/** 当前编辑的全局智能体是否已是默认（仅编辑全局智能体时可设为默认）。 */
const isDefault = ref(false)
/** 是否正在执行「设为默认」操作。 */
const settingDefault = ref(false)

/** 将已导入的 skill 按分组聚合，供绑定面板按分组展示 */
const groupedAvailableSkills = computed(() => {
  const groups = new Map<string, ProjectSkillItem[]>()
  for (const skill of availableSkills.value) {
    // 内置 skill 路径形如 skills/<group>/<skill>，按来源子目录分组；
    // 项目 skill 路径形如 project-skills/<skill>（未分组）或 project-skills/<group>/<skill>（已分组）。
    const segments = skill.path.split('/')
    const isBuiltin = skill.scope === 'builtin'
    // 内置分组带作用域前缀，避免与项目同名分组混合
    const groupKey = segments.length > 2
      ? (isBuiltin ? `__builtin__${segments[1]}` : segments[1])
      : (isBuiltin ? '_builtin_root' : '_ungrouped')
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey)!.push(skill)
  }
  return Array.from(groups.entries())
    .map(([groupKey, skills]) => {
      // 显示用分组名：内置分组带"内置·"前缀
      let label: string
      if (groupKey.startsWith('__builtin__')) {
        label = `内置 · ${groupKey.slice('__builtin__'.length)}`
      } else if (groupKey === '_ungrouped') {
        label = '项目 Skills · 未分组'
      } else if (groupKey === '_builtin_root') {
        label = '内置 Skills'
      } else {
        label = groupKey
      }
      return { groupKey, skills, label }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
})

// ============ 头像上传 ============
const MAX_AVATAR_DIMENSION = 512

function handleAvatarUpload(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 验证图片类型
  if (!file.type.startsWith('image/')) {
    message.error('请选择图片文件')
    return
  }

  // 读取图片并检查比例
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      // 检查是否近似 1:1 比例（允许 10% 误差）
      const ratio = Math.max(img.width / img.height, img.height / img.width)
      if (ratio > 1.15) {
        message.warning(`头像建议使用 1:1 正方形比例，当前图片比例约 ${img.width}:${img.height}`)
      }
      // 检查尺寸是否过大，过大则压缩
      if (img.width > MAX_AVATAR_DIMENSION || img.height > MAX_AVATAR_DIMENSION) {
        const canvas = document.createElement('canvas')
        const scale = MAX_AVATAR_DIMENSION / Math.max(img.width, img.height)
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          avatarDataUri.value = canvas.toDataURL(file.type || 'image/png')
          avatarType.value = 'image'
          robotSvgAvatar.value = ''
          message.info(`图片已压缩到 ${canvas.width}×${canvas.height}`)
          return
        }
      }
      avatarDataUri.value = reader.result as string
      avatarType.value = 'image'
      robotSvgAvatar.value = ''
    }
    img.src = reader.result as string
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function selectPresetAvatar(index: number): void {
  presetIndex.value = index
  avatarType.value = 'svg'
  avatarDataUri.value = ''
  robotSvgAvatar.value = ''
}

// ============ 保存 ============
function buildAvatarData(): string {
  if (avatarType.value === 'svg') {
    // 优先使用随机生成的机器人默认头像
    if (robotSvgAvatar.value) return robotSvgAvatar.value
    const preset = PRESET_AGENT_AVATARS.find((p) => p.index === presetIndex.value)
    return preset
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${preset.inner}</svg>`
      : ''
  }
  return avatarDataUri.value
}

async function handleSave(): Promise<void> {
  if (!name.value.trim()) {
    message.error('请输入智能体名称')
    return
  }
  if (!systemPrompt.value.trim()) {
    message.error('请输入系统提示词')
    return
  }
  if (scope.value === 'local' && !props.projectId) {
    message.error('当前项目不存在，无法创建局部智能体')
    return
  }

  isSaving.value = true
  try {
    const A = window.characterArc.assistant
    const avatar = buildAvatarData()
    const scopeArg = scope.value
    const projectIdArg = scope.value === 'local' ? props.projectId : undefined
    const skillIds = [...selectedSkillIds.value]

    if (props.agent) {
      // 内置智能体现在也允许编辑
      const updated = await A.agentUpdate({
        id: props.agent.id,
        name: name.value,
        description: description.value,
        systemPrompt: systemPrompt.value,
        avatar,
        avatarType: avatarType.value,
        presetIndex: avatarType.value === 'svg' ? presetIndex.value : undefined,
        scope: scopeArg,
        projectId: projectIdArg,
        skillIds
      })
      if (updated) emit('saved', updated as unknown as AgentProfile)
    } else {
      const created = await A.agentCreate({
        name: name.value,
        description: description.value,
        systemPrompt: systemPrompt.value,
        avatar,
        avatarType: avatarType.value,
        presetIndex: avatarType.value === 'svg' ? presetIndex.value : undefined,
        scope: scopeArg,
        projectId: projectIdArg,
        skillIds
      })
      if (created) emit('saved', created as unknown as AgentProfile)
    }
    message.success('智能体已保存')
    emit('close')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    isSaving.value = false
  }
}

/** 勾选框切换默认状态：勾选→设为默认，取消→清除默认标记。 */
async function handleToggleDefault(checked: boolean | string | number): Promise<void> {
  if (checked) {
    await handleSetDefault()
  } else {
    await handleClearDefault()
  }
}

/** 将当前编辑的全局智能体设为默认。 */
async function handleSetDefault(): Promise<void> {
  if (!props.agent) {
    message.warning('请先保存该智能体后再设为默认')
    return
  }
  if (props.agent.scope !== 'global') {
    message.warning('仅全局智能体可设为默认')
    return
  }
  settingDefault.value = true
  try {
    const result = await window.characterArc.assistant.agentSetDefault({ id: props.agent.id })
    if (result?.ok && result.agent) {
      isDefault.value = true
      message.success(`已将「${result.agent.name}」设为默认全局智能体`)
      // 刷新当前编辑态，同步最新的 isDefault 标记
      props.agent.isDefault = true
      emit('saved', result.agent)
    } else {
      message.error('设为默认失败')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '设为默认失败')
  } finally {
    settingDefault.value = false
  }
}

/** 取消当前编辑的全局智能体的默认标记。 */
async function handleClearDefault(): Promise<void> {
  if (!props.agent) {
    message.warning('请先保存该智能体后再操作')
    return
  }
  if (props.agent.scope !== 'global') {
    message.warning('仅全局智能体可设为默认')
    return
  }
  settingDefault.value = true
  try {
    const result = await window.characterArc.assistant.agentClearDefault({ id: props.agent.id })
    if (result?.ok && result.agent) {
      isDefault.value = false
      props.agent.isDefault = false
      emit('saved', result.agent)
    } else {
      message.error('取消默认失败')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '取消默认失败')
  } finally {
    settingDefault.value = false
  }
}

/** 加载已导入的 skills 供智能体勾选绑定。
 * 全局智能体（无 projectId）也能绑定软件内置 skills 与用户导入到共享目录的扩展 skills；
 * 局部智能体（有 projectId）则额外并入当前项目导入的扩展 skills。 */
async function loadAvailableSkills(): Promise<void> {
  const projectId = props.projectId
  skillsLoading.value = true
  try {
    const result = await window.characterArc.scanProjectSkills(projectId)
    availableSkills.value = (result?.skills ?? []) as ProjectSkillItem[]
  } catch {
    availableSkills.value = []
  } finally {
    skillsLoading.value = false
  }
}

// 编辑时填充表单
function fillForm(agent: AgentProfile | null): void {
  if (agent) {
    // 内置智能体现在也可编辑
    name.value = agent.name
    description.value = agent.description
    systemPrompt.value = agent.systemPrompt
    scope.value = agent.scope ?? 'global'
    selectedSkillIds.value = [...(agent.skillIds ?? [])]
    isDefault.value = !!agent.isDefault
    if (agent.avatarType === 'svg') {
      avatarType.value = 'svg'
      avatarDataUri.value = ''
      // 有 presetIndex 时是预设 SVG 头像；否则是自定义 SVG（如随机机器人默认头像），直接展示存储内容
      if (agent.presetIndex !== undefined && agent.presetIndex >= 0) {
        robotSvgAvatar.value = ''
        presetIndex.value = agent.presetIndex
      } else {
        // avatar 为空（如旧数据缺失头像）时回填默认机器人头像，避免预览空白
        robotSvgAvatar.value = agent.avatar || defaultRobotAvatarSvg()
        presetIndex.value = -1
      }
    } else if (agent.avatarType === 'image') {
      avatarType.value = 'image'
      avatarDataUri.value = agent.avatar
      robotSvgAvatar.value = ''
    } else {
      // 智能体没有任何自定义头像（未选择预设、未上传图片）时，
      // 自动回填一个默认机器人头像，保证编辑预览始终有头像、保存也不会丢失头像。
      avatarType.value = 'svg'
      avatarDataUri.value = ''
      robotSvgAvatar.value = defaultRobotAvatarSvg()
      presetIndex.value = -1
    }
  } else {
    // 新建模式：自动分配一个随机颜色的机器人默认头像
    name.value = ''
    description.value = ''
    systemPrompt.value = ''
    avatarType.value = 'svg'
    presetIndex.value = -1
    avatarDataUri.value = ''
    robotSvgAvatar.value = randomRobotAvatarSvg()
    scope.value = 'global'
    selectedSkillIds.value = []
    isDefault.value = false
  }
}

// 监听 visible/agent 变化
watch(
  () => [props.visible, props.agent],
  () => {
    if (props.visible) {
      fillForm(props.agent ?? null)
      void loadAvailableSkills()
    }
  }
)
</script>

<template>
  <NDrawer
    :show="visible"
    :mask-closable="false"
    placement="right"
    :width="520"
    class="agent-drawer"
    @update:show="(v: boolean) => { if (!v) emit('close') }"
  >
    <NDrawerContent class="agent-drawer-content">
      <template #header>
        <div class="agent-dialog-title">
          <span class="title-icon">✦</span>
          {{ agent ? '编辑智能体' : '创建智能体' }}
        </div>
      </template>

      <div class="agent-form">
        <NForm label-placement="top" size="small">
        <NFormItem label="智能体名称" required>
          <NInput v-model:value="name" placeholder="例如：大纲师、设定校对、去AI味专家" :maxlength="30" />
        </NFormItem>

        <NFormItem label="作用范围">
          <div class="scope-toggle">
            <button
              type="button"
              class="scope-opt"
              :class="{ active: scope === 'global' }"
              @click="scope = 'global'"
            >
              <strong>全局智能体</strong>
              <span>所有项目/小说共享</span>
            </button>
            <button
              type="button"
              class="scope-opt"
              :class="{ active: scope === 'local' }"
              @click="scope = 'local'"
            >
              <strong>局部智能体</strong>
              <span>仅当前这本小说可用</span>
            </button>
          </div>
          <p v-if="scope === 'local'" class="scope-hint">局部智能体仅服务于当前项目/小说，与其它小说的局部智能体数据完全隔离。</p>
          <div
            v-if="agent && agent.scope === 'global'"
            class="default-agent-row"
          >
            <NCheckbox
              :checked="isDefault"
              :disabled="settingDefault"
              @update:checked="handleToggleDefault"
            >
              <span class="default-agent-label">设为默认</span>
            </NCheckbox>
            <span v-if="isDefault" class="default-agent-badge">✓ 当前默认</span>
            <span v-else class="default-agent-hint">勾选后此智能体将作为全局默认</span>
          </div>
        </NFormItem>

        <NFormItem label="描述">
          <NInput
            v-model:value="description"
            placeholder="简短描述这个智能体的能力与定位"
            :maxlength="100"
          />
        </NFormItem>

        <NFormItem label="系统提示词" required>
          <NInput
            v-model:value="systemPrompt"
            type="textarea"
            placeholder="写出这个智能体的角色设定、行为准则与专长领域……"
            :autosize="{ minRows: 5, maxRows: 12 }"
          />
        </NFormItem>

        <NFormItem label="绑定 Skills（每次调用自动生效）">
          <div class="skill-bind">
            <div v-if="skillsLoading" class="skill-hint">正在加载已导入的 Skills…</div>
            <div v-else-if="availableSkills.length === 0" class="skill-hint">
              暂无已导入的 Skill。可先在「内置 Skills 与项目扩展」页面导入后再绑定。
            </div>
            <div v-else class="skill-scroll">
              <NCheckboxGroup v-model:value="selectedSkillIds">
                <template v-for="group in groupedAvailableSkills" :key="group.groupKey">
                  <div class="skill-group-title">{{ group.label }}</div>
                  <div class="skill-grid">
                    <NCheckbox
                      v-for="skill in group.skills"
                      :key="skill.id"
                      :value="skill.id"
                      :label="skill.name"
                    />
                  </div>
                </template>
              </NCheckboxGroup>
            </div>
          </div>
        </NFormItem>

        <NFormItem label="头像">
          <div class="avatar-section">
            <div class="avatar-preview">
              <div v-if="avatarType === 'svg' && robotSvgAvatar" class="avatar-robot-show" v-html="robotSvgAvatar" />
              <div v-else-if="avatarType === 'svg' && PRESET_AGENT_AVATARS[presetIndex]" class="avatar-preset-show">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" v-html="PRESET_AGENT_AVATARS[presetIndex].inner" />
              </div>
              <div v-else-if="avatarType === 'image' && avatarDataUri" class="avatar-img-show">
                <img :src="avatarDataUri" alt="头像" />
              </div>
              <div v-else class="avatar-empty">无</div>
            </div>

            <!-- 预设 SVG 头像网格 -->
            <div class="preset-grid">
              <button
                v-for="preset in PRESET_AGENT_AVATARS"
                :key="preset.index"
                type="button"
                class="preset-item"
                :class="{ active: avatarType === 'svg' && presetIndex === preset.index }"
                :title="preset.name"
                @click="selectPresetAvatar(preset.index)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="36" height="36" v-html="preset.inner" />
              </button>
            </div>

            <!-- 上传图片 -->
            <div class="upload-row">
              <label class="upload-btn">
                <Upload :size="14" />
                <span>上传自定义图片</span>
                <input type="file" accept="image/*" class="hidden-input" @change="handleAvatarUpload" />
              </label>
              <span class="upload-hint">建议 1:1 正方形，最大 512×512</span>
              <button
                v-if="avatarType === 'image'"
                type="button"
                class="clear-avatar"
                @click="avatarType = 'svg'; presetIndex = -1; avatarDataUri = ''; robotSvgAvatar = randomRobotAvatarSvg()"
              >
                <X :size="13" />
                清除
              </button>
            </div>
          </div>
        </NFormItem>
      </NForm>
      </div>

      <template #footer>
        <div class="dialog-actions">
          <NButton @click="emit('close')">取消</NButton>
          <NButton type="primary" :loading="isSaving" @click="handleSave">
            保存智能体
          </NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
/* 抽屉整体：内容区可上下滚动，header/footer 固定 */
.agent-drawer-content {
  height: 100%;
}
.agent-drawer-content :deep(.n-drawer-body-content-wrapper) {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
}
.agent-dialog-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.title-icon {
  color: var(--arc-primary);
}
.agent-form {
  padding: 4px 0;
}
.scope-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
}
.scope-opt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}
.scope-opt strong {
  font-size: 13px;
  color: var(--arc-text-primary);
}
.scope-opt span {
  font-size: 11px;
  color: var(--arc-text-hint);
}
.scope-opt:hover {
  border-color: var(--arc-primary);
}
.scope-opt.active {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.scope-opt.active strong {
  color: var(--arc-primary);
}
.scope-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--arc-text-hint);
  line-height: 1.4;
}
.default-agent-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--arc-border-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
}
.default-agent-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}
.default-agent-hint {
  font-size: 11px;
  color: var(--arc-text-hint);
  line-height: 1.4;
}
.default-agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(4, 120, 87, 0.12);
  color: #047857;
  font-size: 11.5px;
  font-weight: 600;
}
.skill-bind {
  width: 100%;
}
.skill-hint {
  font-size: 12px;
  color: var(--arc-text-hint);
}
.skill-scroll {
  max-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  padding: 8px;
}
.skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  width: 100%;
}
.skill-group-title {
  margin: 8px 0 4px;
  padding-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-hint);
  border-bottom: 1px dashed var(--arc-border);
}
.skill-group-title:first-child {
  margin-top: 0;
}
.avatar-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.avatar-preview {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar-preset-show,
.avatar-robot-show,
.avatar-img-show {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--arc-border-strong);
  flex-shrink: 0;
}
.avatar-robot-show :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.avatar-img-show img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-empty {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  border: 1px dashed var(--arc-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--arc-text-hint);
  font-size: 12px;
  flex-shrink: 0;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.preset-item {
  border: 2px solid transparent;
  background: var(--arc-bg-surface);
  border-radius: 8px;
  padding: 4px;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preset-item:hover {
  border-color: var(--arc-primary);
  transform: scale(1.05);
}
.preset-item.active {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.preset-item svg {
  display: block;
  border-radius: 6px;
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--arc-border-strong);
  border-radius: 8px;
  cursor: pointer;
  color: var(--arc-text-primary);
  font-size: 13px;
  background: var(--arc-bg-surface);
  transition: all 0.15s ease;
}
.upload-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
}
.hidden-input {
  display: none;
}
.upload-hint {
  font-size: 12px;
  color: var(--arc-text-hint);
}
.clear-avatar {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 12px;
  border-radius: 6px;
  transition: all 0.15s ease;
}
.clear-avatar:hover {
  color: var(--arc-danger);
  background: var(--arc-danger-soft);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
