<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  BookOpenText,
  Camera,
  Download,
  FileJson,
  Image as ImageIcon,
  MoreVertical,
  Network,
  Plus,
  Search,
  ScanEye,
  Sparkles,
  Upload,
  History
} from 'lucide-vue-next'
import {
  NButton,
  NDropdown,
  NDynamicTags,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NTag,
  NRadioGroup,
  NRadioButton,
  useDialog,
  useMessage
} from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { resolveAccentColor, resolveReadableTextColor } from '@/features/relations/graph'
import { toIpcPayload } from '@/utils/ipcPayload'
import { buildCharacterPrompt } from '@/utils/characterPrompt'
import type { AppSettings, CharacterCard } from '@/types/app'
import type { DropdownOption } from 'naive-ui'
import AiEnhancePreview from './AiEnhancePreview.vue'
import BatchDeleteBar from './BatchDeleteBar.vue'
import BatchGenerateDialog from './BatchGenerateDialog.vue'
import type { EnhanceFieldDiff } from './AiEnhancePreview.vue'
import { cancelCatalogBatch, normalizeCatalogTags, useCatalogBatch } from '@/composables/useCatalogBatch'
import { useIncrementalList } from '@/composables/useIncrementalList'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const keyword = ref('') // 本面板内的本地搜索关键词
const roleFilter = ref<string | null>(null)
const bindingFilter = ref<'local' | 'global' | null>(null)
const tagFilter = ref<string | null>(null)
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词，由父组件传入
}>()

const roleOptions = computed(() =>
  [...new Set(appStore.characters.map((character) => character.role.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((role) => ({ label: role, value: role }))
)

// 所有自定义标签（用于标签筛选）
const allCustomTags = computed(() =>
  [...new Set(appStore.characters.flatMap((c) => c.customTags ?? []).map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'zh-CN')
  )
)

// 合并本地搜索框和全局工作区搜索关键词，对角色列表进行过滤
const filteredCharacters = computed(() => {
  const mergedQuery = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  return appStore.characters.filter((character) => {
    const matchesRole = !roleFilter.value || character.role.trim() === roleFilter.value
    const matchesBinding = !bindingFilter.value || character.projectBinding === bindingFilter.value
    const matchesTag = !tagFilter.value || (character.customTags ?? []).includes(tagFilter.value)
    const haystack = [
      character.name,
      character.role,
      character.description,
      character.appearance,
      character.personality,
      character.background,
      ...(character.tags ?? []).map((tag) => tag.label),
      ...(character.customTags ?? [])
    ]
      .join(' ')
      .toLowerCase()
    return matchesRole && matchesBinding && matchesTag && (!mergedQuery || haystack.includes(mergedQuery))
  })
})
const visibleCharacters = useIncrementalList(
  filteredCharacters,
  computed(() => `${props.searchQuery ?? ''}\u0000${keyword.value}\u0000${roleFilter.value ?? ''}\u0000${bindingFilter.value ?? ''}\u0000${tagFilter.value ?? ''}`)
)

const AI_TASK_KEY = 'catalog-batch:character'
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY)) // AI 生成角色时的加载状态
const batchVisible = ref(false)
const batchProgress = ref(0)
const { generateCatalogBatch } = useCatalogBatch()
const editorVisible = ref(false) // 控制角色编辑弹窗的显示
const editingCharacterId = ref<string | null>(null) // 当前正在编辑的角色 ID，null 表示新建模式
const isGeneratingAvatar = ref(false) // AI 生成人物头像
const isRecognizingImage = ref(false) // AI 识别人物图片反推人设
// 批量删除：勾选模式下的已选角色 ID 集合
const selectedCharacterIds = ref<string[]>([])
const focusedCharacterId = ref<string>('')
// 角色编辑表单数据
const form = reactive({
  name: '',
  role: '',
  description: '',
  appearance: '',
  personality: '',
  background: '',
  scenario: '',
  greeting: '',
  dialogueExamples: '',
  avatar: '',
  tags: [] as string[],
  customTags: [] as string[],
  projectBinding: 'local' as 'local' | 'global'
})
// 角色卡片的右键菜单选项
const menuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑角色' },
  { key: 'generatePrompt', label: '生成提示词' },
  { key: 'snapshot', label: '保存快照' },
  { key: 'export', label: '导出卡片' },
  { key: 'delete', label: '删除角色' }
]

function isDataUrl(value: string): boolean {
  return value.startsWith('data:image/')
}
function avatarStyle(avatar: string, seed: string): { background: string, color: string } {
  if (isDataUrl(avatar)) return { background: 'var(--arc-bg-mix)', color: 'var(--arc-text-hint)' }
  const accent = resolveAccentColor(avatar, seed)
  return {
    background: avatar?.trim() ? avatar : accent,
    color: resolveReadableTextColor(accent)
  }
}

function tagType(tone?: 'default' | 'danger' | 'success' | 'warning'): 'default' | 'error' | 'success' | 'warning' {
  switch (tone) {
    case 'danger':
      return 'error'
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    default:
      return 'default'
  }
}

function buildAiWorldviewContext() {
  return appStore.worldviewEntries.slice(0, 12).map((entry) => ({
    type: entry.type,
    title: entry.title,
    content: entry.content.slice(0, 320)
  }))
}

function resetForm(): void {
  form.name = ''
  form.role = ''
  form.description = ''
  form.appearance = ''
  form.personality = ''
  form.background = ''
  form.scenario = ''
  form.greeting = ''
  form.dialogueExamples = ''
  form.avatar = ''
  form.tags = []
  form.customTags = []
  form.projectBinding = 'local'
}

// 打开新建角色弹窗，重置表单为空白状态
function handleCreateCharacter(): void {
  editingCharacterId.value = null
  resetForm()
  editorVisible.value = true
}

// 中断批量生成：关闭弹窗并停止本次生成任务（叉号=中断，减号=后台执行）
function handleInterruptBatch(): void {
  batchVisible.value = false
  cancelCatalogBatch('character')
}

