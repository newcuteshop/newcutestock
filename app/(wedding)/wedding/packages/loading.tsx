// โครงรอโหลดหน้าแพ็กเกจ: หัวหน้า → การ์ดแพ็กเกจ (2 คอลัมน์บนจอกว้าง) → รายการบริการเสริม
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-52" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-11 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:p-5 md:grid-cols-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-4">
              <div className="skeleton h-5 w-40" />
              <div className="skeleton h-6 w-24" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-5 w-36" />
        {[0, 1, 2].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}
      </div>
    </div>
  )
}
