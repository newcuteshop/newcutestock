export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      {/* หัวเรื่อง + ปุ่มเริ่มรอบใหม่ (คอมอยู่แถวเดียวกัน) */}
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-40" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-48 rounded-lg" />
      </div>
      {/* รอบที่กำลังนับ: การ์ด */}
      <div className="space-y-3">
        <div className="skeleton h-6 w-32" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="skeleton h-5 w-40 max-w-full" />
                <div className="skeleton h-6 w-20 shrink-0 rounded-full" />
              </div>
              <div className="skeleton h-4 w-28" />
              <div className="skeleton h-3 w-52 max-w-full" />
              <div className="pt-3 border-t border-gray-150 flex justify-between gap-3">
                <div className="skeleton h-4 w-28" />
                <div className="skeleton h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* ประวัติ */}
      <div className="card p-4 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    </div>
  )
}
