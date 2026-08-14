<script setup lang="ts">
/**
 * AgentModuleManager · 全局智能体能力模块管理器
 *
 * 展示全局智能体的全部能力模块（文件系统、代码执行、MCP、语音、浏览器等），
 * 让用户像开关插件一样独立启停每种能力。体现「everything is a plugin」的设计理念。
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  AppWindow,
  BookOpen,
  Box,
  Film,
  FolderTree,
  Globe,
  Info,
  Mic,
  Network,
  Plug,
  Puzzle,
  Terminal,
  Users
} from 'lucide-vue-next'
import type { AgentModuleRuntime } from '@shared/agent-modules'

const message = useMessage()

const emit = defineEmits<{
  (e: 'change'): void
}>()

const modules = ref<AgentModuleRuntime[]>([])
const loading = ref(false)

const iconMap: Record<string, unknown> = {
  FolderTree,
  Terminal,
  Globe,
  Plug,
  Mic,
  AppWindow,
  Film,
  BookOpen,
  Users,
  Network,
  Puzzle,
  Box
}

/** 各模块的使用说明（如何调用 / 如何触发）。 */
const usageHintMap: Record<string, { hint: string; example: string }> = {
  'filesystem.workspace': {
    hint: '自动启用，在对话中直接要求「读取/写入/搜索项目文件」即可。',
    example: '例：帮我读一下 chapter1.md'
  },
  'filesystem.system': {
    hint: '启用后在对话中要求「读取/写入电脑任意路径的文件」即可。',
    example: '例：读取 C:\\Users\\me\\notes.txt'
  },
  'exec.shell': {
    hint: '启用后在对话中要求「运行命令 / 执行脚本」即可。',
    example: '例：用 python 写个脚本统计这些文本的字数'
  },
  'mcp.market': {
    hint: '接入远程 mcp.soul 或本地 MCP 服务器，通过 MCP 工具读写小说项目文件。',
    example: '例：用 MCP 工具读取章节 / 更新人物卡'
  },
  'speech.asr': {
    hint: '启用后输入框底部出现语音按钮，点击即可语音输入。',
    example: '例：点击 🎤 按钮开始录音转文字'
  },
  'browser.ego': {
    hint: '启用后在对话中要求「打开网页 / 操作浏览器」即可。',
    example: '例：帮我打开 google.com 搜索「写作技巧」'
  },
  'automation.desktop': {
    hint: '启用后在对话中要求「打开/操作某个应用」即可（受权限门控）。',
    example: '例：帮我打开微信并给某某发消息'
  },
  'multimedia.video': {
    hint: '启用后在对话中要求「剪辑/转换视频文件」即可。',
    example: '例：把这个 mp4 剪掉前 10 秒'
  },
  'knowledge.memory': {
    hint: '自动启用，通过创作记忆、知识文档和项目检索自动生效。',
    example: '例：帮我整理当前项目的创作记忆'
  },
  'delegate.subagent': {
    hint: '自动启用，在对话中要求「并行处理多个任务」时自动触发。',
    example: '例：同时帮我完善三个人物的设定'
  },
  'network.http': {
    hint: '启用后在对话中要求「抓取网页 / 调用 API」即可。',
    example: '例：帮我抓取这个网页的内容'
  },
  'plugin.market': {
    hint: '启用后从插件市场导入的插件能力自动生效。',
    example: '例：在插件市场导入后，在对话中按插件说明使用'
  }
}

const riskLabels: Record<string, { text: string; cls: string }> = {
  low: { text: '低风险', cls: 'risk-low' },
  medium: { text: '中风险', cls: 'risk-med' },
  high: { text: '高风险', cls: 'risk-high' },
  critical: { text: '危险', cls: 'risk-crit' }
}

async function loadModules(): Promise<void> {
  loading.value = true
  try {
    modules.value = await window.characterArc.agentModules.list()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载模块失败')
  } finally {
    loading.value = false
  }
}

async function toggleModule(mod: AgentModuleRuntime): Promise<void> {
  const next = !mod.enabled
  // 高危/危险模块启用前二次确认
  if (next && (mod.risk === 'high' || mod.risk === 'critical')) {
    const confirmed = window.confirm(
      `启用「${mod.name}」将授予智能体${mod.risk === 'critical' ? '高危' : '较高'}权限，可能影响系统文件。确定启用吗？`
    )
    if (!confirmed) return
  }
  try {
    await window.characterArc.agentModules.setEnabled({ id: mod.id, enabled: next })
    mod.enabled = next
    message.success(next ? `已启用「${mod.name}」` : `已停用「${mod.name}」`)
    emit('change')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '切换模块失败')
  }
}

onMounted(loadModules)

