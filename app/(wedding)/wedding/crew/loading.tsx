// โครงรอโหลดหน้าทีมงาน: หัวหน้า → แท็บ → ช่องค้นหา → การ์ดทีมงาน (2 คอลัมน์บนจอกว้าง)
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-28" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map(i => <div key={i} className="skeleton h-11 md:h-9 w-32 rounded-lg" />)}
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-11 rounded-lg" />
        <div className="flex gap-2">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-11 md:h-9 w-24 rounded-lg" />)}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-5 w-40" />
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
