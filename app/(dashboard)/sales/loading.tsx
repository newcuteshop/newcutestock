export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-40" />
          <div className="skeleton h-4 w-64 max-w-full" />
        </div>
      </div>
      {/* โครงเดียวกับหน้าจริง: lg+ สินค้ายืดเต็ม + ตะกร้ากว้างคงที่ / มือถือเรียงลงมา */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        <div className="lg:flex-1 min-w-0 space-y-3">
          {/* ช่องค้นหา + ปุ่มสแกน */}
          <div className="flex gap-2">
            <div className="skeleton h-11 flex-1 rounded-lg" />
            <div className="skeleton h-11 w-24 shrink-0 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 min-[1150px]:grid-cols-3 gap-2 sm:gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card p-3 sm:p-3.5 min-h-[72px] space-y-2">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="lg:w-[380px] xl:w-[420px] lg:shrink-0 card p-4 sm:p-5 space-y-4 h-96">
          <div className="skeleton h-5 w-28" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-14 rounded-lg" />
          ))}
          <div className="skeleton h-12 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
