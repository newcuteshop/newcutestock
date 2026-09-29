export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-8 sm:h-9 w-32 rounded-full" />
          <div className="skeleton h-4 w-48 rounded-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-36 rounded-full" />
      </div>

      {/* ช่องค้นหา + แถบหมวดหมู่ */}
      <div className="card p-4 sm:p-5 space-y-4">
        <div className="flex gap-2">
          <div className="skeleton h-11 flex-1 rounded-full" />
          <div className="skeleton h-11 w-11 rounded-full" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-4 w-24 rounded-full" />
          <div className="flex gap-2 overflow-hidden">
            {[20, 16, 24, 18, 20].map((w, i) => (
              <div key={i} className="skeleton h-11 md:h-9 shrink-0 rounded-full" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
        </div>
      </div>

      {/* การ์ดสินค้า (คอลัมน์เท่ากับหน้าจริง) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 min-[1152px]:grid-cols-5 xl:grid-cols-6">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton aspect-[4/5] w-full rounded-none" />
            <div className="p-3 space-y-2">
              <div className="skeleton h-4 w-4/5 rounded-full" />
              <div className="skeleton h-4 w-1/2 rounded-full" />
              <div className="skeleton h-5 w-2/3 rounded-full" />
              <div className="flex gap-1">
                <div className="skeleton h-6 w-10 rounded-full" />
                <div className="skeleton h-6 w-10 rounded-full" />
                <div className="skeleton h-6 w-10 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