async function handleGenerateCharacter(payload: { count: number; prompt: string; types: string[] }): Promise<void> {
  if (isGenerating.value) return
  try {
    batchProgress.value = 0
    const entries = await generateCatalogBatch({
      mode: 'character',
      count: payload.count,
      label: '批量生成角色',
      panel: 'characters',
      kind: 'character',
      keyField: 'name',
      existingKeys: appStore.characters.map((character) => character.name),
      onProgress: (completed, total) => { batchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        userPrompt: payload.prompt,
        worldviewEntries: buildAiWorldviewContext(),
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        characters: appStore.characters.map((character) => ({
          id: character.id,
          name: character.name,
          role: character.role,
          description: character.description
        }))
      }
    })

    entries.forEach((character) => {
      const tags = normalizeCatalogTags(character.tags)
      appStore.createCharacter({
        name: String(character.name ?? '新角色'),
        role: String(character.role ?? '待设定'),
        description: String(character.description ?? 'AI 未返回有效角色描述'),
        tags: (tags.length ? tags : ['待完善']).map((label) => ({ label })),
        customTags: tags
      })
    })
    batchVisible.value = false
    message.success(`已生成 ${entries.length} 个角色`)
  } catch (error) {
    if (!(error instanceof Error) || (!error.message.includes('任务已中断') && !error.message.includes('任务已被取消'))) {
      message.error(error instanceof Error ? error.message : 'AI 生成角色失败，请检查模型配置')
    }
  }
}

// 打开角色编辑弹窗，传入角色数据时为编辑模式，不传则为新建模式
function openEditor(character?: CharacterCard): void {
  editingCharacterId.value = character?.id ?? null
  form.name = character?.name ?? ''
  form.role = character?.role ?? ''
  form.description = character?.description ?? ''
  form.appearance = character?.appearance ?? ''
  form.personality = character?.personality ?? ''
  form.background = character?.background ?? ''
  form.scenario = character?.scenario ?? ''
  form.greeting = character?.greeting ?? ''
  form.dialogueExamples = character?.dialogueExamples ?? ''
  form.avatar = character?.avatar ?? ''
  form.tags = character?.tags?.map((tag) => tag.label) ?? []
  form.customTags = character?.customTags ?? []
  form.projectBinding = character?.projectBinding ?? 'local'
  editorVisible.value = true
}

// 提交角色表单：校验必填项，将标签字符串数组转为对象数组后保存
function submitCharacter(): void {
  if (!form.name.trim() || !form.description.trim()) {
    message.warning('请完整填写角色名称和角色简介')
    return
  }

  const payload: Partial<CharacterCard> = {
    name: form.name.trim(),
    role: form.role.trim(),
    description: form.description.trim(),
    appearance: form.appearance.trim(),
    personality: form.personality.trim(),
    background: form.background.trim(),
    scenario: form.scenario.trim(),
    greeting: form.greeting.trim(),
    dialogueExamples: form.dialogueExamples,
    avatar: form.avatar,
    tags: form.tags.map((label) => ({ label })),
    customTags: form.customTags,
    projectBinding: form.projectBinding
  }

  if (editingCharacterId.value) {
    appStore.updateCharacter(editingCharacterId.value, payload)
    message.success('角色信息已更新')
  } else {
    appStore.createCharacter(payload)
    message.success('已新增角色草稿')
  }

  editorVisible.value = false
}

