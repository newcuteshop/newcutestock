import clsx from 'clsx'

// โลโก้ร้านเช่าชุด = ไม้แขวนเสื้อเส้นเดียว บนแผ่นโรสโกลด์อ่อนมุมมน (คู่กับ BrandMark ของ NEWCUTE ที่เป็นถุงช้อปปิ้ง)
// แผ่นสีเดียว + เส้นขอบบาง · ไม่มีไล่สี ไม่มีเงา ไม่มีแอนิเมชัน (ธีมทางการ)
// ตกแต่งล้วน aria-hidden (ชื่อร้านอยู่ในข้อความข้างๆ) · ใช้ได้ทั้ง server และ client component · ไม่ใช้ id ใน SVG

const SIZES = {
  sm: 'h-8 w-8', // แถบบนมือถือ 32px
  md: 'h-10 w-10', // เมนูข้าง / ลิ้นชัก 40px
  lg: 'h-16 w-16', // การ์ดหน้าเลือกร้าน 64px
} as const

type RentalMarkProps = {
  size?: keyof typeof SIZES
  className?: string
}

// สีจาก tailwind.config.ts (SVG ใช้ค่าตรง) — ชุดเดียวกับ BrandMark
const ROSE = '#C14E67' // brand-600
const ROSE_LIGHT = '#FCDCE1' // brand-200

export default function RentalMark({ size = 'md', className }: RentalMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-block shrink-0 overflow-hidden rounded-[22%] bg-brand-100 ring-1 ring-inset ring-brand-200',
        SIZES[size],
        className
      )}
    >
      <svg viewBox="0 0 64 64" className="block h-full w-full" focusable="false">
        {/* ตะขอ: ม้วนจากยอดลงมาที่คอไม้แขวน */}
        <path
          d="M27.5 19.5C27.5 15.5 30 13 33 13C36 13 38.2 15.2 38.2 18C38.2 21 35.8 22.4 33.6 23.4C32.5 23.9 32 24.8 32 26V28"
          fill="none"
          stroke={ROSE}
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* ตัวไม้แขวน: สามเหลี่ยมไหล่ลาด + คานล่าง (พื้นชมพูอ่อนด้านใน) */}
        <path
          d="M32 28L52 42.5Q54.5 44.5 52.5 46.5Q51.8 47 50.5 47L13.5 47Q12.2 47 11.5 46.5Q9.5 44.5 12 42.5Z"
          fill={ROSE_LIGHT}
          stroke={ROSE}
          strokeWidth={3.4}
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
