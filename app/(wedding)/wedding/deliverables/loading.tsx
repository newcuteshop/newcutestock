// โครงรอโหลดกระดานส่งงาน: หัวหน้า → ตัวกรอง → 3 คอลัมน์ (มือถือเรียงลงมา)
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-40" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="flex gap-2 overflow-hidden">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-24 shrink-0 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="skeleton col-span-2 lg:col-span-1 h-11 rounded-lg" />
          <div className="skeleton col-span-2 lg:col-span-1 h-11 rounded-lg" />
          <div className="skeleton h-11 rounded-lg" />
          <div className="skeleton h-11 rounded-lg" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="panel space-y-3 p-3">
            <div className="skeleton h-5 w-24" />
            {[0, 1].map(j => <div key={j} className="skeleton h-32 rounded-xl" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
