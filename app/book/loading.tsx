// โครงรอโหลดของหน้าจองออนไลน์ (แถบบน/ท้ายหน้าอยู่ใน layout แล้ว) — การ์ดชุดเทาอ่อนกะพริบจาง
export default function BookLoading() {
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="card space-y-3 p-4 sm:p-6">
        <div className="skeleton h-7 w-2/3 max-w-xs" />
        <div className="skeleton h-4 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton aspect-[3/4] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
