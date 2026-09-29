export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-8 sm:h-9 w-32 rounded-full" />
          <div className="skeleton h-4 w-56 max-w-full rounded-full" />
        </div>
      </div>
      {/* โครงเดียวกับหน้าจริง: การ์ดสรุป 3 ใบ (มือถือใบแรกกว้างเต็มแถว) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 xl:gap-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className={`stat-card ${i === 0 ? 'col-span-2 lg:col-span-1' : ''}`}>
            <div className="skeleton h-4 w-20 rounded-full" />
            <div className="skeleton h-8 w-24 rounded-full" />
          </div>
        ))}
      </div>
      {/* กราฟยอดขาย (กว้าง) + กราฟช่องทางชำระ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        <div className="card p-4 sm:p-5 lg:col-span-2 space-y-4">
          <div className="skeleton h-5 w-40 rounded-full" />
          <div className="skeleton h-56 sm:h-72" />
        </div>
        <div className="card p-4 sm:p-5 space-y-4">
          <div className="skeleton h-5 w-32 rounded-full" />
          <div className="skeleton h-56 sm:h-72" />
        </div>
      </div>
    </div>
  )
}
