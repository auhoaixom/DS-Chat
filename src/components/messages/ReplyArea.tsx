import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconBrowseOutline16,
  IconBrowseWarningOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCheckedOutline14,
  IconCloseFill14,
  IconLinkOutline16,
  IconRightUpOutline14,
  IconSearchOutline16,
  IconSearchWarningOutline16,
  IconThinkOutline16,
} from '../base/icons.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import {
  getAreaTitle,
  isDeepSearchKind,
  isImageSearchKind,
  type FindStep,
  type OpenStep,
  type PageItem,
  type ReadLinkStep,
  type ReplyView,
  type SearchStep,
  type Source,
  type Step,
} from '../../services/chat/view.js'
import { Tooltip } from '../base/Tooltip.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { nextOffset } from './previewScroll.js'
import { useChatScroll } from './scrollContext.js'
import { findScrollParent } from './scrollParent.js'
import styles from './ReplyArea.module.css'
import './thinking.markdown.css'

/** 进行中时每秒刷新，用于思考用时与搜索词轮播 */
const useTicker = (active: boolean, interval: number) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), interval)
    return () => clearInterval(timer)
  }, [active, interval])
  return tick
}

/**
 * 思考与工具步骤的时间线：
 * 开启深度思考时带可折叠的标题（正在思考 / 正在搜索 / 正在浏览网页 / 已思考（用时 N 秒））；
 * 未开启时只有工具步骤（如普通搜索的「已阅读 N 个网页」）。
 */
