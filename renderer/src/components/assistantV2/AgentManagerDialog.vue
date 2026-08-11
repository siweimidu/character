<script setup lang="ts">
import { ref, watch } from 'vue'
import { Upload, X } from 'lucide-vue-next'
import { NButton, NModal, NInput, NForm, NFormItem } from 'naive-ui'
import type { AgentProfile } from '@shared/assistant-runtime'
import { PRESET_AGENT_AVATARS } from '@shared/agent-avatars'
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
}>()

// ============ 表单状态 ============
const name = ref('')
const description = ref('')
const systemPrompt = ref('')
const avatarType = ref<'svg' | 'image' | 'none'>('svg')
const presetIndex = ref(0)
const avatarDataUri = ref('')
const isSaving = ref(false)

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
          message.info(`图片已压缩到 ${canvas.width}×${canvas.height}`)
          return
        }
      }
      avatarDataUri.value = reader.result as string
      avatarType.value = 'image'
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
}

// ============ 保存 ============
function buildAvatarData(): string {
  if (avatarType.value === 'svg') {
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

  isSaving.value = true
  try {
    const A = window.characterArc.assistant
    const avatar = buildAvatarData()

    if (props.agent && !props.agent.isBuiltin) {
      const updated = await A.agentUpdate({
        id: props.agent.id,
        name: name.value,
        description: description.value,
        systemPrompt: systemPrompt.value,
        avatar,
        avatarType: avatarType.value,
        presetIndex: avatarType.value === 'svg' ? presetIndex.value : undefined
      })
      if (updated) emit('saved', updated as unknown as AgentProfile)
    } else {
      const created = await A.agentCreate({
        name: name.value,
        description: description.value,
        systemPrompt: systemPrompt.value,
        avatar,
        avatarType: avatarType.value,
        presetIndex: avatarType.value === 'svg' ? presetIndex.value : undefined
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

// 编辑时填充表单
function fillForm(agent: AgentProfile | null): void {
  if (agent && !agent.isBuiltin) {
    name.value = agent.name
    description.value = agent.description
    systemPrompt.value = agent.systemPrompt
    if (agent.avatarType === 'svg') {
      avatarType.value = 'svg'
      presetIndex.value = agent.presetIndex ?? 0
      avatarDataUri.value = ''
    } else if (agent.avatarType === 'image') {
      avatarType.value = 'image'
      avatarDataUri.value = agent.avatar
    } else {
      avatarType.value = 'none'
      avatarDataUri.value = ''
    }
  } else {
    // 新建模式
    name.value = ''
    description.value = ''
    systemPrompt.value = ''
    avatarType.value = 'svg'
    presetIndex.value = 0
    avatarDataUri.value = ''
  }
}

// 监听 visible/agent 变化
watch(
  () => [props.visible, props.agent],
  () => {
    if (props.visible) fillForm(props.agent ?? null)
  }
)
</script>

<template>
  <NModal
    :show="visible"
    :mask-closable="false"
    preset="card"
    style="width: 560px"
    @update:show="(v: boolean) => { if (!v) emit('close') }"
  >
    <template #header>
      <div class="agent-dialog-title">
        <span class="title-icon">✦</span>
        {{ agent && !agent.isBuiltin ? '编辑智能体' : '创建智能体' }}
      </div>
    </template>

    <div class="agent-form">
      <NForm label-placement="top" size="small">
        <NFormItem label="智能体名称" required>
          <NInput v-model:value="name" placeholder="例如：大纲师、设定校对、去AI味专家" :maxlength="30" />
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

        <NFormItem label="头像">
          <div class="avatar-section">
            <div class="avatar-preview">
              <div v-if="avatarType === 'svg' && PRESET_AGENT_AVATARS[presetIndex]" class="avatar-preset-show">
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
                @click="avatarType = 'svg'; presetIndex = 0; avatarDataUri = ''"
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
  </NModal>
</template>

<style scoped>
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
.avatar-img-show {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--arc-border-strong);
  flex-shrink: 0;
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
