export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-5 w-36" />
          <div className="skeleton h-7 sm:h-8 w-64 max-w-full" />
          <div className="skeleton h-4 w-96 max-w-full" />
        </div>
      </div>

      {/* โครงเดียวกับหน้าจริง: ขั้นที่ 1 เตรียมไฟล์ + ขั้นที่ 2 เลือกไฟล์ (lg+ วางคู่กัน) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6 lg:items-start">
        <div className="card p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="skeleton h-8 w-8 rounded-lg" />
            <div className="skeleton h-5 w-40" />
          </div>
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-11 w-full sm:w-52 rounded-lg" />
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton h-9" />
            ))}
          </div>
        </div>
        <div className="card p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="skeleton h-8 w-8 rounded-lg" />
            <div className="skeleton h-5 w-32" />
          </div>
          <div className="skeleton h-36 w-full rounded-lg" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      </div>
    </div>
  )
}
