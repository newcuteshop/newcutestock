import clsx from 'clsx'

// โลโก้ = ไอคอนแอปแบบ 06 "ถุงช้อปปิ้งโบว์" (ถุงบลัช หูหิ้ว + โบว์สีกุหลาบสตรอว์เบอร์รี บนแผ่นนมชมพูมุมมน)
// วาดจากไฟล์รุ่นจอเล็ก (icon06-favicon.svg) → เส้นหนาพอ คมชัดที่ 32-44px · ตกแต่งล้วน aria-hidden (ชื่อ "NEWCUTE" อยู่ในข้อความข้างๆ)
// พื้นแผ่นไล่สีด้วย CSS (ไม่ใช้ <linearGradient id> ใน SVG — โลโก้มีหลายชุดในหน้าเดียว และชุดในเมนูข้างถูกซ่อนบนมือถือ
// ถ้าใช้ id ซ้ำ เบราว์เซอร์อาจไปอ้างชุดที่ถูกซ่อนแล้วพื้นหายได้) · นิ่ง ไม่มีเงา/แอนิเมชัน (สะอาด และไม่กินแบตมือถือ)
// ใช้ได้ทั้ง server และ client component

const SIZES = {
  sm: 'h-[34px] w-[34px]', // แถบบนมือถือ
  md: 'h-[42px] w-[42px]', // เมนูข้าง / ลิ้นชัก
  lg: 'h-[68px] w-[68px]', // หน้าเข้าสู่ระบบ
} as const

type BrandMarkProps = {
  size?: keyof typeof SIZES
  // กรอบเส้นประรอบโลโก้ (หน้าเข้าสู่ระบบ)
  ring?: boolean
  className?: string
}

export default function BrandMark({ size = 'md', ring = false, className }: BrandMarkProps) {
  const mark = (
    // มุมมน 22% = rx 14 จาก 64 เท่ากับไอคอนแอป · ขอบชมพูสตรอว์เบอร์รี 1px ให้แผ่นไม่กลืนกับพื้นบลัชของเมนูข้าง
    <span
      aria-hidden="true"
      className={clsx(
        'inline-block shrink-0 overflow-hidden rounded-[22%] bg-gradient-to-br from-milk to-blush ring-1 ring-strawberry',
        SIZES[size],
        !ring && className
      )}
    >
      <svg viewBox="0 0 64 64" className="block h-full w-full" focusable="false">
        {/* หูหิ้ว */}
        <path d="M24.5 27C24.5 10.5 39.5 10.5 39.5 27" fill="none" stroke="#B23A5E" strokeWidth={4.5} strokeLinecap="round" />
        {/* ตัวถุง */}
        <path
          d="M18.5 22L45.5 22Q47 22 47.2 23.5L49.8 51.5Q50 54.5 47 54.5L17 54.5Q14 54.5 14.2 51.5L16.8 23.5Q17 22 18.5 22Z"
          fill="#FCD9E1"
          stroke="#B23A5E"
          strokeWidth={4}
          strokeLinejoin="round"
        />
        {/* โบว์: ห่วงซ้าย-ขวา · ชายโบว์ · ปม */}
        <path d="M31 36.5C28 31.5 21 31 21 37.5C21 43.5 28 43.5 31 39.5Z" fill="#B23A5E" />
        <path d="M33 36.5C36 31.5 43 31 43 37.5C43 43.5 36 43.5 33 39.5Z" fill="#B23A5E" />
        <path
          d="M30.5 39L27.5 47.5L31 46.5L32 49L33 46.5L36.5 47.5L33.5 39Z"
          fill="#B23A5E"
          stroke="#B23A5E"
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <circle cx={32} cy={38} r={3.2} fill="#B23A5E" stroke="#FCD9E1" strokeWidth={1.2} />
      </svg>
    </span>
  )
  if (!ring) return mark
  // กรอบมุมมนขนานกับแผ่นโลโก้ (มุมแผ่น 15px + ช่องว่าง 6px + เส้น 2px = 23px)
  return (
    <span
      aria-hidden="true"
      className={clsx('inline-grid shrink-0 place-items-center rounded-[23px] border-2 border-dashed border-strawberry p-[6px]', className)}
    >
      {mark}
    </span>
  )
}
