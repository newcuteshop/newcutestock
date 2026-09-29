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
      {/* ช่องค้นหา + หมวดหมู่ */}
      <div className="card p-4 flex flex-col gap-3 sm:flex-row">
        <div className="skeleton h-11 flex-1 rounded-full" />
        <div className="skeleton h-11 w-full sm:w-48 rounded-full" />
      </div>
      <div className="card p-4 space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="skeleton h-12" />
        ))}
      </div>
    </div>
  )
}
