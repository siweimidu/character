<script setup lang="ts">
/**
 * AgentMcpMarket · MCP 市场与服务器管理面板
 *
 * 功能：
 *   1. 配置远程 MCP 服务器（mcp.soul）或本地 MCP 服务（stdio）
 *   2. 测试连接、启用/停用服务器
 *   3. 展示从已连接服务器发现的工具列表
 *   4. 展示 MCP 市场推荐（mcp.so、smithery 等）
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  ExternalLink,
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
  Loader2,
  X
} from 'lucide-vue-next'
import type { McpMarketDefinition, McpServerDefinition } from '@shared/agent-modules'

const message = useMessage()

const emit = defineEmits<{
  (e: 'change'): void
}>()

// ── 数据 ──
const markets = ref<McpMarketDefinition[]>([])
const servers = ref<McpServerDefinition[]>([])
const tools = ref<Array<{ id: string; marketId: string; name: string; description: string; installHint?: string }>>([])
const loadingMarkets = ref(false)
const loadingServers = ref(false)
const loadingTools = ref(false)

// ── 添加服务器表单 ──
const showAddForm = ref(false)
const editingServer = ref<McpServerDefinition | null>(null)
const formTransport = ref<'http' | 'stdio'>('http')
const formName = ref('')
const formDescription = ref('')
const formUrl = ref('')
const formApiKey = ref('')
const formCommand = ref('npx')
const formArgs = ref('')
const formCwd = ref('')
const formSaving = ref(false)

// ── 测试连接 ──
const testingId = ref('')

/** 加载 MCP 市场列表。 */
async function loadMarkets(): Promise<void> {
  loadingMarkets.value = true
  try {
    markets.value = await window.characterArc.agentModules.mcpListMarkets()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载市场失败')
  } finally {
    loadingMarkets.value = false
  }
}

/** 加载 MCP 服务器配置。 */
async function loadServers(): Promise<void> {
  loadingServers.value = true
  try {
    servers.value = await window.characterArc.agentModules.mcpServerList()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载服务器失败')
  } finally {
    loadingServers.value = false
  }
}

/** 加载已发现工具。 */
async function loadTools(): Promise<void> {
  loadingTools.value = true
  try {
    const result = await window.characterArc.agentModules.mcpListTools({})
    tools.value = result
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载工具失败')
  } finally {
    loadingTools.value = false
  }
}

/** 打开添加服务器表单。 */
function openAddForm(): void {
  editingServer.value = null
  formTransport.value = 'http'
  formName.value = ''
  formDescription.value = ''
  formUrl.value = 'https://mcp.soul:3000/mcp'
  formApiKey.value = ''
  formCommand.value = 'npx'
  formArgs.value = ''
  formCwd.value = ''
  showAddForm.value = true
}

/** 打开编辑服务器表单。 */
function openEditForm(server: McpServerDefinition): void {
  editingServer.value = server
  formTransport.value = server.transport
  formName.value = server.name
  formDescription.value = server.description ?? ''
  formUrl.value = server.url ?? ''
  formApiKey.value = server.apiKey ?? ''
  formCommand.value = server.command ?? 'npx'
  formArgs.value = (server.args ?? []).join(' ')
  formCwd.value = server.cwd ?? ''
  showAddForm.value = true
}

/** 关闭表单。 */
function closeForm(): void {
  showAddForm.value = false
  editingServer.value = null
}

/** 保存服务器配置（新增或编辑）。 */
async function saveServer(): Promise<void> {
  if (!formName.value.trim()) {
    message.warning('请输入服务器名称。')
    return
  }
  if (formTransport.value === 'http' && !formUrl.value.trim()) {
    message.warning('远程服务器需要填写 URL 地址。')
    return
  }
  if (formTransport.value === 'stdio' && !formCommand.value.trim()) {
    message.warning('本地服务器需要填写启动命令。')
    return
  }

  formSaving.value = true
  try {
    const args = formArgs.value
      .split(/\s+/)
      .filter((a) => a.trim().length > 0)

    const payload: Record<string, unknown> = {
      name: formName.value.trim(),
      description: formDescription.value.trim(),
      transport: formTransport.value,
      command: formCommand.value.trim(),
      args,
      cwd: formCwd.value.trim() || undefined,
      url: formUrl.value.trim() || undefined,
      apiKey: formApiKey.value.trim() || undefined
    }

    if (editingServer.value) {
      await window.characterArc.agentModules.mcpServerUpdate({
        id: editingServer.value.id,
        patch: payload
      })
      message.success(`已更新服务器「${formName.value.trim()}」`)
    } else {
      await window.characterArc.agentModules.mcpServerAdd(payload)
      message.success(`已添加服务器「${formName.value.trim()}」`)
    }
    closeForm()
    await loadServers()
    await loadTools()
    emit('change')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    formSaving.value = false
  }
}

