// โครงรอโหลดหน้าการเงิน: หัวหน้า → งวดที่ต้องตามเก็บ → เลือกช่วง → การ์ดตัวเลข 4 ใบ → ตารางแยกวิธี/รายการ → รายการ
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-32" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-44 rounded-lg" />
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-5 w-40" />
        {[0, 1].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
      </div>
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex gap-2">
          <div className="skeleton h-11 md:h-9 w-24 rounded-lg" />
          <div className="skeleton h-11 md:h-9 w-24 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
          <div className="skeleton h-11 flex-1 sm:flex-none sm:w-44 rounded-lg" />
          <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
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
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="skeleton h-56 rounded-xl" />
        <div className="skeleton h-56 rounded-xl" />
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-5 w-44" />
        {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
      </div>
    </div>
  )
}
