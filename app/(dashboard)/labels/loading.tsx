export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-8 sm:h-9 w-48 rounded-full" />
          <div className="skeleton h-4 w-64 max-w-full rounded-full" />
        </div>
      </div>
      {/* โครงเดียวกับหน้าจริง: lg+ รายการสินค้ายืดเต็ม + แผงรายการสติกเกอร์กว้างคงที่ */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        <div className="lg:flex-1 min-w-0 card p-4 space-y-3">
          <div className="skeleton h-11 rounded-full" />
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
        <div className="lg:w-[380px] lg:shrink-0 card p-5 h-96 space-y-4">
          <div className="skeleton h-5 w-40 rounded-full" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-12" />
          ))}
          <div className="skeleton h-11 rounded-full" />
        </div>
      </div>
    </div>
  )
}
