export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-56 max-w-full" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-32 rounded-lg" />
      </div>
      {/* การ์ดแพลตฟอร์ม — ป้ายสถานะเป็นแคปซูลเหมือนป้ายจริง */}
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-5 w-36 max-w-full" />
                <div className="skeleton h-3 w-24" />
              </div>
            </div>
            <div className="skeleton h-6 w-28 rounded-full" />
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton h-12" />
              <div className="skeleton h-12" />
            </div>
            <div className="skeleton h-11 w-full sm:w-32 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}
