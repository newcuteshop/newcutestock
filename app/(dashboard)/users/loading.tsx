export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      {/* หัวเรื่อง + ปุ่มเพิ่มผู้ใช้ (คอมอยู่แถวเดียวกัน) */}
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-8 sm:h-9 w-48 rounded-full" />
          <div className="skeleton h-4 w-64 max-w-full rounded-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-36 rounded-full" />
      </div>
      {/* มือถือ / iPad แนวตั้ง: การ์ดรายคน (แบบเดียวกับหน้าจริง) */}
      <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 min-w-0 flex-1">
                <div className="skeleton h-4 w-24 rounded-full" />
                <div className="skeleton h-4 w-36 max-w-full rounded-full" />
              </div>
              <div className="skeleton h-7 w-16 shrink-0 rounded-full" />
            </div>
            <div className="skeleton h-3 w-44 max-w-full rounded-full" />
            <div className="flex gap-2 pt-3 border-t border-brand-100">
              <div className="skeleton h-11 flex-1 rounded-full" />
              <div className="skeleton h-11 flex-1 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      {/* คอม: ตาราง */}
      <div className="hidden lg:block card p-4 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-12" />
        ))}
      </div>
    </div>
  )
}
