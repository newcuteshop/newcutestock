export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-8 sm:h-9 w-40 rounded-full" />
          <div className="skeleton h-4 w-56 max-w-full rounded-full" />
        </div>
      </div>
      {/* โครงเดียวกับหน้าจริง: lg+ ฟอร์มกว้างคงที่ + ประวัติยืดเต็ม / มือถือเรียงลงมา */}
      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        <div className="lg:w-[420px] lg:shrink-0 card p-4 sm:p-5 space-y-4 lg:h-96">
          {/* ปุ่มเลือกประเภท 4 แบบ */}
          <div className="grid grid-cols-4 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton h-[52px] rounded-2xl" />
            ))}
          </div>
          <div className="skeleton h-11 rounded-full" />
          <div className="skeleton h-11 rounded-full hidden lg:block" />
          <div className="skeleton h-11 rounded-full hidden lg:block" />
        </div>
        <div className="lg:flex-1 min-w-0 card p-4 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
      </div>
    </div>
  )
}
