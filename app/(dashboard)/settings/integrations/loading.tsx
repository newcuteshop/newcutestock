export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-8 sm:h-9 w-56 max-w-full rounded-full" />
          <div className="skeleton h-4 w-80 max-w-full rounded-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-32 rounded-full" />
      </div>
      {/* การ์ดแพลตฟอร์ม */}
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="skeleton h-[42px] w-[42px] shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-5 w-36 max-w-full rounded-full" />
                <div className="skeleton h-3 w-24 rounded-full" />
              </div>
            </div>
            <div className="skeleton h-7 w-28 rounded-full" />
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton h-12" />
              <div className="skeleton h-12" />
            </div>
            <div className="skeleton h-11 w-full sm:w-32 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
