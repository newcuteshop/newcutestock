// โครงรอโหลดรายชื่อลูกค้า: หัวหน้า + ปุ่ม → กล่องค้นหา/ตัวกรอง → รายการ
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-28" />
          <div className="skeleton h-4 w-64 max-w-full" />
        </div>
        <div className="skeleton h-11 w-36 rounded-lg" />
      </div>
      <div className="space-y-4">
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="skeleton h-11 rounded-lg" />
          <div className="flex gap-2 overflow-hidden">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-24 shrink-0 rounded-lg" />)}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="card-header">
            <div className="skeleton h-5 w-32" />
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
          </div>
        </div>
      </div>
    </div>
  )
}
