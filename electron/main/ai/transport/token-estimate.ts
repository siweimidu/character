/**
 * 粗估文本对应的 token 数（中文/英文混合，量级正确即可）。
 *
 * 部分供应商（如 GitCode/AtomGit 的 Qwen3-VL 视觉模型）在纯文本请求下
 * 不返回 usage 或返回 completion_tokens = 0，此时用文本长度兜底估算，
 * 避免测速与输出 token 显示为 0。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkMatches = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff61-\uff9f]/g)
  const cjkCount = cjkMatches ? cjkMatches.length : 0
  const nonCjkCount = text.length - cjkCount
  return Math.ceil(cjkCount * 0.7 + nonCjkCount * 0.25)
}
