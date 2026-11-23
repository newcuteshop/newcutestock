// โครงรอโหลดรายงาน: หัวหน้า + ปุ่มส่งออก 3 ปุ่ม → ช่วงวันที่ → การ์ดตัวเลข 4 ใบ → กราฟ + วิธีชำระ → งาน/แพ็กเกจ → ทีมงาน
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-32" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-11 w-full sm:w-48 rounded-lg" />)}
        </div>
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-5 w-28" />
        <div className="flex gap-2 overflow-hidden">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-24 shrink-0 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="skeleton h-11 rounded-lg" />
          <div className="skeleton h-11 rounded-lg" />
          <div className="skeleton h-11 w-full sm:w-32 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
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
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        <div className="skeleton h-80 rounded-xl xl:col-span-2" />
        <div className="skeleton h-80 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="skeleton h-72 rounded-xl" />
        <div className="skeleton h-72 rounded-xl" />
      </div>
    </div>
  )
}