/** 删除服务器。 */
async function removeServer(server: McpServerDefinition): Promise<void> {
  const confirmed = window.confirm(`确定删除 MCP 服务器「${server.name}」吗？`)
  if (!confirmed) return
  try {
    await window.characterArc.agentModules.mcpServerDelete({ id: server.id })
    message.success(`已删除服务器「${server.name}」`)
    await loadServers()
    await loadTools()
    emit('change')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

/** 测试服务器连接。 */
async function testServer(server: McpServerDefinition): Promise<void> {
  testingId.value = server.id
  try {
    const result = await window.characterArc.agentModules.mcpServerTest({ id: server.id })
    if (result.ok) {
      message.success(result.message)
      // 连接成功后自动启用
      if (!server.enabled) {
        await window.characterArc.agentModules.mcpServerUpdate({
          id: server.id,
          patch: { enabled: true }
        })
      }
    } else {
      message.error(result.message)
    }
    await loadServers()
    await loadTools()
    emit('change')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '测试连接失败')
  } finally {
    testingId.value = ''
  }
}

/** 切换服务器启用状态。 */
async function toggleServer(server: McpServerDefinition): Promise<void> {
  try {
    const next = !server.enabled
    await window.characterArc.agentModules.mcpServerUpdate({
      id: server.id,
      patch: { enabled: next }
    })
    message.success(next ? `已启用「${server.name}」` : `已停用「${server.name}」`)
    await loadServers()
    await loadTools()
    emit('change')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  }
}

/** 状态显示辅助。 */
function statusLabel(status?: string): string {
  switch (status) {
    case 'connected': return '已连接'
    case 'error': return '连接失败'
    default: return '未连接'
  }
}

function statusClass(status?: string): string {
  switch (status) {
    case 'connected': return 'mcp-status-ok'
    case 'error': return 'mcp-status-err'
    default: return 'mcp-status-off'
  }
}

onMounted(() => {
  void loadMarkets()
  void loadServers()
  void loadTools()
})
</script>

<template>
  <div class="agent-mcp">
    <!-- 头部 -->
    <div class="amcp-header">
      <div class="amcp-title">MCP 市场</div>
      <span class="amcp-sub">接入远程 mcp.soul 或本地 MCP 服务</span>
    </div>

    <!-- 服务器连接管理 -->
    <div class="amcp-servers">
      <div class="amcp-section-head">
        <span>服务器连接</span>
        <button type="button" class="amcp-add-btn" @click="openAddForm">
          <Plus :size="13" />
          添加
        </button>
      </div>

      <div v-if="loadingServers" class="amcp-empty">加载中…</div>
      <div v-else-if="servers.length === 0" class="amcp-empty">
        暂无 MCP 服务器连接。点击「添加」配置远程 mcp.soul 或本地 MCP 服务。
      </div>

      <div v-else class="amcp-server-list">
        <div
          v-for="server in servers"
          :key="server.id"
          class="amcp-server-item"
          :class="{ disabled: !server.enabled }"
        >
          <div class="amcp-server-icon">
            <Plug :size="15" />
          </div>
          <div class="amcp-server-body">
            <div class="amcp-server-name">
              {{ server.name }}
              <span class="amcp-server-type">
                {{ server.transport === 'http' ? '远程' : '本地' }}
              </span>
              <span class="amcp-server-status" :class="statusClass(server.status)">
                {{ statusLabel(server.status) }}
              </span>
            </div>
            <div v-if="server.description" class="amcp-server-desc">{{ server.description }}</div>
            <div class="amcp-server-meta">
              <span v-if="server.transport === 'http'">{{ server.url }}</span>
              <span v-else>{{ server.command }} {{ (server.args ?? []).join(' ') }}</span>
            </div>
            <div v-if="server.status === 'error' && server.lastError" class="amcp-server-error">
              {{ server.lastError }}
            </div>
          </div>
          <div class="amcp-server-actions">
            <button
              type="button"
              class="amcp-action-btn"
              title="测试连接"
              :disabled="testingId === server.id"
              @click="testServer(server)"
            >
              <Loader2 v-if="testingId === server.id" :size="13" class="spin" />
              <RefreshCw v-else :size="13" />
            </button>
            <button
              type="button"
              class="amcp-action-btn"
              :title="server.enabled ? '停用' : '启用'"
              @click="toggleServer(server)"
            >
              <Wifi v-if="server.enabled" :size="13" />
              <WifiOff v-else :size="13" />
            </button>
            <button
              type="button"
              class="amcp-action-btn"
              title="编辑配置"
              @click="openEditForm(server)"
            >
              <ExternalLink :size="13" />
            </button>
            <button
              type="button"
              class="amcp-action-btn danger"
              title="删除"
              @click="removeServer(server)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <button
            type="button"
            class="amcp-toggle"
            :class="{ on: server.enabled }"
            :title="server.enabled ? '停用' : '启用'"
            @click="toggleServer(server)"
          >
            <span class="amcp-toggle-track"><span class="amcp-toggle-thumb" /></span>
          </button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑服务器表单 -->
    <div v-if="showAddForm" class="amcp-form">
      <div class="amcp-form-head">
        <span>{{ editingServer ? '编辑服务器' : '添加服务器' }}</span>
        <button type="button" class="amcp-form-close" title="关闭" @click="closeForm">
          <X :size="14" />
        </button>
      </div>

      <div class="amcp-form-body">
        <label class="amcp-field">
          <span>传输类型</span>
          <select v-model="formTransport">
            <option value="http">远程（HTTP/SSE）</option>
            <option value="stdio">本地（stdio）</option>
          </select>
        </label>

        <label class="amcp-field">
          <span>服务器名称</span>
          <input v-model="formName" type="text" placeholder="如 mcp.soul" />
        </label>

        <label class="amcp-field">
          <span>描述（可选）</span>
          <input v-model="formDescription" type="text" placeholder="描述该 MCP 服务器用途" />
        </label>

        <template v-if="formTransport === 'http'">
          <label class="amcp-field">
            <span>服务器 URL</span>
            <input v-model="formUrl" type="text" placeholder="https://mcp.soul:3000/mcp" />
          </label>
          <label class="amcp-field">
            <span>API Key（可选）</span>
            <input v-model="formApiKey" type="password" placeholder="留空则无鉴权" />
          </label>
        </template>

        <template v-else>
          <label class="amcp-field">
            <span>启动命令</span>
            <input v-model="formCommand" type="text" placeholder="npx / node / python" />
          </label>
          <label class="amcp-field">
            <span>参数（空格分隔）</span>
            <input v-model="formArgs" type="text" placeholder="-y @modelcontextprotocol/server-filesystem" />
          </label>
          <label class="amcp-field">
            <span>工作目录（可选）</span>
            <input v-model="formCwd" type="text" placeholder="/path/to/server" />
          </label>
        </template>

        <div class="amcp-form-actions">
          <button type="button" class="amcp-btn-cancel" @click="closeForm">取消</button>
          <button
            type="button"
            class="amcp-btn-save"
            :disabled="formSaving"
            @click="saveServer"
          >
            {{ formSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- MCP 市场推荐 -->
    <div class="amcp-markets">
      <div class="amcp-section-head">
        <span>推荐市场</span>
      </div>
      <a
        v-for="m in markets"
        :key="m.id"
        class="amcp-market"
        :href="m.endpoint"
        target="_blank"
        rel="noopener"
      >
        <div class="amcp-market-name">
          <Plug :size="14" />
          {{ m.name }}
          <ExternalLink :size="11" />
        </div>
        <div class="amcp-market-desc">{{ m.description }}</div>
      </a>
    </div>

    <!-- 可导入/可用工具 -->
    <div class="amcp-list-head">
      <span>可用工具</span>
    </div>

    <div v-if="loadingTools" class="amcp-empty">加载中…</div>
    <div v-else-if="tools.length === 0" class="amcp-empty">
      暂无可用 MCP 工具。请先添加并测试连接 MCP 服务器。
    </div>

    <div v-else class="amcp-list arc-scrollbar">
      <div v-for="tool in tools" :key="tool.id" class="amcp-item">
        <div class="amcp-item-body">
          <div class="amcp-item-name">{{ tool.name }}</div>
          <div class="amcp-item-desc">{{ tool.description }}</div>
          <div v-if="tool.installHint" class="amcp-item-hint">{{ tool.installHint }}</div>
        </div>
        <span v-if="tool.id === 'builtin.novel-project'" class="amcp-builtin-badge">内置</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-mcp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}
.amcp-header {
  padding: 12px 14px 8px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.amcp-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
  white-space: nowrap;
  flex-shrink: 0;
}
.amcp-sub {
  font-size: 11px;
  color: var(--arc-text-hint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 服务器管理 */
.amcp-servers {
  padding: 4px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.amcp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-hint);
  margin-bottom: 4px;
}
.amcp-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--arc-primary);
  background: transparent;
  color: var(--arc-primary);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.amcp-add-btn:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
}
.amcp-server-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.amcp-server-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  min-width: 0;
}
.amcp-server-item.disabled {
  opacity: 0.6;
}
.amcp-server-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
  flex-shrink: 0;
}
.amcp-server-body {
  flex: 1;
  min-width: 0;
}
.amcp-server-name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--arc-text-primary);
  min-width: 0;
  flex-wrap: wrap;
}
.amcp-server-type {
  font-size: 8.5px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-weight: 600;
}
.amcp-server-status {
  font-size: 8.5px;
  padding: 1px 5px;
  border-radius: 999px;
  font-weight: 600;
}
.mcp-status-ok { background: rgba(4,120,87,0.12); color: #047857; }
.mcp-status-err { background: rgba(185,28,28,0.12); color: #b91c1c; }
.mcp-status-off { background: var(--arc-bg-weak); color: var(--arc-text-hint); }
.amcp-server-desc {
  font-size: 9.5px;
  color: var(--arc-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amcp-server-meta {
  font-size: 9px;
  color: var(--arc-text-hint);
  font-family: var(--ga-mono, ui-monospace, monospace);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amcp-server-error {
  font-size: 9px;
  color: var(--arc-danger);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amcp-server-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.amcp-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
}
.amcp-action-btn:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}
.amcp-action-btn.danger:hover {
  color: var(--arc-danger);
  background: color-mix(in srgb, var(--arc-danger) 8%, transparent);
}
.spin { animation: amcp-spin 0.8s linear infinite; }
@keyframes amcp-spin { to { transform: rotate(360deg); } }

.amcp-toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  flex-shrink: 0;
}
.amcp-toggle-track {
  display: block;
  width: 30px;
  height: 16px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  position: relative;
  transition: background 0.2s ease;
}
.amcp-toggle-thumb {
  position: absolute;
  top: 1px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  transition: transform 0.2s ease, background 0.2s ease;
}
.amcp-toggle.on .amcp-toggle-track {
  background: var(--arc-primary);
  border-color: var(--arc-primary);
}
.amcp-toggle.on .amcp-toggle-thumb {
  transform: translateX(13px);
  background: #fff;
}

/* 表单 */
.amcp-form {
  margin: 4px 12px 8px;
  border: 1px solid var(--arc-primary);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  overflow: hidden;
}
.amcp-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--arc-border);
  font-size: 11.5px;
  font-weight: 650;
  color: var(--arc-text-primary);
}
.amcp-form-close {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.amcp-form-close:hover { color: var(--arc-text-primary); }
.amcp-form-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.amcp-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.amcp-field > span {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--arc-text-hint);
}
.amcp-field input,
.amcp-field select {
  padding: 6px 8px;
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
  font-size: 11px;
  font-family: inherit;
  outline: none;
}
.amcp-field input:focus,
.amcp-field select:focus {
  border-color: var(--arc-primary);
}
.amcp-form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
.amcp-btn-cancel {
  padding: 5px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.amcp-btn-save {
  padding: 5px 12px;
  border: 1px solid var(--arc-primary);
  border-radius: 7px;
  background: var(--arc-primary);
  color: var(--arc-primary-foreground, #fff);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.amcp-btn-save:disabled { opacity: 0.6; cursor: not-allowed; }

/* 市场推荐 */
.amcp-markets {
  padding: 4px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.amcp-market {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  padding: 6px 8px;
  color: var(--arc-text-primary);
  text-decoration: none;
  transition: all 0.15s ease;
  background: var(--arc-bg-surface);
}
.amcp-market:hover {
  border-color: var(--arc-primary);
}
.amcp-market-name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 650;
  min-width: 0;
}
.amcp-market-name svg:first-child { flex-shrink: 0; }
.amcp-market-desc {
  margin-top: 2px;
  font-size: 9.5px;
  color: var(--arc-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 工具列表 */
.amcp-list-head {
  padding: 4px 14px;
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-hint);
  border-top: 1px solid var(--arc-border);
  padding-top: 8px;
}
.amcp-empty {
  padding: 16px 14px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 11px;
}
.amcp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.amcp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  min-width: 0;
}
.amcp-item-body {
  flex: 1;
  min-width: 0;
}
.amcp-item-name {
  font-size: 11px;
  font-weight: 650;
  color: var(--arc-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amcp-item-desc {
  margin-top: 2px;
  font-size: 9.5px;
  color: var(--arc-text-secondary);
  min-width: 0;
  overflow-wrap: break-word;
}
.amcp-item-hint {
  margin-top: 2px;
  font-size: 9px;
  color: var(--arc-text-hint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amcp-builtin-badge {
  flex-shrink: 0;
  font-size: 8.5px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(4,120,87,0.12);
  color: #047857;
  font-weight: 600;
}
</style>
