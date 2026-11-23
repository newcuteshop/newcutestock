// วงกลมสีประจำตัวทีมงาน + อักษรย่อ (ตกแต่ง — ชื่อเต็มอยู่ในข้อความข้างๆ เสมอ จึง aria-hidden)
// สีมาจากชุด CREW_COLORS (ตัวอักษรขาวอ่านได้ทุกสี ≥ 4.5:1) — ค่าที่ไม่ใช่ #RRGGBB ถูกตัวอ่านเปลี่ยนเป็นสีเริ่มต้นแล้ว
import clsx from 'clsx'
import { crewInitial } from './crewModel'

const SIZES = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' } as const

export default function CrewAvatar({
  crew,
  size = 'md',
  className,
}: {
  crew: { name: string; nickname?: string | null; color: string; is_active?: boolean }
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none text-white',
        SIZES[size],
        crew.is_active === false && 'opacity-60',
        className,
      )}
      style={{ backgroundColor: crew.color }}
    >
      {crewInitial(crew)}
    </span>
  )
}
