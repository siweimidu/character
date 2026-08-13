<script setup lang="ts">
/**
 * AgentMcpMarket · MCP 市场接入面板
 *
 * 从 mcp.so、smithery 等 MCP 市场导入服务器/工具，扩展全局智能体能力。
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { Download, ExternalLink, Plug } from 'lucide-vue-next'
import type { McpMarketDefinition, McpToolListing } from '@shared/agent-modules'

const message = useMessage()

const markets = ref<McpMarketDefinition[]>([])
const tools = ref<McpToolListing[]>([])
const loadingMarkets = ref(false)
const loadingTools = ref(false)

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

async function loadTools(marketId?: string): Promise<void> {
  loadingTools.value = true
  try {
    tools.value = await window.characterArc.agentModules.mcpListTools(marketId ? { marketId } : {})
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载工具失败')
  } finally {
    loadingTools.value = false
  }
}

async function importTool(tool: McpToolListing): Promise<void> {
  try {
    const result = await window.characterArc.agentModules.mcpImport({
      marketId: tool.marketId,
      toolId: tool.id
    })
    message.success(result.message)
    void loadTools(tool.marketId)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '导入失败')
  }
}

onMounted(() => {
  void loadMarkets()
  void loadTools()
})
</script>

<template>
  <div class="agent-mcp">
    <div class="amcp-header">
      <div class="amcp-title">MCP 市场</div>
      <span class="amcp-sub">从市场导入能力</span>
    </div>

    <div class="amcp-markets">
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

    <div class="amcp-list-head">
      <span>可导入工具</span>
    </div>

    <div v-if="loadingTools" class="amcp-empty">加载中…</div>
    <div v-else-if="tools.length === 0" class="amcp-empty">暂无可用工具，请先配置市场连接</div>

    <div v-else class="amcp-list arc-scrollbar">
      <div v-for="tool in tools" :key="tool.id" class="amcp-item">
        <div class="amcp-item-body">
          <div class="amcp-item-name">{{ tool.name }}</div>
          <div class="amcp-item-desc">{{ tool.description }}</div>
          <div v-if="tool.installHint" class="amcp-item-hint">{{ tool.installHint }}</div>
        </div>
        <button type="button" class="amcp-import" @click="importTool(tool)">
          <Download :size="14" />
          导入
        </button>
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
}
.amcp-header {
  padding: 12px 14px 8px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.amcp-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-primary);
}
.amcp-sub {
  font-size: 11px;
  color: var(--arc-text-hint);
}
.amcp-markets {
  padding: 4px 12px 8px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.amcp-market {
  border: 1px solid var(--arc-border);
  border-radius: 9px;
  padding: 8px 10px;
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
  gap: 5px;
  font-size: 12px;
  font-weight: 650;
}
.amcp-market-desc {
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--arc-text-secondary);
}
.amcp-list-head {
  padding: 4px 14px;
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-hint);
  border-top: 1px solid var(--arc-border);
  padding-top: 8px;
}
.amcp-empty {
  padding: 20px 14px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12px;
}
.amcp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.amcp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 9px;
  background: var(--arc-bg-surface);
}
.amcp-item-body {
  flex: 1;
  min-width: 0;
}
.amcp-item-name {
  font-size: 12px;
  font-weight: 650;
  color: var(--arc-text-primary);
}
.amcp-item-desc {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--arc-text-secondary);
}
.amcp-item-hint {
  margin-top: 3px;
  font-size: 10px;
  color: var(--arc-text-hint);
}
.amcp-import {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 40%, transparent);
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.amcp-import:hover {
  background: color-mix(in srgb, var(--arc-primary) 18%, transparent);
}
</style>
