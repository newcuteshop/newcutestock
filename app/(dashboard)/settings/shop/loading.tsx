export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-48" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
        <div className="skeleton h-11 w-full sm:w-36 rounded-lg" />
      </div>
      {/* โครงเดียวกับหน้าจริง: ฟอร์มยืดเต็ม + ตัวอย่างใบเสร็จกว้างคงที่ด้านขวา (lg+) / มือถือเรียงลงมา */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:items-start">
        <div className="card lg:flex-1 min-w-0 p-4 sm:p-5 space-y-4">
          <div className="skeleton h-5 w-28" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-x-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-11 rounded-lg" />
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <div className="skeleton h-4 w-16" />
              <div className="skeleton h-24 rounded-lg" />
            </div>
            {[...Array(2)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-11 rounded-lg" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="skeleton h-[60px] rounded-lg" />
            <div className="skeleton h-[60px] rounded-lg" />
          </div>
          <div className="skeleton h-14 rounded-lg" />
        </div>
        <div className="card lg:w-[360px] lg:shrink-0 p-4 sm:p-5 space-y-3">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-80 rounded-lg" />
          <div className="skeleton h-11 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
