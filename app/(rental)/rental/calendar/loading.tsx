// โครงรอโหลดหน้าปฏิทิน: หัวหน้า → แท็บ 2 อัน → กล่องเลือกเดือน → ตารางเดือน (มือถือ = รายการ)
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-32" />
          <div className="skeleton h-4 w-72 max-w-full" />
        </div>
        <div className="skeleton h-11 w-36 rounded-lg" />
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 sm:w-80">
          <div className="skeleton h-11 rounded-lg" />
          <div className="skeleton h-11 rounded-lg" />
        </div>
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
            <div className="skeleton h-6 flex-1 max-w-[12rem] mx-auto" />
            <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
          </div>
          <div className="flex flex-wrap gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-20 rounded-lg" />)}
          </div>
        </div>
        <div className="hidden md:grid card grid-cols-7 gap-px overflow-hidden p-0">
          {[...Array(35)].map((_, i) => <div key={i} className="skeleton h-24 rounded-none" />)}
        </div>
        <div className="md:hidden space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
        </div>
      </div>
    </div>
  )
}
