export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-7 w-32 bg-gray-200 rounded animate-pulse" />
      {/* โครงเดียวกับหน้าจริง: lg+ ฟอร์มกว้างคงที่ + ประวัติยืดเต็ม / มือถือเรียงลงมา */}
      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        <div className="lg:w-[420px] lg:shrink-0 card p-6 h-40 lg:h-96 animate-pulse" />
        <div className="lg:flex-1 min-w-0 card p-4 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