export const ReplyArea = memo(function ReplyArea({
  message,
  view,
  streaming,
  hasResponse,
}: {
  message: AssistantMessage
  view: ReplyView
  streaming: boolean
  hasResponse: boolean
}) {
  useTranslate()
  /**
   * 只记「用户点开过全文」。它不会被自动改，三条规则因此自洽：
   * - 思考结束时仍是展开态 → 保持展开（这正是这个功能要的）
   * - 思考结束时仍是小窗态 → 小窗消失、落回标题行（`titleActive` 转 false）
   * - 历史消息进页面 → 初值 false，天然收起
   * 也只是组件内状态：切走会话就重置。
   */
  const [expanded, setExpanded] = useState(false)
  const titleActive = streaming && !hasResponse
  useTicker(titleActive, 1000)
  const scroll = useChatScroll()
  const titleRef = useRef<HTMLDivElement>(null)
  /** 展开/收起前那一行标题在视口里的位置；渲染后要把它挪回原处 */
  const holdRef = useRef<{ el: HTMLElement; top: number } | null>(null)

  // 没有依赖数组：展开/收起之后必然重渲染，这一次就是补偿的时机
  useLayoutEffect(() => {
    const hold = holdRef.current
    if (!hold) {
      return
    }
    holdRef.current = null
    const parent = findScrollParent(hold.el)
    if (!parent) {
      return
    }
    const delta = hold.el.getBoundingClientRect().top - hold.top
    if (delta !== 0) {
      parent.scrollTop += delta
    }
  })

  /**
   * 上面所有 hook 必须先跑完，再决定要不要早退。
   *
   * 早退是给「这条回复既没有思考也没有工具步骤」准备的，但它会跳过后面的
   * `useContext` / `useRef` / `useLayoutEffect`。只要某次重渲染让条件由真变假
   * （切换模型、历史消息补进来都会），hooks 数量前后不一致，React 抛 #300。
   */
  if (view.steps.length === 0 && !(message.thinking && streaming)) {
    return null
  }

  /**
   * 就地展开/收起：把标题行钉在原地。
   *
   * 不这样做的话，展开会让下方内容一下长高很多，而列表还开着贴底跟随 ——
   * 视口直接被拽到最底部，用户点的是"展开看看"，看到的却是"跳到最新一行"。
   * 所以先关掉跟随（`holdAt`），渲染后再按位置差把滚动补回来。
   */
  const toggleExpanded = () => {
    const row = titleRef.current
    if (row) {
      holdRef.current = { el: row, top: row.getBoundingClientRect().top }
      scroll.holdAt(row)
    }
    setExpanded((value) => !value)
  }

  // 未记录请求开关时，按是否有思考内容显示标题。
  const thinking = message.thinking ?? view.steps.some((step) => step.type === 'thinking')
  const title = thinking ? getAreaTitle(view, streaming, Date.now(), hasResponse) : null
  const stopped = !streaming && !hasResponse
  /** 思考进行中 + 用户没点开 → 显示滚动小窗（不是把全文铺开） */
  const previewing = titleActive && title !== null && !expanded

  const steps = view.steps.map((step, index) => (
    <StepItem
      key={stepKey(step, index)}
      step={step}
      message={message}
      sources={view.sources}
      streaming={streaming}
      isLast={index === view.steps.length - 1}
    />
  ))
  return (
    <div className={styles.area}>
      {title ? (
        <div ref={titleRef} className={styles.title} onClick={toggleExpanded}>
          <span className={clsx(styles.titleIcon, stopped && styles.stoppedIcon)}>
            <IconThinkOutline16 />
          </span>
          <span className={clsx(styles.titleText, titleActive && styles.shimmer)}>{title}</span>
          {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </div>
      ) : null}
      {expanded || !title ? <div>{steps}</div> : previewing ? <PreviewWindow>{steps}</PreviewWindow> : null}
    </div>
  )
})

/**
 * 思考小窗：固定 5 行高，内容连续向上跟随，上下两端渐隐。
 *
 * 它**不是滚动容器**：不接手势、没有滚动条，手指在上面滑滚的是整页。
 * 位移由 previewScroll 逐帧算，写进 transform（不碰 scrollTop，避免每帧触发布局）。
 * 慢半拍是刻意的 —— 画面持续上滑，而不是攒够一行跳一下。
 */
const PreviewWindow = ({ children }: { children: ReactNode }) => {
  const boxRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const frameRef = useRef(0)

  // 没有依赖数组：每次渲染都来一趟，确保内容增长时有一帧在排着队
  useLayoutEffect(() => {
    const box = boxRef.current
    const inner = innerRef.current
    if (!box || !inner) {
      return
    }
    const target = () => Math.max(0, inner.scrollHeight - box.clientHeight)
    // 刚进小窗（或被展开再收回）：直接贴底，不播一段追赶动画
    if (offsetRef.current === 0) {
      offsetRef.current = target()
      inner.style.transform = `translate3d(0, ${-offsetRef.current}px, 0)`
    }
    if (frameRef.current !== 0) {
      return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const tick = () => {
      frameRef.current = 0
      const to = target()
      const next = nextOffset({
        current: offsetRef.current,
        target: to,
        windowHeight: box.clientHeight,
        reducedMotion: reduced,
      })
      if (next !== offsetRef.current) {
        offsetRef.current = next
        inner.style.transform = `translate3d(0, ${-next}px, 0)`
      }
      // 追平就停，不要挂着一条 60fps 的循环
      if (next !== to) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  })

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  return (
    <div ref={boxRef} className={styles.preview}>
      <div ref={innerRef} className={styles.previewInner}>
        {children}
      </div>
    </div>
  )
}

const stepKey = (step: Step, index: number) =>
  step.type === 'thinking' || step.type === 'text' || step.type === 'search'
    ? step.key
    : `${step.type}-${index}`

const StepItem = ({
  step,
  message,
  sources,
  streaming,
  isLast,
}: {
  step: Step
  message: AssistantMessage
  sources: Source[]
  streaming: boolean
  isLast: boolean
}) => {
  switch (step.type) {
    case 'thinking': {
      const lastBlock = step.blocks.at(-1)
      const thinking =
        streaming && lastBlock?.startedAt !== undefined && lastBlock.endedAt === undefined
      return (
        <ContentItem isLast={isLast} active={thinking}>
          <Markdown
            content={step.blocks.map((block) => block.thinking).join('')}
            loading={thinking}
            cacheKey={`${message.id}-${step.key}`}
            disableLink
          />
        </ContentItem>
      )
    }
    case 'text':
      return (
        <ContentItem isLast={isLast} active={false}>
          <Markdown
            content={step.markdown}
            loading={streaming && isLast}
            cacheKey={`${message.id}-${step.key}`}
            disableLink={false}
            sources={sources}
          />
        </ContentItem>
      )
    case 'search':
      return <SearchRow step={step} message={message} streaming={streaming} isLast={isLast} />
    case 'open':
      return <OpenRow step={step} sources={sources} isLast={isLast} />
    case 'find':
      return <FindRow step={step} isLast={isLast} />
    case 'read_link':
      return <ReadLinkRow step={step} isLast={isLast} />
    default:
      return null
  }
}

/** 思考或过程性文字：左侧圆点 + 竖线，小号 markdown */
const ContentItem = ({
  children,
  active,
  isLast,
}: {
  children: ReactNode
  active: boolean
  isLast: boolean
}) => (
  <div className={clsx(styles.content, 'ds-think-content', isLast && styles.lastItem)}>
    <span className={styles.dot}>
      <span className={clsx(styles.dotInner, !active && styles.inactive)} />
    </span>
    {children}
  </div>
)

/** 搜索：普通搜索为「已阅读 N 个网页」，边想边搜为「搜索到 N 个网页」，点击打开搜索结果 */
const SearchRow = ({
  step,
  message,
  streaming,
  isLast,
}: {
  step: SearchStep
  message: AssistantMessage
  streaming: boolean
  isLast: boolean
}) => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const wip = step.status === 'wip'
  const tick = useTicker(wip && step.queries.length > 1, 2000)
  const count = step.results.length
  const clickable = !wip && count > 0
  const panelEntry = `${message.id}-search-${step.key}`
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  let body: ReactNode
  if (wip) {
    body =
      step.queries.length > 0 ? (
        <>
          <span className={styles.prefix}>{t('toolSearchIntro')}</span>
          <span className={styles.query} key={tick}>
            {step.queries[tick % step.queries.length]}
          </span>
        </>
      ) : (
        <span>{t(isImageSearchKind(step.kind) ? 'imageSearching' : 'messageSearching')}</span>
      )
  } else if (interrupted) {
    body = <span>{t('searchStopped')}</span>
  } else if (failed) {
    body = <span>{t('toolSearchFail')}</span>
  } else if (count === 0) {
    body = (
      <span>{t(isDeepSearchKind(step.kind) ? 'toolSearchNoResult' : 'messageSearchNoResult')}</span>
    )
  } else {
    const text = t(
      isDeepSearchKind(step.kind)
        ? count === 1
          ? 'toolSearch1Result'
          : 'toolSearchResults'
        : count === 1
          ? 'messageSearchResult'
          : 'messageSearchResults',
      { count }
    )
    body = (
      <>
        <span className={styles.summary}>{text}</span>
        <SiteThumbnails sources={step.results} />
      </>
    )
  }
  return (
    <div
      className={clsx(
        styles.row,
        !isLast && styles.withLine,
        clickable && styles.clickable,
        entry === panelEntry && styles.active
      )}
      onClick={clickable ? () => toggleSearchPanel(panelEntry, step.results) : undefined}
    >
      <span className={styles.rowIcon}>
        {failed ? <IconSearchWarningOutline16 /> : <IconSearchOutline16 />}
      </span>
      {body}
    </div>
  )
}

/** 工具行外壳：左侧图标，右侧可换行的内容 */
const ToolRow = ({
  icon,
  children,
  isLast,
}: {
  icon: ReactNode
  children: ReactNode
  isLast: boolean
}) => (
  <div className={clsx(styles.tool, !isLast && styles.withLine)}>
    <span className={clsx(styles.rowIcon, styles.toolIcon)}>{icon}</span>
    <div className={styles.toolBody}>{children}</div>
  </div>
)

const PageLink = ({ page, failedTip }: { page: PageItem; failedTip?: string }) => (
  <span
    className={clsx(
      styles.page,
      page.status === 'failed' || !page.url ? styles.pageFailed : styles.pageDone
    )}
  >
    {page.status === 'failed' ? (
      <Tooltip content={failedTip}>
        <span className={styles.pageText}>{page.title}</span>
      </Tooltip>
    ) : (
      <a className={styles.pageText} href={page.url} target="_blank" rel="noreferrer">
        {page.title}
      </a>
    )}
    <span className={styles.pageIcon}>
      <IconRightUpOutline14 />
    </span>
  </span>
)

/** 边想边搜打开的网页：「浏览 N 个页面」+ 最多 5 个页面 */
const OpenRow = ({
  step,
  sources,
  isLast,
}: {
  step: OpenStep
  sources: Source[]
  isLast: boolean
}) => {
  const t = useTranslate()
  const allFailed = step.pages.every((page) => page.status === 'failed')
  const count = step.pages.length
  const intro = t(count === 1 ? 'toolOpenOneIntro' : 'toolOpensIntro', { count })
  const panelEntry = `open-${step.pages[0]?.id}`
  return (
    <ToolRow
      icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}
      isLast={isLast}
    >
      {allFailed ? (
        t('toolOpenFail')
      ) : (
        <>
          <span className={styles.intro}>{intro}</span>
          {step.pages.slice(0, 5).map((page) => (
            <PageLink key={page.id} page={page} failedTip={t('toolOpenFailTooltip')} />
          ))}
          {count > 5 ? (
            <span
              className={styles.chip}
              onClick={() =>
                toggleSearchPanel(
                  panelEntry,
                  sources.filter((source) => step.pages.some((page) => page.url === source.url))
                )
              }
            >
              {t('toolOpenViewAll')}
            </span>
          ) : null}
        </>
      )}
    </ToolRow>
  )
}

/** 边想边搜的页内查找：「查找关键词」+ 关键词标签 */
const FindRow = ({ step, isLast }: { step: FindStep; isLast: boolean }) => {
  const t = useTranslate()
  const allFailed = step.patterns.every((item) => item.status === 'failed')
  return (
    <ToolRow
      icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}
      isLast={isLast}
    >
      {allFailed ? (
        t('toolFindFail')
      ) : (
        <>
          <span className={styles.intro}>{t('toolFindIntro')}</span>
          {step.patterns.map((item) => (
            <Tooltip
              key={item.id}
              content={item.status === 'failed' ? t('toolFindFailTooltip') : null}
            >
              <span className={clsx(styles.chip, item.status === 'failed' && styles.chipFailed)}>
                {item.status === 'wip' ? null : (
                  <span className={styles.chipIcon}>
                    {item.status === 'failed' ? <IconCloseFill14 /> : <IconCheckedOutline14 />}
                  </span>
                )}
                <span className={styles.chipText}>{item.pattern}</span>
              </span>
            </Tooltip>
          ))}
        </>
      )}
    </ToolRow>
  )
}

/** 阅读用户消息中的链接：视图只保留仍在读取的链接。 */
const ReadLinkRow = ({ step, isLast }: { step: ReadLinkStep; isLast: boolean }) => {
  const t = useTranslate()
  return (
    <ToolRow icon={<IconLinkOutline16 />} isLast={isLast}>
      <span className={clsx(styles.intro, styles.shimmer)}>{t('readingLink')}</span>
      {step.links.map((link) => (
        <PageLink key={link.id} page={link} />
      ))}
    </ToolRow>
  )
}
