import clsx from 'clsx'
import styles from './Switch.module.css'

/**
 * 开 / 关两态的开关。
 *
 * 命中区 48×44（规矩 5：主操作 ≥44dp），可见的只有中间那颗 40×24 的滑轨，
 * 所以手指点在轨道上下两三毫米也能切换。`role="switch"` 让读屏念「开 / 关」，
 * 空格与回车都按原生按钮的行为走。
 */
export const Switch = ({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    className={clsx(styles.switch, checked && styles.on)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.track} aria-hidden>
      <span className={styles.knob} />
    </span>
  </button>
)
