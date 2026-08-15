<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { BookOpen, FolderOpen, Layers, Search, X } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

export interface PickedReference {
  kind: 'chapter' | 'volume' | 'resource' | 'resource-dir'
  id: string
  label: string
  /** 资源引用专用：相对资源根目录的路径。 */
  path?: string
}

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm', refs: PickedReference[]): void
}>()

const appStore = useAppStore()

const query = ref('')
const selected = ref<Record<string, PickedReference>>({})
const tab = ref<'volume' | 'chapter' | 'resource'>('volume')

// 展开的分卷 id 集合
const expandedVolumes = ref<Set<string>>(new Set())

watch(
  () => props.visible,
  (v) => {
    if (v) {
      query.value = ''
      selected.value = {}
      tab.value = 'volume'
      expandedVolumes.value = new Set(appStore.outlineVolumes.map((vol) => vol.id))
    }
  }
)

// ── 资源区（文件/文件夹）引用 ──
interface ResourceEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}
const projectId = computed(() => appStore.currentProject?.id ?? '')
// 当前展开的资源目录路径集合（'' 表示资源根目录）
const expandedResourceDirs = ref<Set<string>>(new Set(['']))
// 资源区根目录条目
const resourceTree = ref<ResourceEntry[]>([])
// 展开目录下的子条目缓存
const resourceChildren = ref<Record<string, ResourceEntry[]>>({})
const resourceLoading = ref(false)
const resourceError = ref('')

/** 加载某个资源目录的条目列表（相对资源根目录路径，'' 表示根）。 */
async function loadResourceDir(path: string): Promise<ResourceEntry[]> {
  if (!projectId.value) return []
  const res = await window.characterArc.projectResourceList({ projectId: projectId.value, path })
  if (!res?.success) {
    throw new Error(res?.error ?? '读取资源失败')
  }
  return (res.entries ?? []).map((e) => ({
    name: e.name,
    path: e.path,
    isDirectory: e.isDirectory,
    isFile: e.isFile
  }))
}

/** 加载资源区根目录。 */
async function loadResourceRoot(): Promise<void> {
  if (!projectId.value) return
  resourceLoading.value = true
  resourceError.value = ''
  try {
    resourceTree.value = await loadResourceDir('')
  } catch (e) {
    resourceError.value = e instanceof Error ? e.message : '读取资源失败'
  } finally {
    resourceLoading.value = false
  }
}

/** 展开/收起某个资源文件夹：首次展开时异步加载其子条目。 */
async function toggleResourceDir(dir: ResourceEntry): Promise<void> {
  const set = new Set(expandedResourceDirs.value)
  if (set.has(dir.path)) {
    set.delete(dir.path)
  } else {
    set.add(dir.path)
    if (!resourceChildren.value[dir.path]) {
      try {
        resourceChildren.value[dir.path] = await loadResourceDir(dir.path)
      } catch {
        resourceChildren.value[dir.path] = []
      }
    }
  }
  expandedResourceDirs.value = set
}

function isResourceDirExpanded(path: string): boolean {
  return expandedResourceDirs.value.has(path)
}

function resourceChildrenOf(path: string): ResourceEntry[] {
  return resourceChildren.value[path] ?? []
}

/** 资源条目筛选（按名称匹配）。 */
function resourceMatches(entry: ResourceEntry): boolean {
  const q = query.value.trim().toLowerCase()
  return !q || entry.name.toLowerCase().includes(q)
}

function resourceSelectionKey(entry: ResourceEntry): string {
  return `${entry.isDirectory ? 'resource-dir' : 'resource'}:${entry.path}`
}

function isResourceSelected(entry: ResourceEntry): boolean {
  return !!selected.value[resourceSelectionKey(entry)]
}

function toggleResourceSelect(entry: ResourceEntry): void {
  const key = resourceSelectionKey(entry)
  const item: PickedReference = {
    kind: entry.isDirectory ? 'resource-dir' : 'resource',
    id: entry.path,
    label: entry.name,
    path: entry.path
  }
  if (selected.value[key]) {
    const next = { ...selected.value }
    delete next[key]
    selected.value = next
  } else {
    selected.value = { ...selected.value, [key]: item }
  }
}

// 切到资源 tab 时加载资源根目录
watch(
  () => tab.value,
  (t) => {
    if (t === 'resource' && resourceTree.value.length === 0 && !resourceLoading.value) {
      void loadResourceRoot()
    }
  }
)

function close(): void {
  emit('update:visible', false)
}

function toggleSelect(item: PickedReference): void {
  const key = `${item.kind}:${item.id}`
  if (selected.value[key]) {
    const next = { ...selected.value }
    delete next[key]
    selected.value = next
  } else {
    selected.value = { ...selected.value, [key]: item }
  }
}

