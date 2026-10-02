import clsx from 'clsx'

// โลโก้ = ถุงช้อปปิ้งโบว์ (แบบเดียวกับไอคอนแอปที่เจ้าของเลือก) วาดใหม่ให้เรียบ: แผ่นโรสโกลด์อ่อนสีเดียว + เส้นขอบบาง
// ถุงพื้นชมพูอ่อน เส้น/โบว์สีโรสโกลด์เข้ม (brand-600) · ไม่มีไล่สี ไม่มีเงา ไม่มีแอนิเมชัน
// ตกแต่งล้วน aria-hidden (ชื่อ "NEWCUTE" อยู่ในข้อความข้างๆ) · ใช้ได้ทั้ง server และ client component
// ไม่ใช้ id ใน SVG (โลโก้มีหลายชุดในหน้าเดียว และชุดในเมนูข้างถูกซ่อนบนมือถือ)

const SIZES = {
  sm: 'h-8 w-8', // แถบบนมือถือ 32px
  md: 'h-10 w-10', // เมนูข้าง / ลิ้นชัก 40px
  lg: 'h-16 w-16', // หน้าเข้าสู่ระบบ / แผ่นปิดหน้าจอ 64px
} as const

type BrandMarkProps = {
  size?: keyof typeof SIZES
  // กรอบบางรอบโลโก้ (หน้าเข้าสู่ระบบ) — เส้นเทา 1px เรียบๆ
  ring?: boolean
  className?: string
}

// สีจาก tailwind.config.ts (SVG ใช้ค่าตรง)
const ROSE = '#C14E67' // brand-600
const ROSE_LIGHT = '#FCDCE1' // brand-200

export default function BrandMark({ size = 'md', ring = false, className }: BrandMarkProps) {
  const mark = (
    // มุมมน 22% เท่ากับไอคอนแอป
    <span
      aria-hidden="true"
      className={clsx(
        'inline-block shrink-0 overflow-hidden rounded-[22%] bg-brand-100 ring-1 ring-inset ring-brand-200',
        SIZES[size],
        !ring && className
      )}
    >
      <svg viewBox="0 0 64 64" className="block h-full w-full" focusable="false">
        {/* หูหิ้ว */}
        <path d="M24.5 27C24.5 11.5 39.5 11.5 39.5 27" fill="none" stroke={ROSE} strokeWidth={4} strokeLinecap="round" />
        {/* ตัวถุง */}
        <path
          d="M18.5 22L45.5 22Q47 22 47.2 23.5L49.8 51.5Q50 54.5 47 54.5L17 54.5Q14 54.5 14.2 51.5L16.8 23.5Q17 22 18.5 22Z"
          fill={ROSE_LIGHT}
          stroke={ROSE}
          strokeWidth={3.6}
          strokeLinejoin="round"
        />
        {/* โบว์: ห่วงซ้าย-ขวา · ชายโบว์ · ปม */}
        <path d="M31 36.5C28 31.5 21 31 21 37.5C21 43.5 28 43.5 31 39.5Z" fill={ROSE} />
        <path d="M33 36.5C36 31.5 43 31 43 37.5C43 43.5 36 43.5 33 39.5Z" fill={ROSE} />
        <path
          d="M30.5 39L27.5 47.5L31 46.5L32 49L33 46.5L36.5 47.5L33.5 39Z"
          fill={ROSE}
          stroke={ROSE}
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <circle cx={32} cy={38} r={3.2} fill={ROSE} stroke={ROSE_LIGHT} strokeWidth={1.2} />
      </svg>
    </span>
  )
  if (!ring) return mark
  // กรอบมุมมนขนานกับแผ่นโลโก้ (เส้นเทาบาง 1px + ช่องว่าง 5px)
  return (
    <span
      aria-hidden="true"
      className={clsx('inline-grid shrink-0 place-items-center rounded-[20px] border border-gray-200 bg-white p-[5px]', className)}
    >
      {mark}
    </span>
  )
}