// 处理角色卡片的下拉菜单操作
function handleMenuSelect(action: string | number, character: CharacterCard): void {
  if (action === 'edit') {
    openEditor(character)
    return
  }
  if (action === 'generatePrompt') {
    const prompt = buildCharacterPrompt(character)
    message.info('提示词已生成，可复制使用')
    void window.navigator?.clipboard?.writeText(prompt).catch(() => undefined)
    promptPreview.value = prompt
    promptVisible.value = true
    return
  }
  if (action === 'snapshot') {
    appStore.snapshotCharacter(character.id, '手动快照')
    message.success('已保存角色卡快照')
    return
  }
  if (action === 'export') {
    exportCard(character)
    return
  }

  dialog.warning({
    title: '确认删除角色',
    content: `确定要删除"${character.name}"吗？删除后角色资料将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteCharacter(character.id)
      message.success('角色已删除')
    }
  })
}

// ── 头像选择与上传 ──
async function handlePickAvatar(): Promise<void> {
  const result = await window.characterArc.pickCharacterAvatar()
  if (result.canceled || !result.success || !result.dataUrl) return
  form.avatar = result.dataUrl
  message.success('头像已选择')
}

function handleAvatarFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    form.avatar = String(reader.result ?? '')
  }
  reader.readAsDataURL(file)
  input.value = ''
}

// ── AI 一键生成人物头像 ──
function buildAvatarPrompt(): string {
  const parts = [
    '人物卡片头像插画，半身像，面部清晰',
    form.name ? `角色：${form.name}` : '',
    form.role ? `定位：${form.role}` : '',
    form.appearance ? `外貌：${form.appearance}` : '',
    form.personality ? `性格：${form.personality}` : '',
    form.background ? `背景：${form.background}` : '',
    (form.tags?.length ? form.tags : []).length ? `标签：${form.tags.join('、')}` : ''
  ]
  return parts.filter(Boolean).join('\n')
}

async function handleGenerateAvatar(): Promise<void> {
  if (isGeneratingAvatar.value) return
  const cfg = appStore.appSettings
  if (!cfg.imageModel?.trim() || !cfg.imageBaseUrl?.trim() || !cfg.imageApiKey?.trim()) {
    message.warning('请先在设置 → 图片生成配置 中填写图片模型、Base URL 和 API Key。')
    return
  }
  if (!form.name.trim() && !form.appearance.trim() && !form.personality.trim()) {
    message.warning('请至少填写角色名称、外貌或性格中的一项，便于 AI 生成形象。')
    return
  }
  isGeneratingAvatar.value = true
  try {
    const result = await window.characterArc.generateImage({
      settings: { ...cfg } as AppSettings,
      prompt: buildAvatarPrompt()
    })
    if (!result.success) throw new Error(result.error ?? '图片生成失败')
    form.avatar = result.result?.dataUrl ?? ''
    message.success('人物头像已生成')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片生成失败')
  } finally {
    isGeneratingAvatar.value = false
  }
}

// ── AI 识别人物图片反推人设 ──
async function handleRecognizeImage(): Promise<void> {
  if (isRecognizingImage.value) return
  if (!isDataUrl(form.avatar)) {
    message.warning('请先上传一张人物图片（本地上传或选择图片），再进行 AI 识别人设。')
    return
  }
  const cfg = appStore.appSettings
  if (!cfg.visionModel?.trim() || !cfg.visionBaseUrl?.trim() || !cfg.visionApiKey?.trim()) {
    message.warning('请先在设置 → 图片识别配置 中填写图片识别模型、Base URL 和 API Key。')
    return
  }
  isRecognizingImage.value = true
  try {
    const result = await window.characterArc.recognizeImage({
      settings: { ...cfg } as AppSettings,
      imageDataUrl: form.avatar
    })
    if (!result.success || !result.result) throw new Error(result.error ?? '图片识别失败')
    const profile = result.result
    form.name = profile.name || form.name
    form.role = profile.role || form.role
    form.appearance = profile.appearance || form.appearance
    form.personality = profile.personality || form.personality
    form.background = profile.background || form.background
    form.description = profile.description || form.description
    if (profile.tags?.length) {
      form.tags = [...new Set([...form.tags, ...profile.tags])].slice(0, 10)
    }
    message.success('已根据图片识别人设并填充角色信息')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片识别失败')
  } finally {
    isRecognizingImage.value = false
  }
}

// ── 导入 / 导出 ──
async function handleImportCards(): Promise<void> {
  const result = await window.characterArc.pickCharacterCards()
  if (result.canceled) return
  if (!result.success) {
    message.error(result.errors?.join('\n') || '导入失败')
    return
  }
  const cards = result.cards ?? []
  if (!cards.length) {
    message.warning(result.errors?.length ? '没有可导入的有效卡片' : '未选择任何文件')
    return
  }
  let created = 0
  for (const card of cards) {
    appStore.createCharacter({
      name: card.name,
      role: card.role || '待设定',
      description: card.description || '',
      appearance: card.appearance || '',
      personality: card.personality || '',
      background: card.background || '',
      scenario: card.scenario || '',
      greeting: card.greeting || '',
      dialogueExamples: card.dialogueExamples || '',
      avatar: card.avatar || '',
      tags: card.tags.length ? card.tags.map((label) => ({ label })) : [{ label: '导入' }],
      customTags: card.tags
    })
    created += 1
  }
  if (result.errors?.length) {
    message.warning(`已导入 ${created} 张卡片，${result.errors.length} 个文件失败`)
  } else {
    message.success(`已导入 ${created} 张人物卡片`)
  }
}

async function exportCard(character: CharacterCard, format: 'png' | 'json' = 'json'): Promise<void> {
  const result = await window.characterArc.exportCharacterCards({
    cards: [{
      name: character.name,
      description: character.description,
      appearance: character.appearance,
      personality: character.personality,
      scenario: character.scenario,
      greeting: character.greeting,
      dialogueExamples: character.dialogueExamples,
      tags: [...character.customTags, ...(character.tags ?? []).map((t) => t.label)],
      avatar: character.avatar
    }],
    format
  })
  if (result.canceled) return
  if (result.success) {
    message.success(`已导出角色卡：${result.filePath}`)
  } else {
    message.error(result.error || '导出失败')
  }
}

// ── 批量导出 ──
async function handleBatchExportCards(): Promise<void> {
  const ids = selectedCharacterIds.value
  if (!ids.length) return
  const targets = appStore.characters.filter((c) => ids.includes(c.id))
  const result = await window.characterArc.batchExportCharacterCards({
    cards: targets.map((c) => ({
      name: c.name,
      description: c.description,
      appearance: c.appearance,
      personality: c.personality,
      scenario: c.scenario,
      greeting: c.greeting,
      dialogueExamples: c.dialogueExamples,
      tags: [...c.customTags, ...(c.tags ?? []).map((t) => t.label)],
      avatar: c.avatar
    })),
    format: 'json'
  })
  if (result.canceled) return
  if (result.success) {
    const exported = result.exportedCount ?? targets.length
    message.success(`已批量导出 ${exported} 张卡片到：${result.filePath ?? ''}`)
  } else {
    message.error(result.error || '批量导出失败')
  }
}

// ── 版本快照预览 ──
const snapshotVisible = ref(false)
const snapshotCharacterRef = ref<CharacterCard | null>(null)
function openSnapshots(character: CharacterCard): void {
  snapshotCharacterRef.value = character
  snapshotVisible.value = true
}
function restoreSnapshot(versionId: string): void {
  if (!snapshotCharacterRef.value) return
  const ok = appStore.restoreCharacterVersion(snapshotCharacterRef.value.id, versionId)
  if (ok) {
    message.success('已回滚到该快照')
    snapshotVisible.value = false
  } else {
    message.error('快照不存在')
  }
}
function deleteSnapshot(versionId: string): void {
  if (!snapshotCharacterRef.value) return
  appStore.deleteCharacterVersion(snapshotCharacterRef.value.id, versionId)
  message.success('已删除快照')
}

// ── 章节关联 ──
const chapterLinkVisible = ref(false)
const chapterLinkCharacterRef = ref<CharacterCard | null>(null)
function openChapterLinks(character: CharacterCard): void {
  chapterLinkCharacterRef.value = character
  chapterLinkVisible.value = true
}
function toggleChapter(chapterId: string): void {
  if (!chapterLinkCharacterRef.value) return
  appStore.toggleCharacterChapterLink(chapterLinkCharacterRef.value.id, chapterId)
  const refreshed = appStore.characters.find((c) => c.id === chapterLinkCharacterRef.value?.id)
  if (refreshed) chapterLinkCharacterRef.value = refreshed
}
const chapterOptions = computed(() =>
  appStore.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    linked: chapterLinkCharacterRef.value?.relatedChapterIds?.includes(chapter.id) ?? false
  }))
)

// ── AI 提示词预览 ──
const promptVisible = ref(false)
const promptPreview = ref('')

// ── AI 完整人设生成 ──
const FULL_TASK_KEY = 'character-card-full'
const fullGenLoading = computed(() => appStore.isAiTaskRunning(FULL_TASK_KEY))
const fullGenVisible = ref(false)
const fullGenSetting = ref('')

// 可选字段定义，默认全部勾选
const FULL_GEN_FIELD_OPTIONS = [
  { key: 'name', label: '名称' },
  { key: 'role', label: '定位' },
  { key: 'appearance', label: '外貌' },
  { key: 'personality', label: '性格' },
  { key: 'background', label: '背景' },
  { key: 'scenario', label: '场景' },
  { key: 'greeting', label: '开场白' },
  { key: 'dialogueExamples', label: '对话示例' },
  { key: 'description', label: '简介' },
  { key: 'tags', label: '标签' }
] as const
const fullGenFields = reactive<Record<string, boolean>>(
  Object.fromEntries(FULL_GEN_FIELD_OPTIONS.map((opt) => [opt.key, true]))
)
const allFullGenFieldsSelected = computed(() =>
  FULL_GEN_FIELD_OPTIONS.every((opt) => fullGenFields[opt.key])
)
function toggleAllFullGenFields(): void {
  const next = !allFullGenFieldsSelected.value
  FULL_GEN_FIELD_OPTIONS.forEach((opt) => { fullGenFields[opt.key] = next })
}

async function handleFullGenerate(): Promise<void> {
  if (fullGenLoading.value) return
  const selectedFields = FULL_GEN_FIELD_OPTIONS
    .filter((opt) => fullGenFields[opt.key])
    .map((opt) => opt.key)
  if (!selectedFields.includes('name')) {
    // name 必须保留
    selectedFields.unshift('name')
    fullGenFields.name = true
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: FULL_TASK_KEY,
        kind: 'character',
        label: 'AI 生成人物卡片',
        description: '正在根据设定自动填充选中的人设字段',
        panel: 'characters'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          clientTaskId: appStore.getClientTaskId(),
          task: 'character-card-full',
          settings: appStore.appSettings,
          context: {
            projectId: appStore.currentProject?.id,
            userPrompt: fullGenSetting.value,
            selectedFields,
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            characterNames: appStore.characters.map((c) => c.name),
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            worldviewEntries: buildAiWorldviewContext(),
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 生成失败，请检查模型配置')
    }

    const suggested = result.result as {
      name?: string; role?: string; appearance?: string; personality?: string;
      background?: string; scenario?: string; greeting?: string; dialogueExamples?: string;
      description?: string; tags?: string[]
    }
    // 仅填入用户勾选的字段
    if (fullGenFields.name) form.name = suggested.name?.trim() || form.name
    if (fullGenFields.role) form.role = suggested.role?.trim() || form.role
    if (fullGenFields.appearance) form.appearance = suggested.appearance?.trim() || form.appearance
    if (fullGenFields.personality) form.personality = suggested.personality?.trim() || form.personality
    if (fullGenFields.background) form.background = suggested.background?.trim() || form.background
    if (fullGenFields.scenario) form.scenario = suggested.scenario?.trim() || form.scenario
    if (fullGenFields.greeting) form.greeting = suggested.greeting?.trim() || form.greeting
    if (fullGenFields.dialogueExamples) form.dialogueExamples = suggested.dialogueExamples?.trim() || form.dialogueExamples
    if (fullGenFields.description) form.description = suggested.description?.trim() || form.description
    if (fullGenFields.tags) {
      form.tags = (suggested.tags ?? []).map((t) => String(t))
      form.customTags = (suggested.tags ?? []).map((t) => String(t))
    }
    fullGenVisible.value = false
    message.success('人设已自动生成，请检查后保存')
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成失败，请检查模型配置')
  }
}

// ── AI 补充 ──
const ENHANCE_TASK_KEY = 'character-enhance'
const enhanceLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_TASK_KEY))
const enhanceVisible = ref(false)
const enhanceFields = ref<EnhanceFieldDiff[]>([])

async function handleAiEnhance(): Promise<void> {
  if (enhanceLoading.value) return
  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: ENHANCE_TASK_KEY,
        kind: 'character',
        label: 'AI 补充角色',
        description: '正在根据上下文补充角色信息',
        panel: 'characters'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          clientTaskId: appStore.getClientTaskId(),
          task: 'character-enhance',
          settings: appStore.appSettings,
          context: {
            projectId: appStore.currentProject?.id,
            currentForm: { name: form.name, role: form.role, description: form.description, tags: form.tags },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            characterNames: appStore.characters.map((c) => c.name),
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            worldviewEntries: buildAiWorldviewContext(),
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 补充失败，请检查模型配置')
    }

    const suggested = result.result as { name?: string; role?: string; description?: string; tags?: string[] }
    const suggestedTags = Array.isArray(suggested.tags) ? suggested.tags : []

    enhanceFields.value = [
      { key: 'name', label: '角色名称', type: 'text', original: form.name, suggested: suggested.name ?? '', changed: (suggested.name ?? '') !== form.name && Boolean(suggested.name?.trim()) },
      { key: 'role', label: '角色定位', type: 'text', original: form.role, suggested: suggested.role ?? '', changed: (suggested.role ?? '') !== form.role && Boolean(suggested.role?.trim()) },
      { key: 'description', label: '角色简介', type: 'textarea', original: form.description, suggested: suggested.description ?? '', changed: (suggested.description ?? '') !== form.description && Boolean(suggested.description?.trim()) },
      { key: 'tags', label: '角色标签', type: 'tags', original: form.tags, suggested: suggestedTags, changed: JSON.stringify(suggestedTags) !== JSON.stringify(form.tags) && suggestedTags.length > 0 }
    ]
    enhanceVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceApply(accepted: Record<string, string | string[]>): void {
  if (accepted.name != null) form.name = accepted.name as string
  if (accepted.role != null) form.role = accepted.role as string
  if (accepted.description != null) form.description = accepted.description as string
  if (accepted.tags != null) form.tags = accepted.tags as string[]
  enhanceVisible.value = false
}

// 由表单构造一份角色卡对象（用于实时预览与提示词生成）
const previewCard = computed<CharacterCard>(() => ({
  id: editingCharacterId.value ?? 'preview',
  name: form.name,
  role: form.role,
  description: form.description,
  appearance: form.appearance,
  personality: form.personality,
  background: form.background,
  scenario: form.scenario,
  greeting: form.greeting,
  dialogueExamples: form.dialogueExamples,
  avatar: form.avatar,
  tags: form.tags.map((label) => ({ label })),
  customTags: form.customTags,
  projectBinding: form.projectBinding,
  relatedChapterIds: [],
  versions: [],
  createdAt: '',
  updatedAt: ''
}))

function generatePromptFromPreview(): void {
  const prompt = buildCharacterPrompt(previewCard.value)
  promptPreview.value = prompt
  promptVisible.value = true
}

function copyPrompt(): void {
  void window.navigator.clipboard?.writeText(promptPreview.value).catch(() => undefined)
  message.success('已复制到剪贴板')
}

// ── 批量删除 ──
const selectedCharacterIdSet = computed(() => new Set(selectedCharacterIds.value))
const batchDeleteAllCharacters = computed(
  () => filteredCharacters.value.length > 0 && selectedCharacterIds.value.length === filteredCharacters.value.length
)
function toggleSelectCharacter(characterId: string): void {
  selectedCharacterIds.value = selectedCharacterIds.value.includes(characterId)
    ? selectedCharacterIds.value.filter((id) => id !== characterId)
    : [...selectedCharacterIds.value, characterId]
}
function toggleSelectAllCharacters(): void {
  selectedCharacterIds.value =
    batchDeleteAllCharacters.value
      ? []
      : filteredCharacters.value.map((character) => character.id)
}
function handleBatchDeleteCharacters(): void {
  const ids = selectedCharacterIds.value
  if (!ids.length) return
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${ids.length} 个角色吗？删除后角色资料及其关联关系将一并移除，且无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteCharacters(ids)
      selectedCharacterIds.value = []
      message.success(`已删除 ${ids.length} 个角色`)
    }
  })
}
function clearCharacterSelection(): void {
  selectedCharacterIds.value = []
}

watch(
  () => appStore.assistantFocusTarget,
  async (target) => {
    if (!target || target.panel !== 'characters') return
    focusedCharacterId.value = target.entityId
    await nextTick()
    document.querySelector<HTMLElement>(`[data-assistant-focus-id="${target.entityId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      appStore.clearAssistantFocusTarget('characters', target.entityId)
      if (focusedCharacterId.value === target.entityId) {
        focusedCharacterId.value = ''
      }
    }, 2200)
  },
  { immediate: true }
)
</script>

