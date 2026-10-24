import type { Item, SlotName, TrayState } from '../types'

// Normalized slot rects from config.yaml → workspace.slots ([x, y, w, h]).
const SLOTS: Record<SlotName, [number, number, number, number]> = {
  slot_A: [0.05, 0.05, 0.42, 0.4],
  slot_B: [0.53, 0.05, 0.42, 0.4],
  slot_C: [0.05, 0.55, 0.42, 0.4],
  slot_D: [0.53, 0.55, 0.42, 0.4],
}
const SLOT_WORDS: Record<SlotName, string> = { slot_A: 'top left', slot_B: 'top right', slot_C: 'bottom left', slot_D: 'bottom right' }
const ITEM_WORDS: Record<Item, string> = { soap: 'blue soap', shampoo: 'green shampoo', lotion: 'yellow lotion', cloth: 'white washcloth' }

const W = 200
const H = 150
const PAD = 10

function ItemShape({ item, x, y, w, h }: { item: Item; x: number; y: number; w: number; h: number }) {
  const cx = x + w / 2
  const cy = y + h / 2
  switch (item) {
    case 'soap':
      return <rect x={cx - w * 0.3} y={cy - h * 0.22} width={w * 0.6} height={h * 0.44} rx={8} style={{ fill: 'var(--item-soap)' }} />
    case 'shampoo':
      return (
        <g>
          <rect x={cx - w * 0.16} y={cy - h * 0.36} width={w * 0.32} height={h * 0.72} rx={7} style={{ fill: 'var(--item-shampoo)' }} />
          <rect x={cx - w * 0.07} y={cy - h * 0.46} width={w * 0.14} height={h * 0.14} rx={2} style={{ fill: 'var(--ink-2)' }} />
        </g>
      )
    case 'lotion':
      return (
        <g>
          <ellipse cx={cx} cy={cy + h * 0.04} rx={w * 0.22} ry={h * 0.32} style={{ fill: 'var(--item-lotion)' }} />
          <rect x={cx - w * 0.06} y={cy - h * 0.42} width={w * 0.12} height={h * 0.12} rx={2} style={{ fill: 'var(--ink-2)' }} />
        </g>
      )
    case 'cloth':
      return (
        <g>
          <rect x={cx - w * 0.36} y={cy - h * 0.3} width={w * 0.72} height={h * 0.6} rx={4} style={{ fill: 'var(--item-cloth)', stroke: 'var(--tray-edge)', strokeWidth: 1.5 }} />
          <line x1={cx - w * 0.36} y1={cy} x2={cx + w * 0.36} y2={cy} style={{ stroke: 'var(--tray-edge)', strokeWidth: 1.5, strokeDasharray: '4 3' }} />
        </g>
      )
  }
}

function Marker({ x, y }: { x: number; y: number }) {
  // Stylized ArUco corner marker
  return (
    <g>
      {/* Printed markers are black on white in every theme */}
      <rect x={x} y={y} width={14} height={14} fill="#111111" />
      <rect x={x + 3} y={y + 3} width={4} height={4} fill="#ffffff" />
      <rect x={x + 7} y={y + 7} width={4} height={4} fill="#ffffff" />
    </g>
  )
}

/** Placeholder for the rectified top-down tray view / step reference photo. */
export function Tray({
  tray,
  highlight,
  almost,
  onDone,
  className = '',
  label,
}: {
  tray: TrayState
  highlight?: SlotName | 'done_mark'
  almost?: SlotName
  onDone?: boolean
  className?: string
  label?: string
}) {
  const iw = W - PAD * 2
  const ih = H - PAD * 2 - 12
  const contents = (Object.entries(tray) as [SlotName, Item][]).map(([s, i]) => `${ITEM_WORDS[i]} ${SLOT_WORDS[s]}`)
  const aria = label ?? (contents.length ? `Tray: ${contents.join(', ')}` : 'Empty tray')
  return (
    <svg className={`tray-svg ${className}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
      <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--surface-2)' }} />
      <rect
        x={PAD - 4}
        y={PAD - 4 + (onDone ? 6 : 0)}
        width={iw + 8}
        height={ih + 8}
        rx={10}
        style={{ fill: 'var(--tray)', stroke: 'var(--tray-edge)', strokeWidth: 2 }}
      />
      {(Object.keys(SLOTS) as SlotName[]).map((s) => {
        const [nx, ny, nw, nh] = SLOTS[s]
        const x = PAD + nx * iw
        const y = PAD + ny * ih + (onDone ? 6 : 0)
        const w = nw * iw
        const h = nh * ih
        const isHi = highlight === s
        const isAlmost = almost === s
        return (
          <g key={s}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={6}
              style={{
                fill: 'var(--slot)',
                stroke: isAlmost ? 'var(--almost-fill)' : isHi ? 'var(--primary)' : 'var(--tray-edge)',
                strokeWidth: isHi || isAlmost ? 3 : 1,
                strokeDasharray: isHi ? '6 4' : undefined,
              }}
            />
            {tray[s] && <ItemShape item={tray[s]!} x={x} y={y} w={w} h={h} />}
          </g>
        )
      })}
      <Marker x={2} y={2 + (onDone ? 6 : 0)} />
      <Marker x={W - 16} y={2 + (onDone ? 6 : 0)} />
      <Marker x={2} y={PAD + ih - 6 + (onDone ? 6 : 0)} />
      <Marker x={W - 16} y={PAD + ih - 6 + (onDone ? 6 : 0)} />
      <rect
        x={W * 0.4}
        y={H - 10}
        width={W * 0.2}
        height={6}
        rx={3}
        style={{ fill: highlight === 'done_mark' || onDone ? 'var(--primary)' : 'var(--tray-edge)' }}
      />
    </svg>
  )
}
