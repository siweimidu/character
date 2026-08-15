import { onBeforeUnmount } from 'vue'

/**
 * 深色/浅色模式切换的流畅过渡与性能优化。
 *
 * 背景：直接切换主题时，全量 CSS 变量与 Naive UI 主题覆盖会同时变化，
 * 若让成千上万个节点各自触发过渡动画，会引发大规模重排重绘导致明显卡顿。
 * 旧实现依赖「先禁用全部 transition，切换后再恢复」的瞬时切换策略，
 * 虽然避免了逐节点动画，但整页在单帧内一次性重绘，在复杂界面（章节目录、
 * 关系图、正文长列表等）下仍可能掉帧。
 *
 * 优化方案：
 * 1. 优先使用浏览器 View Transitions API。它由合成器对「切换前」与「切换后」
 *    两份整页快照做交叉淡化，视觉上丝滑，且开销集中在合成层（GPU），
 *    远低于逐节点重排重绘，同时显著降低 CPU 占用。
 * 2. 切换期间保持 `.theme-switching`（抑制元素级 transition），
 *    避免新旧样式被逐帧过渡导致卡顿；待交叉淡化结束后再恢复。
 * 3. 不支持 View Transitions 的环境回退到传统的「瞬时切换」策略。
 */

interface ThemeTransitionHandle {
  /** 主动跳过/中止正在进行的过渡动画（例如用户在动画期间快速再次点击） */
  skip: () => void
}

// 抑制元素级 transition，避免深色切换时海量节点各自做过渡动画导致卡顿
function suppressElementTransitions(): void {
  document.documentElement.classList.add('theme-switching')
}

// 等待主题样式全部应用（两帧）后再恢复元素级过渡
function restoreElementTransitions(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching')
    })
  })
}

/**
 * 执行一次流畅、低开销的主题切换。
 *
 * @param applyChange 在旧状态快照被捕获之后执行的回调，用于实际翻转深色模式状态
 *                    （例如调用 store 的 updateAppSetting）。该回调会在 View Transitions
 *                    快照之间运行，返回后捕获新状态快照用于交叉淡化。
 * @returns 一个句柄，可调用 skip() 主动中止过渡（快速连续切换时避免动画堆叠）。
 */
export function runThemeTransition(applyChange: () => void): ThemeTransitionHandle {
  suppressElementTransitions()

  // 不支持 View Transitions API 时回退到瞬时切换
  if (typeof document.startViewTransition !== 'function') {
    applyChange()
    restoreElementTransitions()
    return { skip: () => {} }
  }

  let transition: ViewTransition | undefined
  try {
    transition = document.startViewTransition(() => {
      applyChange()
    })
  } catch {
    // 极少数情况下（如页面正在被回收）startViewTransition 可能抛错，回退瞬时切换
    applyChange()
    restoreElementTransitions()
    return { skip: () => {} }
  }

  // 无论成功或中止，都要在动画结束后恢复元素级 transition
  transition.finished.finally(() => {
    restoreElementTransitions()
  })

  return {
    skip: () => {
      // 中止当前过渡并立即恢复元素级 transition
      try {
        transition?.skipTransition()
      } catch {
        /* 已结束或中止的过渡无需处理 */
      }
      restoreElementTransitions()
    }
  }
}

/**
 * 在组件内安全地执行主题切换：组件卸载时自动清理未完成的过渡动画，
 * 避免对已卸载的 DOM 操作。返回 handle 供调用方在快速连点时主动 skip。
 */
export function useThemeTransition() {
  let pendingHandle: ThemeTransitionHandle | null = null

  function transition(callback: () => void): void {
    // 连续快速切换时，先中止上一次未完成的过渡，防止动画堆叠造成抖动
    pendingHandle?.skip()
    pendingHandle = runThemeTransition(() => {
      callback()
      // 状态变更后同步清理引用，避免累积
      pendingHandle = null
    })
  }

  onBeforeUnmount(() => {
    pendingHandle?.skip()
    pendingHandle = null
  })

  return { transition }
}