defineExpose({ loadModules })
</script>

<template>
  <div class="agent-modules">
    <div class="am-header">
      <div class="am-title">能力模块</div>
      <span class="am-sub">像插件一样开关智能体的能力</span>
    </div>

    <div v-if="loading" class="am-empty">加载中…</div>
    <div v-else-if="modules.length === 0" class="am-empty">暂无模块</div>

    <div v-else class="am-list">
      <div
        v-for="mod in modules"
        :key="mod.id"
        class="am-item"
        :class="{ disabled: !mod.enabled }"
      >
        <div class="am-icon">
          <component :is="iconMap[mod.icon] ?? Box" :size="16" />
        </div>
        <div class="am-body">
          <div class="am-name">
            <span class="am-name-text" :title="mod.name">{{ mod.name }}</span>
            <span
              class="am-risk"
              :class="riskLabels[mod.risk]?.cls ?? 'risk-low'"
            >{{ riskLabels[mod.risk]?.text ?? mod.risk }}</span>
          </div>
          <div class="am-desc">{{ mod.description }}</div>
          <div class="am-usage" :class="{ active: mod.enabled }">
            <Info :size="11" />
            <span>{{ usageHintMap[mod.id]?.hint ?? '在对话中直接描述需求即可调用。' }}</span>
          </div>
          <div v-if="mod.enabled && usageHintMap[mod.id]" class="am-example">
            {{ usageHintMap[mod.id]?.example }}
          </div>
          <div class="am-meta">
            <span v-if="mod.usageCount > 0">已用 {{ mod.usageCount }} 次</span>
            <span v-if="mod.source === 'marketplace'">市场导入</span>
            <span v-if="mod.toolNames && mod.toolNames.length" class="am-tools">
              {{ mod.toolNames.slice(0, 4).join(', ') }}<template v-if="mod.toolNames.length > 4">…</template>
            </span>
          </div>
        </div>
        <button
          type="button"
          class="am-toggle"
          :class="{ on: mod.enabled }"
          :title="mod.enabled ? '停用' : '启用'"
          @click="toggleModule(mod)"
        >
          <span class="am-toggle-track"><span class="am-toggle-thumb" /></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-modules {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.am-header {
  padding: 12px 14px 8px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.am-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
  white-space: nowrap;
  flex-shrink: 0;
}
.am-sub {
  font-size: 11px;
  color: var(--arc-text-hint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.am-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}
.am-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.am-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  transition: all 0.15s ease;
  min-width: 0;
}
.am-item.disabled {
  opacity: 0.55;
}
.am-item:hover {
  border-color: var(--arc-border-strong);
}
.am-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
  flex-shrink: 0;
}
.am-body {
  flex: 1;
  min-width: 0;
}
.am-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--arc-text-primary);
  min-width: 0;
}
.am-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.am-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.am-risk {
  flex-shrink: 0;
  font-size: 9.5px;
  line-height: 1.5;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  flex: 0 0 auto;
}
.risk-low { background: rgba(4,120,87,0.12); color: #047857; }
.risk-med { background: rgba(180,83,9,0.12); color: #b45309; }
.risk-high { background: rgba(217,119,6,0.15); color: #d97706; }
.risk-crit { background: rgba(185,28,28,0.12); color: #b91c1c; }
.am-desc {
  margin-top: 3px;
  font-size: 11px;
  color: var(--arc-text-secondary);
  line-height: 1.45;
}
.am-usage {
  margin-top: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  font-size: 10.5px;
  color: var(--arc-text-hint);
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  min-width: 0;
}
.am-usage svg {
  flex-shrink: 0;
  margin-top: 1px;
}
.am-usage span {
  min-width: 0;
  overflow-wrap: break-word;
}
.am-usage.active {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  color: var(--arc-text-secondary);
}
.am-example {
  margin-top: 3px;
  font-size: 10px;
  font-family: var(--ga-mono, ui-monospace, monospace);
  color: var(--arc-primary);
  opacity: 0.85;
  padding-left: 1px;
}
.am-meta {
  margin-top: 4px;
  font-size: 10px;
  color: var(--arc-text-hint);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.am-tools {
  font-family: var(--ga-mono, ui-monospace, monospace);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.am-toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  align-self: center;
}
.am-toggle-track {
  display: block;
  width: 34px;
  height: 18px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  position: relative;
  transition: background 0.2s ease;
}
.am-toggle-thumb {
  position: absolute;
  top: 1px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  transition: transform 0.2s ease, background 0.2s ease;
}
.am-toggle.on .am-toggle-track {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
}
.am-toggle.on .am-toggle-thumb {
  transform: translateX(15px);
  background: #fff;
}
</style>