function isSelected(item: PickedReference): boolean {
  return !!selected.value[`${item.kind}:${item.id}`]
}

function toggleVolumeExpand(id: string): void {
  const next = new Set(expandedVolumes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedVolumes.value = next
}

function confirm(): void {
  const refs = Object.values(selected.value)
  emit('confirm', refs)
  close()
}

const filteredVolumes = computed(() => {
  const q = query.value.trim().toLowerCase()
  const volumes = appStore.outlineVolumes.filter((vol) => !q || vol.title.toLowerCase().includes(q))
  const chapters = appStore.chapters.filter((ch) => {
    if (q && !ch.title.toLowerCase().includes(q)) return false
    return true
  })
  return volumes
    .map((vol) => ({
      volume: vol,
      chapters: chapters.filter((ch) => ch.volumeId === vol.id)
    }))
    .concat(
      chapters.filter((ch) => !appStore.outlineVolumes.some((vol) => vol.id === ch.volumeId)).length
        ? [{
            volume: { id: '__unassigned__', title: '未分卷', wordTarget: '', summary: '' },
            chapters: chapters.filter((ch) => !appStore.outlineVolumes.some((vol) => vol.id === ch.volumeId))
          }]
        : []
    )
    .filter((group) => group.chapters.length > 0 || group.volume.id !== '__unassigned__')
})

const filteredChapters = computed(() => {
  const q = query.value.trim().toLowerCase()
  return appStore.chapters.filter((ch) => !q || ch.title.toLowerCase().includes(q))
})

const selectedCount = computed(() => Object.keys(selected.value).length)
</script>

<template>
  <NModal
    :show="props.visible"
    :mask-closable="true"
    preset="card"
    class="ref-picker-modal"
    :style="{ width: '520px', maxWidth: '92vw' }"
    title="添加引用"
    @update:show="(v: boolean) => emit('update:visible', v)"
  >
    <div class="ref-picker">
      <div class="ref-search">
        <Search :size="14" />
        <input
          v-model="query"
          placeholder="搜索分卷、章节或资源文件"
          @keydown.esc="close"
        />
      </div>

      <div class="ref-tabs">
        <button
          type="button"
          :class="{ active: tab === 'volume' }"
          @click="tab = 'volume'"
        >
          <Layers :size="13" /> 分卷
        </button>
        <button
          type="button"
          :class="{ active: tab === 'chapter' }"
          @click="tab = 'chapter'"
        >
          <BookOpen :size="13" /> 章节
        </button>
        <button
          type="button"
          :class="{ active: tab === 'resource' }"
          @click="tab = 'resource'"
          title="添加项目资源区中的文件或文件夹"
        >
          <FolderOpen :size="13" /> 资源
        </button>
      </div>

      <div class="ref-list">
        <!-- 分卷视图：勾选分卷 = 引用整卷，展开可勾选单个章节 -->
        <template v-if="tab === 'volume'">
          <div
            v-for="group in filteredVolumes"
            :key="group.volume.id"
            class="ref-volume"
          >
            <div class="ref-volume-head">
              <label class="ref-check">
                <input
                  type="checkbox"
                  :checked="isSelected({ kind: 'volume', id: group.volume.id, label: group.volume.title })"
                  @change="toggleSelect({ kind: 'volume', id: group.volume.id, label: group.volume.title })"
                />
                <span class="ref-label">{{ group.volume.title }}</span>
                <em class="ref-count">{{ group.chapters.length }} 章</em>
              </label>
              <button
                type="button"
                class="ref-expand"
                @click="toggleVolumeExpand(group.volume.id)"
              >
                {{ expandedVolumes.has(group.volume.id) ? '收起' : '展开' }}
              </button>
            </div>
            <div v-if="expandedVolumes.has(group.volume.id)" class="ref-chapters">
              <label
                v-for="ch in group.chapters"
                :key="ch.id"
                class="ref-check ref-chapter"
              >
                <input
                  type="checkbox"
                  :checked="isSelected({ kind: 'chapter', id: ch.id, label: ch.title })"
                  @change="toggleSelect({ kind: 'chapter', id: ch.id, label: ch.title })"
                />
                <span class="ref-label">{{ ch.title }}</span>
              </label>
            </div>
          </div>
        </template>

        <!-- 章节视图：平铺所有章节多选 -->
        <template v-else-if="tab === 'chapter'">
          <label
            v-for="ch in filteredChapters"
            :key="ch.id"
            class="ref-check ref-chapter"
          >
            <input
              type="checkbox"
              :checked="isSelected({ kind: 'chapter', id: ch.id, label: ch.title })"
              @change="toggleSelect({ kind: 'chapter', id: ch.id, label: ch.title })"
            />
            <span class="ref-label">{{ ch.title }}</span>
          </label>
        </template>

        <!-- 资源视图：展示项目资源区文件/文件夹，支持展开文件夹并多选 -->
        <template v-else>
          <div v-if="resourceLoading" class="ref-empty">正在加载资源…</div>
          <div v-else-if="resourceError" class="ref-empty">{{ resourceError }}</div>
          <div v-else-if="resourceTree.length === 0" class="ref-empty">资源区暂无内容，请先在「项目资源」中新建文件或文件夹。</div>
          <template v-else>
            <div
              v-for="entry in resourceTree.filter(resourceMatches)"
              :key="entry.path"
              class="ref-resource"
            >
              <div class="ref-resource-row">
                <button
                  v-if="entry.isDirectory"
                  type="button"
                  class="ref-resource-expand"
                  :title="isResourceDirExpanded(entry.path) ? '收起' : '展开'"
                  @click="toggleResourceDir(entry)"
                >
                  {{ isResourceDirExpanded(entry.path) ? '▾' : '▸' }}
                </button>
                <span v-else class="ref-resource-expand"></span>
                <label class="ref-check">
                  <input
                    type="checkbox"
                    :checked="isResourceSelected(entry)"
                    @change="toggleResourceSelect(entry)"
                  />
                  <FolderOpen v-if="entry.isDirectory" :size="14" class="ref-resource-folder" />
                  <span class="ref-label">{{ entry.name }}</span>
                  <em v-if="entry.isDirectory" class="ref-count">文件夹</em>
                  <em v-else class="ref-count">文件</em>
                </label>
              </div>
              <div v-if="entry.isDirectory && isResourceDirExpanded(entry.path)" class="ref-resource-children">
                <div
                  v-for="child in resourceChildrenOf(entry.path).filter(resourceMatches)"
                  :key="child.path"
                  class="ref-resource-row ref-resource-child"
                >
                  <button
                    v-if="child.isDirectory"
                    type="button"
                    class="ref-resource-expand"
                    @click="toggleResourceDir(child)"
                  >
                    {{ isResourceDirExpanded(child.path) ? '▾' : '▸' }}
                  </button>
                  <span v-else class="ref-resource-expand"></span>
                  <label class="ref-check">
                    <input
                      type="checkbox"
                      :checked="isResourceSelected(child)"
                      @change="toggleResourceSelect(child)"
                    />
                    <FolderOpen v-if="child.isDirectory" :size="14" class="ref-resource-folder" />
                    <span class="ref-label">{{ child.name }}</span>
                  </label>
                </div>
                <div v-if="resourceChildrenOf(entry.path).length === 0" class="ref-empty ref-empty-inline">此文件夹为空</div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <div class="ref-foot">
        <span class="ref-selected">已选 {{ selectedCount }} 项</span>
        <div class="ref-actions">
          <NButton size="small" quaternary @click="close">
            <template #icon><X :size="13" /></template> 取消
          </NButton>
          <NButton size="small" type="primary" :disabled="selectedCount === 0" @click="confirm">
            添加引用
          </NButton>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.ref-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.ref-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  color: var(--arc-text-hint);
}
.ref-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--arc-text-primary);
}
.ref-tabs {
  display: flex;
  gap: 6px;
}
.ref-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ref-tabs button.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
}
.ref-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ref-volume {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  overflow: hidden;
}
.ref-volume-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  background: var(--arc-bg-weak);
}
.ref-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  min-width: 0;
}
.ref-check input {
  accent-color: var(--arc-primary);
  flex: 0 0 auto;
}
.ref-label {
  font-size: 12.5px;
  color: var(--arc-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-count {
  font-style: normal;
  font-size: 10.5px;
  color: var(--arc-text-hint);
}
.ref-expand {
  border: none;
  background: transparent;
  color: var(--arc-primary);
  font-size: 11.5px;
  cursor: pointer;
  flex: 0 0 auto;
}
.ref-chapters {
  padding: 2px 8px 8px 26px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ref-chapter {
  padding: 3px 0;
}
.ref-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ref-selected {
  font-size: 12px;
  color: var(--arc-text-secondary);
}
.ref-actions {
  display: flex;
  gap: 6px;
}
/* ── 资源视图 ── */
.ref-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}
.ref-empty-inline {
  padding: 8px 12px;
  font-size: 12px;
}
.ref-resource {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  overflow: hidden;
}
.ref-resource-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
}
.ref-resource-row:hover {
  background: var(--arc-bg-weak);
}
.ref-resource-child {
  padding-left: 26px;
}
.ref-resource-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
}
.ref-resource-folder {
  color: var(--arc-accent, #3b82f6);
  flex: 0 0 auto;
}
.ref-resource-children {
  padding: 2px 8px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px dashed var(--arc-border);
}
</style>