<template>
  <section class="character-panel">
    <div class="section-head">
      <div class="section-title">
        <h2>人物卡片</h2>
        <span class="subtitle">兼容酒馆角色卡 V2</span>
      </div>
      <div class="head-actions">
        <n-button secondary strong @click="handleImportCards">
          <template #icon><Upload :size="16" /></template>
          导入
        </n-button>
        <n-button secondary strong :disabled="!selectedCharacterIds.length" @click="handleBatchExportCards">
          <template #icon><Download :size="16" /></template>
          批量导出
        </n-button>
        <n-button secondary strong @click="appStore.setPanel('relations')">
          <template #icon><Network :size="16" /></template>
          关系组织
        </n-button>
        <n-button secondary strong type="info" :loading="isGenerating" @click="batchVisible = true">
          <template #icon><Sparkles :size="16" /></template>
          批量生成
        </n-button>
        <n-button type="primary" strong @click="handleCreateCharacter">
          <template #icon><Plus :size="16" /></template>
          新建卡片
        </n-button>
      </div>
    </div>

    <div class="catalog-toolbar">
      <div class="catalog-filters">
        <n-input v-model:value="keyword" class="character-search" placeholder="搜索姓名、定位、标签、外貌、性格..." clearable>
          <template #prefix><Search :size="16" /></template>
        </n-input>
        <n-select v-model:value="roleFilter" class="role-filter" :options="roleOptions" placeholder="全部定位" clearable filterable />
        <n-select v-model:value="bindingFilter" class="binding-filter" :options="[{label:'局部',value:'local'},{label:'全局',value:'global'}]" placeholder="全部归属" clearable />
        <n-select v-model:value="tagFilter" class="tag-filter" :options="allCustomTags.map((t)=>({label:t,value:t}))" placeholder="按标签筛选" clearable filterable />
      </div>
      <div class="result-summary">
        <strong>{{ filteredCharacters.length }}</strong>
        <span>/ {{ appStore.characters.length }} 张卡片</span>
      </div>
    </div>

    <BatchDeleteBar
      v-if="filteredCharacters.length > 0"
      :selected-count="selectedCharacterIds.length"
      :total-count="filteredCharacters.length"
      item-label="角色"
      :all-selected="batchDeleteAllCharacters"
      @toggle-all="toggleSelectAllCharacters"
      @delete-selected="handleBatchDeleteCharacters"
      @clear="clearCharacterSelection"
    />

    <div class="character-grid">
      <article
        v-for="character in visibleCharacters"
        :key="character.id"
        class="character-card"
        :class="{ 'assistant-focused': focusedCharacterId === character.id }"
        :data-assistant-focus-id="character.id"
        @click="openEditor(character)"
      >
        <label class="card-check" title="勾选以便批量操作" @click.stop>
          <input type="checkbox" :checked="selectedCharacterIdSet.has(character.id)" @change="toggleSelectCharacter(character.id)" />
        </label>
        <div class="avatar" :style="avatarStyle(character.avatar, character.name)">
          <img v-if="isDataUrl(character.avatar)" :src="character.avatar" alt="" class="avatar-img" />
          <span v-else>{{ character.name.slice(0, 1) }}</span>
        </div>
        <div class="character-info">
          <div class="character-head">
            <div class="character-identity">
              <h3>{{ character.name }}</h3>
              <span v-if="character.role" class="role-label">{{ character.role }}</span>
              <span v-else class="role-label muted">未设置定位</span>
              <n-tag v-if="character.projectBinding === 'global'" size="tiny" type="info" :bordered="false" class="binding-tag">全局</n-tag>
            </div>
            <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, character)">
              <button class="more-button" type="button" title="更多操作" aria-label="更多操作" @click.stop>
                <MoreVertical :size="14" />
              </button>
            </n-dropdown>
          </div>
          <p class="description" :title="character.description">{{ character.description }}</p>
          <div class="tag-row">
            <n-tag v-for="tag in (character.customTags?.length ? character.customTags : character.tags.map(t=>t.label)).slice(0, 3)" :key="tag" size="small">{{ tag }}</n-tag>
            <span v-if="(character.customTags?.length || character.tags.length) > 3" class="tag-overflow">+{{ (character.customTags?.length || character.tags.length) - 3 }}</span>
          </div>
          <div class="card-actions">
            <button class="card-action-btn" type="button" title="查看版本快照" @click.stop="openSnapshots(character)"><History :size="13" /></button>
            <button class="card-action-btn" type="button" title="关联章节" @click.stop="openChapterLinks(character)"><BookOpenText :size="13" /></button>
            <button class="card-action-btn" type="button" title="生成提示词" @click.stop="handleMenuSelect('generatePrompt', character)"><FileJson :size="13" /></button>
            <button class="card-action-btn" type="button" title="导出 JSON" @click.stop="exportCard(character, 'json')"><Download :size="13" /></button>
            <button class="card-action-btn" type="button" title="导出 PNG 卡片" @click.stop="exportCard(character, 'png')"><ImageIcon :size="13" /></button>
          </div>
        </div>
      </article>
    </div>

    <div v-if="filteredCharacters.length === 0" class="arc-empty-state">
      {{ appStore.characters.length === 0 ? '还没有人物卡片，先新建一张。' : '没有匹配当前筛选条件的卡片。' }}
    </div>

    <BatchGenerateDialog
      :show="batchVisible"
      title="批量生成角色"
      description="按项目现有设定连续生成角色，系统会自动分批并跳过重名结果。"
      item-label="角色"
      :loading="isGenerating"
      :progress="batchProgress"
      @close="batchVisible = false"
      @background="batchVisible = false"
      @interrupt="handleInterruptBatch"
      @submit="handleGenerateCharacter"
    />

    <n-modal :show="editorVisible" preset="card" class="arc-editor-modal-wide" :title="editingCharacterId ? '编辑人物卡片' : '新建人物卡片'" :bordered="false" style="width: min(980px, 94vw)" @close="editorVisible = false">
      <div class="editor-layout">
        <div class="editor-form arc-scrollbar">
          <div class="avatar-upload">
            <div class="avatar" :style="avatarStyle(form.avatar, form.name || '新角色')">
              <img v-if="isDataUrl(form.avatar)" :src="form.avatar" alt="" class="avatar-img" />
              <span v-else>{{ (form.name || '新').slice(0, 1) }}</span>
            </div>
            <div class="avatar-actions">
              <n-button size="small" secondary strong @click="handlePickAvatar">
                <template #icon><Camera :size="14" /></template>
                选择图片
              </n-button>
              <label class="avatar-file-label">
                <input type="file" accept="image/*" class="avatar-file-input" @change="handleAvatarFile" />
                本地上传
              </label>
              <n-button size="small" secondary strong :loading="isGeneratingAvatar" @click="handleGenerateAvatar">
                <template #icon><Sparkles :size="14" /></template>
                AI 生成图片
              </n-button>
              <n-button v-if="isDataUrl(form.avatar)" size="small" secondary strong :loading="isRecognizingImage" @click="handleRecognizeImage">
                <template #icon><ScanEye :size="14" /></template>
                AI 识别人设
              </n-button>
              <n-button v-if="form.avatar" size="small" quaternary @click="form.avatar = ''">移除</n-button>
            </div>
          </div>

          <n-form label-placement="top" class="card-form">
            <div class="form-row">
              <n-form-item label="角色名称" class="form-col">
                <n-input v-model:value="form.name" placeholder="例如：李雷 / 艾达" />
              </n-form-item>
              <n-form-item label="角色定位" class="form-col">
                <n-input v-model:value="form.role" placeholder="例如：男主 / 情报中间人" />
              </n-form-item>
            </div>
            <n-form-item label="项目归属">
              <n-radio-group v-model:value="form.projectBinding" size="small">
                <n-radio-button value="local">局部（仅本项目）</n-radio-button>
                <n-radio-button value="global">全局（跨项目共享）</n-radio-button>
              </n-radio-group>
            </n-form-item>
            <n-form-item label="角色标签">
              <n-dynamic-tags v-model:value="form.tags" />
            </n-form-item>
            <n-form-item label="自定义标签">
              <n-dynamic-tags v-model:value="form.customTags" />
            </n-form-item>
            <n-form-item label="外貌描述">
              <n-input v-model:value="form.appearance" type="textarea" :rows="2" placeholder="五官、体态、服饰气质..." />
            </n-form-item>
            <n-form-item label="性格">
              <n-input v-model:value="form.personality" type="textarea" :rows="2" placeholder="核心性格与内在矛盾..." />
            </n-form-item>
            <n-form-item label="背景故事">
              <n-input v-model:value="form.background" type="textarea" :rows="3" placeholder="出身、经历与关键转折..." />
            </n-form-item>
            <n-form-item label="开局场景">
              <n-input v-model:value="form.scenario" type="textarea" :rows="2" placeholder="角色登场时的初始场景..." />
            </n-form-item>
            <n-form-item label="开场白">
              <n-input v-model:value="form.greeting" type="textarea" :rows="2" placeholder="角色开场的第一句话..." />
            </n-form-item>
            <n-form-item label="对话示例">
              <n-input v-model:value="form.dialogueExamples" type="textarea" :rows="4" placeholder="user:...&#10;char:..." />
            </n-form-item>
            <n-form-item label="角色简介">
              <n-input v-model:value="form.description" type="textarea" :rows="3" placeholder="补充角色背景、动机和冲突..." />
            </n-form-item>
          </n-form>
        </div>

        <div class="editor-preview">
          <div class="preview-head">
            <span>实时预览</span>
            <n-button size="tiny" secondary @click="generatePromptFromPreview">生成提示词</n-button>
          </div>
          <div class="preview-card">
            <div class="preview-avatar" :style="avatarStyle(form.avatar, form.name || '新')">
              <img v-if="isDataUrl(form.avatar)" :src="form.avatar" alt="" />
              <span v-else>{{ (form.name || '新').slice(0, 1) }}</span>
            </div>
            <h4>{{ form.name || '未命名角色' }}</h4>
            <span class="preview-role">{{ form.role || '待设定定位' }}</span>
            <p>{{ form.description || '暂无简介' }}</p>
            <div v-if="form.personality" class="preview-section"><b>性格：</b>{{ form.personality }}</div>
            <div v-if="form.background" class="preview-section"><b>背景：</b>{{ form.background }}</div>
            <div v-if="form.greeting" class="preview-section preview-greeting">💬 {{ form.greeting }}</div>
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <n-button size="small" secondary strong :loading="enhanceLoading" @click="handleAiEnhance">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button size="small" secondary strong @click="fullGenVisible = true">
            <template #icon><Sparkles :size="14" /></template>
            AI 生成人设
          </n-button>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitCharacter">
            {{ editingCharacterId ? '保存修改' : '创建卡片' }}
          </n-button>
        </div>
      </div>
      <template #footer><span /></template>
    </n-modal>

    <!-- AI 完整人设生成 -->
    <n-modal :show="fullGenVisible" preset="card" title="AI 生成人物卡片" :bordered="false" style="width: min(620px, 92vw)" @close="fullGenVisible = false">
      <p class="fullgen-hint">输入一段角色设定要点，选择需要生成的字段，AI 将自动填充勾选的人设字段（默认全部勾选）。</p>
      <div class="fullgen-fields">
        <div class="fullgen-fields-head">
          <strong>生成字段</strong>
          <label class="fullgen-toggle-all">
            <input type="checkbox" :checked="allFullGenFieldsSelected" @change="toggleAllFullGenFields" />
            <span>{{ allFullGenFieldsSelected ? '取消全选' : '全选' }}</span>
          </label>
        </div>
        <div class="fullgen-field-grid">
          <label v-for="opt in FULL_GEN_FIELD_OPTIONS" :key="opt.key" class="fullgen-field-item">
            <input
              type="checkbox"
              :checked="fullGenFields[opt.key]"
              :disabled="opt.key === 'name'"
              @change="fullGenFields[opt.key] = !fullGenFields[opt.key]"
            />
            <span>{{ opt.label }}</span>
            <small v-if="opt.key === 'name'" class="required-tag">必选</small>
          </label>
        </div>
      </div>
      <n-input v-model:value="fullGenSetting" type="textarea" :rows="4" placeholder="例如：一名身世神秘的古代女医师，表面温和实则背负复仇使命，擅长用毒..." />
      <div class="fullgen-actions">
        <n-button round @click="fullGenVisible = false">取消</n-button>
        <n-button type="primary" round :loading="fullGenLoading" @click="handleFullGenerate">开始生成</n-button>
      </div>
      <template #footer><span /></template>
    </n-modal>

    <!-- 提示词预览 -->
    <n-modal :show="promptVisible" preset="card" title="生成提示词" :bordered="false" style="width: min(620px, 92vw)" @close="promptVisible = false">
      <pre class="prompt-pre">{{ promptPreview }}</pre>
      <div class="fullgen-actions">
        <n-button type="primary" round @click="copyPrompt">复制提示词</n-button>
        <n-button round @click="promptVisible = false">关闭</n-button>
      </div>
      <template #footer><span /></template>
    </n-modal>

    <!-- 版本快照 -->
    <n-modal :show="snapshotVisible" preset="card" :title="`版本快照 · ${snapshotCharacterRef?.name ?? ''}`" :bordered="false" style="width: min(560px, 92vw)" @close="snapshotVisible = false">
      <div v-if="(snapshotCharacterRef?.versions ?? []).length === 0" class="arc-empty-state">暂无快照，可在卡片菜单中「保存快照」。</div>
      <div v-else class="snapshot-list">
        <div v-for="version in snapshotCharacterRef?.versions" :key="version.id" class="snapshot-item">
          <div class="snapshot-meta">
            <strong>{{ version.note }}</strong>
            <span>{{ new Date(version.createdAt).toLocaleString() }}</span>
          </div>
          <div class="snapshot-actions">
            <n-button size="tiny" type="primary" secondary @click="restoreSnapshot(version.id)">回滚</n-button>
            <n-button size="tiny" quaternary @click="deleteSnapshot(version.id)">删除</n-button>
          </div>
        </div>
      </div>
      <template #footer><span /></template>
    </n-modal>

    <!-- 章节关联 -->
    <n-modal :show="chapterLinkVisible" preset="card" :title="`关联章节 · ${chapterLinkCharacterRef?.name ?? ''}`" :bordered="false" style="width: min(560px, 92vw)" @close="chapterLinkVisible = false">
      <p class="fullgen-hint">勾选该角色出场的章节，便于快速回溯剧情。</p>
      <div v-if="chapterOptions.length === 0" class="arc-empty-state">当前项目还没有章节。</div>
      <div v-else class="chapter-link-list">
        <label v-for="chapter in chapterOptions" :key="chapter.id" class="chapter-link-item">
          <input type="checkbox" :checked="chapter.linked" @change="toggleChapter(chapter.id)" />
          <span>{{ chapter.title }}</span>
        </label>
      </div>
      <template #footer><span /></template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceVisible"
      :fields="enhanceFields"
      :loading="enhanceLoading"
      @apply="handleEnhanceApply"
      @close="enhanceVisible = false"
    />
  </section>
