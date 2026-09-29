import type { CSSProperties } from 'react'

// กลีบกุหลาบปลิว (จากแบบธีม 11) — ชั้นตกแต่งหลังสุดของทุกหน้า (วางไว้ใน app/layout.tsx)
// - อยู่ใต้เนื้อหาทั้งหมด (z-index -1) แตะทะลุ ไม่มี JS — สไตล์/keyframes อยู่ใน app/globals.css (.petal-layer, petal-drift)
// - มือถือ 4 กลีบ, จอ md ขึ้นไป 8 กลีบ · ขยับด้วย transform/opacity เท่านั้น
// - หยุดนิ่งเมื่อปิดเอฟเฟกต์ (html[data-motion="off"]) หรือเครื่องตั้งลดการเคลื่อนไหว, ซ่อนตอนพิมพ์
// - หลักของแบบ: กลีบ "ไม่ลอยทับตัวหนังสือ" → กลีบแถบหัวเรื่อง (band) วางขวาของหัวเรื่อง และในหน้าระบบจอเล็กกว่า xl
//   (หัวเรื่องกินเต็มแถบ) ถูกซ่อนด้วย CSS (.petal-band ใน globals.css) — มือถือมีกลีบในแถบบนแทน (TopbarPetals)

type Petal = {
  left: string
  top: string
  size: number
  outer: string // สีกลีบ
  inner: string // สีแสงในกลีบ
  delay: string // ค่าลบ = เริ่มกลางทาง ไม่ให้ทุกกลีบโผล่พร้อมกัน
  duration: string
  dx: string // ระยะลอยไปทางขวา
  dy: string // ระยะลอยลง
  rot: string // หมุนรวมตลอดทาง
  opacity?: number
  desktopOnly?: boolean
  band?: boolean // ลอยในแถบหัวเรื่อง (ซ่อนในหน้าระบบเมื่อจอแคบ)
}

// รูปกลีบจากแบบ (viewBox 32×32)
const PETAL_OUTER = 'M17 3c7 1 12 7 11.5 15-.5 8.5-8 12.5-14.5 11.5C7 28.5 3 23 4 16 5 8.5 10.5 2.2 17 3z'
const PETAL_INNER = 'M16.5 6.5c5 1 8.5 5.5 8 11-.3 3-2 5.5-4.5 7C22 20 20 13 16.5 6.5z'

const PETALS: Petal[] = [
  // 4 กลีบแรก: แสดงทุกขนาดจอ (แถบหัวเรื่องด้านขวา + ขอบซ้าย/ขวา + ล่าง)
  { left: '52%', top: '11%', size: 28, outer: '#EDB0B8', inner: '#F7D3D7', delay: '0s', duration: '8s', dx: '170px', dy: '70px', rot: '160deg', band: true },
  { left: '4%', top: '34%', size: 20, outer: '#E6A3AE', inner: '#F6D5D6', delay: '-3.8s', duration: '9s', dx: '18px', dy: '170px', rot: '150deg' },
  { left: '90%', top: '46%', size: 18, outer: '#EDB0B8', inner: '#F7D3D7', delay: '-6.2s', duration: '10s', dx: '-6px', dy: '180px', rot: '170deg' },
  { left: '30%', top: '78%', size: 18, outer: '#E9B8B3', inner: '#F9E3E2', delay: '-1s', duration: '8.5s', dx: '180px', dy: '16px', rot: '220deg' },
  // อีก 4 กลีบ: เฉพาะจอ md ขึ้นไป
  { left: '60%', top: '5%', size: 20, outer: '#E9B8B3', inner: '#F6D5D6', delay: '-2.6s', duration: '8s', dx: '140px', dy: '40px', rot: '-120deg', desktopOnly: true, band: true },
  { left: '56%', top: '1%', size: 22, outer: '#D99AA3', inner: '#F0C4C9', delay: '-5.2s', duration: '9.5s', dx: '190px', dy: '90px', rot: '200deg', desktopOnly: true, band: true },
  { left: '75%', top: '29%', size: 24, outer: '#EDB0B8', inner: '#F7D3D7', delay: '-1.4s', duration: '8s', dx: '8px', dy: '170px', rot: '120deg', opacity: 0.7, desktopOnly: true },
  { left: '68%', top: '92%', size: 16, outer: '#D99AA3', inner: '#F0C4C9', delay: '-4.6s', duration: '9s', dx: '160px', dy: '12px', rot: '-160deg', desktopOnly: true },
]

// กลีบในแถบบนมือถือ: ลอยผ่านที่ว่างด้านขวาของแถบ (กล่อง .topbar-petals ตัดขอบไว้ ไม่ทับปุ่มเมนู/ชื่อร้าน)
const TOPBAR_PETALS: Petal[] = [
  { left: '2%', top: '8%', size: 20, outer: '#EDB0B8', inner: '#F7D3D7', delay: '-1.2s', duration: '8s', dx: '110px', dy: '16px', rot: '160deg' },
  { left: '48%', top: '40%', size: 16, outer: '#D99AA3', inner: '#F0C4C9', delay: '-5s', duration: '9s', dx: '80px', dy: '-10px', rot: '-140deg' },
]

// ตำแหน่ง + ตัวแปร CSS ของแต่ละกลีบ (--t เวลา, --d หน่วง, --dx/--dy ระยะ, --rot หมุน, --o ความทึบ)
function petalStyle(p: Petal): CSSProperties {
  return {
    left: p.left,
    top: p.top,
    '--t': p.duration,
    '--d': p.delay,
    '--dx': p.dx,
    '--dy': p.dy,
    '--rot': p.rot,
    '--o': String(p.opacity ?? 0.9),
  } as CSSProperties
}

function PetalShape({ p, className }: { p: Petal; className: string }) {
  return (
    <span className={className} style={petalStyle(p)}>
      <svg width={p.size} height={p.size} viewBox="0 0 32 32" focusable="false">
        <path d={PETAL_OUTER} fill={p.outer} />
        <path d={PETAL_INNER} fill={p.inner} />
      </svg>
    </span>
  )
}

export default function PetalLayer() {
  return (
    <div className="petal-layer" aria-hidden="true">
      {PETALS.map((p, i) => (
        <PetalShape
          key={i}
          p={p}
          className={['petal', p.desktopOnly ? 'hidden md:block' : '', p.band ? 'petal-band' : ''].filter(Boolean).join(' ')}
        />
      ))}
    </div>
  )
}

// ใช้ใน components/layout/MobileNav.tsx (แถบบนมือถือ) — ต้องวางในกล่องที่เป็น position: relative
export function TopbarPetals() {
  return (
    <div className="topbar-petals decor" aria-hidden="true">
      {TOPBAR_PETALS.map((p, i) => <PetalShape key={i} p={p} className="petal" />)}
    </div>
  )
}
