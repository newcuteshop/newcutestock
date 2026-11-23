import clsx from 'clsx'

// โลโก้ร้าน b.oncloud (คอนเทนต์งานแต่ง) = ก้อนเมฆเส้นเดียว บนแผ่นสีมุมมน (คู่กับ BrandMark ของ NEWCUTE / RentalMark ของร้านเช่า)
// ธีม #13 ทองแชมเปญ (23/11/2569): แผ่น brand-400 (ทอง #DCC291) + เส้น brand-900 (#3A2C12)
// สีมาจากคลาส Tailwind (ตัวแปร CSS ของร้าน) ไม่ใช่ hex ตายตัว → ตามร้านของ data-shop ที่ครอบอยู่ (หน้าร้าน / การ์ดใน /select ที่ใส่ data-shop="wedding")
// แผ่นสีเดียว ไม่มีไล่สี ไม่มีเงา ไม่มีแอนิเมชัน (ธีมทางการ)
// ตกแต่งล้วน aria-hidden (ชื่อร้านอยู่ในข้อความข้างๆ) · ใช้ได้ทั้ง server และ client component · ไม่ใช้ id ใน SVG

const SIZES = {
  sm: 'h-8 w-8', // แถบบนมือถือ 32px
  md: 'h-10 w-10', // เมนูข้าง / ลิ้นชัก 40px
  lg: 'h-16 w-16', // การ์ดหน้าเลือกร้าน / หัวเอกสาร 64px
} as const

type WeddingMarkProps = {
  size?: keyof typeof SIZES
  className?: string
}

export default function WeddingMark({ size = 'md', className }: WeddingMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        // เส้นเมฆใช้ currentColor = text-brand-900
        'inline-block shrink-0 overflow-hidden rounded-[22%] bg-brand-400 text-brand-900',
        SIZES[size],
        className
      )}
    >
      <svg viewBox="0 0 64 64" className="block h-full w-full" focusable="false">
        {/* ก้อนเมฆ: ฐานแบนมุมมน + โค้งเล็กซ้าย + โค้งใหญ่ตรงกลาง + โค้งกลางขวา (เส้นอย่างเดียว เห็นพื้นแผ่นด้านใน) */}
        <path
          d="M19 45H46.5C51.2 45 55 41.4 55 36.8C55 32.4 51.6 28.9 47.3 28.6C46.2 22.2 40.6 17.5 34 17.5C27.8 17.5 22.6 21.6 21.1 27.4C15.4 27.8 11 32.3 11 37.4C11 41.6 14.6 45 19 45Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
