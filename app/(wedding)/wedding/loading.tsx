// โครงรอโหลดหน้าในร้าน b.oncloud (ใช้กับทุกหน้าใต้ /wedding ที่ไม่มี loading.tsx ของตัวเอง) — แบบเดียวกับร้านเช่าชุด
// หัวหน้า → การ์ดตัวเลข 4 ใบ → รายการ — กันหน้ากระโดดตอนข้อมูลมา · .skeleton = เทาอ่อน กะพริบจางช้าๆ (หยุดเองเมื่อ "ลดการเคลื่อนไหว")
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-40" />
          <div className="skeleton h-4 w-56 max-w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 xl:gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-start justify-between gap-2">
              <div className="skeleton h-4 w-20" />
              <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
            </div>
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-5 w-44" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-11 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
