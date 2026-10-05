export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-44" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-36 rounded-lg" />
      </div>
      {/* แถบเลือกวัน */}
      <div className="card p-3 sm:p-4 flex items-center gap-2">
        <div className="skeleton h-11 w-11 rounded-lg" />
        <div className="skeleton h-11 flex-1 sm:flex-none sm:w-44 rounded-lg" />
        <div className="skeleton h-11 w-11 rounded-lg" />
        <div className="skeleton hidden sm:block h-5 w-48 ml-2" />
      </div>
      {/* แถบสถานะ */}
      <div className="skeleton h-12 rounded-lg" />
      {/* การ์ดสรุป 4 ใบ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 xl:gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="stat-card">
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      {/* มือถือ: ฟอร์มนับเงินขึ้นก่อน / คอม: รายละเอียดซ้าย + ฟอร์มขวา */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:items-start">
        <div className="card order-first lg:order-last lg:w-[400px] xl:w-[440px] lg:shrink-0 p-4 sm:p-5 space-y-4">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton h-11 rounded-lg" />
          <div className="skeleton h-28 rounded-lg" />
          <div className="skeleton h-11 rounded-lg" />
          <div className="skeleton h-12 rounded-lg" />
        </div>
        <div className="lg:flex-1 min-w-0 space-y-4 sm:space-y-6">
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="skeleton h-5 w-36" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton h-9 rounded-lg" />
            ))}
          </div>
          <div className="card p-4 sm:p-5 space-y-3">
            <div className="skeleton h-5 w-32" />
            <div className="skeleton h-24 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
