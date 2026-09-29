export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
      {/* โครงเดียวกับหน้าจริง: lg+ รายการสินค้ายืดเต็ม + แผงรายการสติกเกอร์กว้างคงที่ */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        <div className="lg:flex-1 min-w-0 card p-4 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
        <div className="lg:w-[380px] lg:shrink-0 card p-5 h-96 animate-pulse" />
      </div>
    </div>
  )
}
