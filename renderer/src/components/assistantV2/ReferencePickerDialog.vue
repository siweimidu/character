<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { BookOpen, Layers, Search, X } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

export interface PickedReference {
  kind: 'chapter' | 'volume'
  id: string
  label: string
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
const tab = ref<'volume' | 'chapter'>('volume')

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
          placeholder="搜索分卷或章节"
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
        <template v-else>
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
</style>
