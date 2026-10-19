// โครงรอโหลดของหน้าสร้าง/แก้ไขการจอง (server component — ไม่มีสถานะ)
// หัวหน้า → แถบขั้นตอน → การ์ดฟอร์ม 2 ใบ + แถบสรุปข้างจอ (จอกว้าง) — กันหน้ากระโดดตอนข้อมูลมา
export default function BookingFormSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-44" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="skeleton h-11 w-32 rounded-lg" />
      </div>
      <div className="space-y-4">
        <div className="card px-4 py-3 sm:px-5">
          <div className="skeleton h-9 w-full rounded-lg" />
        </div>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <div className="card p-4 sm:p-5 space-y-4">
              <div className="skeleton h-6 w-48" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="skeleton h-11 rounded-lg" />
                <div className="skeleton h-11 rounded-lg" />
              </div>
              <div className="skeleton h-10 w-2/3 rounded-lg" />
            </div>
            <div className="card p-4 sm:p-5 space-y-4">
              <div className="skeleton h-6 w-40" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="skeleton h-11 rounded-lg" />
                <div className="skeleton h-11 rounded-lg" />
                <div className="skeleton h-11 rounded-lg" />
              </div>
            </div>
          </div>
          <div className="hidden lg:block card p-4 space-y-3">
            <div className="skeleton h-6 w-32" />
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-5 rounded" />)}
            <div className="skeleton h-24 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
