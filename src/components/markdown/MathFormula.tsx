import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'
import { needsDisplay, renderMath, type MathRender } from '../../services/markdown/renderMath.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'

/** 公式在原文里的写法：块级 $$…$$、行内 $$…$$、$…$、\(…\) */
export type MathSource = 'block' | 'dollar2' | 'dollar1' | 'paren'

const noop = () => {}

/** 公式不参与文本选择：否则长按会先弹系统选区菜单，复制走的是渲染结果。 */
const NO_SELECT = { userSelect: 'none', WebkitUserSelect: 'none' } as const

const LONG_PRESS_MS = 450
/**
 * 长按已经在 450ms 时复制过一次，紧接着 WebView 还会补发一次 contextmenu，
 * 两次都会弹提示，看起来就是「闪两下」。这段时间内只认第一次。
 */
const COPY_GUARD_MS = 900
let lastCopyAt = 0

const preferDisplay = (value: string, source: MathSource): boolean =>
  source === 'block' || (source === 'dollar2' && needsDisplay(value))

const copySource = (value: string, source: MathSource): string => {
  switch (source) {
    case 'block':
      return `$$\n${value}\n$$`
    case 'dollar2':
      return `$$${value}$$`
    default:
      return `$${value}$`
  }
}

/**
 * 复制公式的 LaTeX 源码。
 * 安卓 WebView 长按选中的「复制」由系统选区菜单直接写剪贴板，不经过 DOM 的 copy 事件，
 * 因此让公式本身不可选，改用长按手势识别，桌面端同时支持右键。
 */
const copyFormula = (value: string, source: MathSource) => {
  const now = Date.now()
  if (now - lastCopyAt < COPY_GUARD_MS) {
    return
  }
  lastCopyAt = now
  void copyText(copySource(value, source)).then((ok) => {
    showToast(ok ? { key: 'latexCopied' } : { key: 'latexCopyFailed' })
  })
}

const useLongPressCopy = (value: string, source: MathSource) => {
  const timer = useRef<number | undefined>(undefined)
  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }, [])
  const start = useCallback(() => {
    clear()
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      copyFormula(value, source)
    }, LONG_PRESS_MS)
  }, [clear, value, source])
  useEffect(() => clear, [clear])
  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onTouchCancel: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault()
      copyFormula(value, source)
    },
  }
}

/** KaTeX 渲染公式；出错时保留上次成功的结果（流式中公式未写完），没有则展示原文 */
const useMathHtml = (input: string, display: boolean): MathRender => {
  const previousResultRef = useRef<MathRender | null>(null)
  const katexRef = useRef(ensureKatex())
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  useEffect(() => {
    if (katexRef.current instanceof Promise) {
      katexRef.current.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathRender => {
    if (!katex) {
      return { html: '', display, ok: false }
    }
    const result = renderMath(katex, input, display)
    if (result.ok) {
      previousResultRef.current = result
      return result
    }
    return previousResultRef.current ?? result
  }, [input, display, katex])
}

const Formula = memo(function Formula({ value, source }: { value: string; source: MathSource }) {
  const { html, display, ok } = useMathHtml(value, preferDisplay(value, source))
  const longPress = useLongPressCopy(value, source)
  if (!ok) {
    // 实在无法渲染时给出可读的源码，而不是把公式整段吞掉
    return source === 'block' ? (
      <p className="ds-markdown-paragraph ds-markdown-math-raw">{value}</p>
    ) : (
      <span className="ds-markdown-math-raw">{value}</span>
    )
  }
  if (display) {
    return (
      <span
        className="katex-display ds-markdown-math"
        style={NO_SELECT}
        title={value}
        {...longPress}
      >
        <span
          className="katex"
          data-latex={value}
          data-display="1"
          dangerouslySetInnerHTML={{ __html: html }}
        ></span>
      </span>
    )
  }
  return (
    <span
      className="katex"
      style={NO_SELECT}
      data-latex={value}
      title={value}
      {...longPress}
      dangerouslySetInnerHTML={{ __html: html }}
    ></span>
  )
})

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  return <Formula value={value} source="block" />
})

export const InlineMath = memo(function InlineMath({
  value,
  source = 'dollar1',
}: {
  value: string
  source?: MathSource
}) {
  return <Formula value={value} source={source} />
})
