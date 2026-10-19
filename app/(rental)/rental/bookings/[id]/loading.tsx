// โครงรอโหลดหน้ารายละเอียดการจอง — โครงเดียวกับหน้าจริง (หัว → ปุ่มการกระทำ/รายการ ซ้าย · เงิน/ลูกค้า ขวา)
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-5" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลดการจอง...</span>
      <div className="space-y-2">
        <div className="skeleton h-5 w-32" />
        <div className="page-header">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <div className="skeleton h-8 w-56 max-w-full" />
              <div className="skeleton h-6 w-20 rounded-full" />
            </div>
            <div className="skeleton h-4 w-72 max-w-full" />
          </div>
          <div className="flex gap-2">
            <div className="skeleton h-11 w-28 rounded-lg" />
            <div className="skeleton h-11 w-32 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-5">
        <div className="space-y-4 lg:space-y-5 min-w-0">
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="skeleton h-5 w-36" />
            <div className="skeleton h-16 rounded-lg" />
            <div className="skeleton h-11 rounded-lg" />
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton h-11 rounded-lg" />
              <div className="skeleton h-11 rounded-lg" />
            </div>
          </div>
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="skeleton h-5 w-28" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton h-20 w-16 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4 lg:space-y-5 min-w-0">
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="skeleton h-5 w-24" />
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton h-16 rounded-lg" />
              <div className="skeleton h-16 rounded-lg" />
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton h-4" />
            ))}
          </div>
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-6 w-40" />
            <div className="skeleton h-11 w-48 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
