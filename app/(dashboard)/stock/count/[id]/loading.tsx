export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      {/* ลิงก์กลับ + ชื่อรอบ + สถานะ */}
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-4 w-36" />
          <div className="skeleton h-7 sm:h-8 w-56 max-w-full" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-36 rounded-lg" />
      </div>
      {/* โครงเดียวกับหน้าจริง: lg+ ช่องสแกนกว้างคงที่ + รายการยืดเต็ม / มือถือเรียงลงมา */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        <div className="lg:w-[380px] lg:shrink-0 card p-4 sm:p-5 space-y-3">
          <div className="skeleton h-5 w-32" />
          <div className="flex gap-2">
            <div className="skeleton h-11 flex-1 rounded-lg" />
            <div className="skeleton h-11 w-24 rounded-lg" />
          </div>
          <div className="skeleton h-4 w-60 max-w-full" />
        </div>
        <div className="lg:flex-1 min-w-0 space-y-3">
          <div className="flex gap-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="skeleton h-11 md:h-9 w-28 rounded-lg" />
            ))}
          </div>
          <div className="card p-4 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="skeleton h-12" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
