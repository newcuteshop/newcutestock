export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-56 max-w-full" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
      </div>
      {/* โครงเดียวกับหน้าจริง: กล่องตัวกรอง (ค้นหา / เลือกวัน / สถานะ) + รายการบิล */}
      <div className="space-y-4">
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="flex gap-2">
            <div className="skeleton h-11 flex-1 rounded-lg" />
            <div className="skeleton h-11 w-14 sm:w-24 shrink-0 rounded-lg" />
          </div>
          <div className="flex gap-2">
            <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
            <div className="skeleton h-11 flex-1 rounded-lg" />
            <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
          </div>
          <div className="skeleton h-4 w-48 max-w-full" />
          <div className="flex flex-wrap gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-20 rounded-lg" />)}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="card-header">
            <div className="skeleton h-5 w-32" />
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        </div>
      </div>
    </div>
  )
}
