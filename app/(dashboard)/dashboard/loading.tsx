// โครงรอโหลดหน้าภาพรวม — วางตามหน้าจริง (การ์ดตัวเลข → ทำรายการด่วน + สต๊อกใกล้หมด) กันหน้ากระโดดตอนข้อมูลมา
// .skeleton = เทาอ่อน กะพริบจางช้าๆ (หยุดเองเมื่อเครื่องตั้ง "ลดการเคลื่อนไหว") · ปุ่ม/ช่องกรอกมุม rounded-lg เท่าของจริง
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-32" />
          <div className="skeleton h-4 w-48" />
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
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 items-start">
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="skeleton h-4 w-28" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-11 rounded-lg" />
          ))}
        </div>
        <div className="card p-4 sm:p-5 space-y-3 xl:col-span-2">
          <div className="skeleton h-5 w-44" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-10" />
          ))}
        </div>
      </div>
    </div>
  )
}