</template>

<style scoped>
.character-panel {
  max-width: 1240px;
  margin: 0 auto;
  min-width: 0;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
  flex-wrap: wrap;
}
.section-title { display: flex; align-items: baseline; gap: 10px; }
.section-title h2 { margin: 0; color: var(--arc-text-primary); font-size: 24px; font-weight: 700; }
.subtitle { color: var(--arc-text-hint); font-size: 12px; }
.head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.catalog-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-mix); padding: 10px; }
.catalog-filters { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.character-search { width: min(300px, 30vw); }
.role-filter { width: 150px; }
.binding-filter { width: 120px; }
.tag-filter { width: 160px; }
.result-summary { display: inline-flex; align-items: baseline; flex-shrink: 0; gap: 4px; color: var(--arc-text-hint); font-size: 12px; white-space: nowrap; }
.result-summary strong { color: var(--arc-text-primary); font-size: 15px; }
.character-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.character-card { position: relative; display: flex; min-height: 158px; gap: 12px; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-surface); padding: 14px; cursor: pointer; transition: border-color 0.16s ease, background 0.16s ease; }
.character-card.assistant-focused { border-color: color-mix(in srgb, var(--arc-accent) 78%, white 22%); box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-accent) 16%, transparent); }
.character-card:hover { border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border)); background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface)); }
.character-card:hover h3 { color: var(--arc-primary); }
.card-check { display: inline-flex; align-items: flex-start; justify-content: center; padding-top: 2px; flex-shrink: 0; }
.card-check input[type='checkbox'] { width: 15px; height: 15px; accent-color: var(--arc-danger); cursor: pointer; }
.avatar { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 6px; overflow: hidden; position: relative; }
.avatar-img { width: 100%; height: 100%; object-fit: cover; }
.avatar span { color: inherit; font-size: 18px; font-weight: 750; }
.character-info { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.character-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.character-identity { min-width: 0; }
.character-identity h3 { margin: 0; overflow: hidden; color: var(--arc-text-primary); font-size: 16px; font-weight: 700; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.role-label { display: block; margin-top: 2px; overflow: hidden; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.role-label.muted { color: var(--arc-text-hint); }
.binding-tag { margin-left: 6px; }
.more-button { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--arc-text-hint); cursor: pointer; }
.more-button:hover { background: var(--arc-bg-mix); color: var(--arc-text-secondary); }
.tag-row { display: flex; min-height: 22px; align-items: center; flex-wrap: nowrap; gap: 6px; margin-top: 8px; overflow: hidden; }
.tag-overflow { flex-shrink: 0; color: var(--arc-text-hint); font-size: 12px; }
.description { display: -webkit-box; min-height: 39px; margin: 8px 0 4px; overflow: hidden; color: var(--arc-text-secondary); font-size: 13px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.card-actions { display: flex; gap: 4px; margin-top: auto; }
.card-action-btn { display: inline-flex; width: 26px; height: 26px; align-items: center; justify-content: center; border: 1px solid var(--arc-border); border-radius: 4px; background: var(--arc-bg-mix); color: var(--arc-text-hint); cursor: pointer; }
.card-action-btn:hover { color: var(--arc-primary); border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border)); }

.editor-layout { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
.editor-form { max-height: 64vh; overflow-y: auto; padding-right: 8px; }
.avatar-upload { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.avatar-upload .avatar { width: 72px; height: 72px; font-size: 26px; }
.avatar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.avatar-file-label { display: inline-flex; align-items: center; padding: 2px 12px; height: 30px; border: 1px solid var(--arc-border); border-radius: 3px; background: var(--arc-bg-mix); color: var(--arc-text-secondary); font-size: 13px; cursor: pointer; }
.avatar-file-label:hover { color: var(--arc-primary); }
.avatar-file-input { display: none; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.editor-preview { border-left: 1px solid var(--arc-border); padding-left: 18px; }
.preview-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; color: var(--arc-text-hint); font-size: 12px; font-weight: 600; }
.preview-card { border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-mix); padding: 16px; }
.preview-avatar { display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 8px; overflow: hidden; font-size: 24px; font-weight: 700; margin-bottom: 10px; }
.preview-avatar img { width: 100%; height: 100%; object-fit: cover; }
.preview-card h4 { margin: 0; font-size: 16px; color: var(--arc-text-primary); }
.preview-role { color: var(--arc-text-secondary); font-size: 12px; }
.preview-card p { color: var(--arc-text-secondary); font-size: 13px; line-height: 1.5; }
.preview-section { margin-top: 8px; font-size: 12px; color: var(--arc-text-secondary); line-height: 1.5; }
.preview-section b { color: var(--arc-text-primary); }
.preview-greeting { color: var(--arc-primary); }
.fullgen-hint { color: var(--arc-text-secondary); font-size: 13px; margin-bottom: 10px; }
.fullgen-fields { border: 1px solid var(--arc-border); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.fullgen-fields-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.fullgen-fields-head strong { color: var(--arc-text-primary); font-size: 13px; }
.fullgen-toggle-all { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--arc-primary); cursor: pointer; }
.fullgen-toggle-all input { accent-color: var(--arc-primary); }
.fullgen-field-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }
.fullgen-field-item { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--arc-border); border-radius: 6px; padding: 6px 8px; font-size: 12px; color: var(--arc-text-secondary); cursor: pointer; transition: border-color 0.16s ease, background 0.16s ease; }
.fullgen-field-item:hover { border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border)); }
.fullgen-field-item input { accent-color: var(--arc-primary); }
.fullgen-field-item .required-tag { color: var(--arc-primary); font-size: 10px; font-weight: 800; }
.fullgen-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.prompt-pre { white-space: pre-wrap; word-break: break-word; max-height: 55vh; overflow-y: auto; background: var(--arc-bg-mix); border: 1px solid var(--arc-border); border-radius: 6px; padding: 14px; font-size: 13px; line-height: 1.6; color: var(--arc-text-secondary); }
.snapshot-list { display: flex; flex-direction: column; gap: 8px; max-height: 50vh; overflow-y: auto; }
.snapshot-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--arc-border); border-radius: 6px; padding: 10px 12px; }
.snapshot-meta { display: flex; flex-direction: column; }
.snapshot-meta strong { color: var(--arc-text-primary); font-size: 13px; }
.snapshot-meta span { color: var(--arc-text-hint); font-size: 11px; }
.snapshot-actions { display: flex; gap: 6px; }
.chapter-link-list { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; }
.chapter-link-item { display: flex; align-items: center; gap: 8px; border: 1px solid var(--arc-border); border-radius: 6px; padding: 8px 10px; font-size: 13px; color: var(--arc-text-secondary); cursor: pointer; }
.chapter-link-item input { accent-color: var(--arc-primary); }
.arc-empty-state { padding: 40px 20px; text-align: center; color: var(--arc-text-hint); }

@media (max-width: 860px) {
  .section-head { align-items: flex-start; }
  .head-actions { width: 100%; justify-content: flex-start; }
  .catalog-toolbar { align-items: flex-end; }
  .editor-layout { grid-template-columns: 1fr; }
  .editor-preview { border-left: none; padding-left: 0; border-top: 1px solid var(--arc-border); padding-top: 16px; }
}
@media (max-width: 720px) {
  .form-row { grid-template-columns: 1fr; }
  .catalog-filters { flex-direction: column; align-items: stretch; }
  .role-filter, .binding-filter, .tag-filter, .character-search { width: 100%; }
  .character-grid { grid-template-columns: 1fr; }
}
</style>
