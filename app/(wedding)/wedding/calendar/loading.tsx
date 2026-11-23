// โครงรอโหลดหน้าปฏิทินงาน: หัวหน้า → กล่องเดือน + ตัวกรอง → ตารางเดือน (มือถือ = ตารางย่อ + วาระสัปดาห์)
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
        <div className="card p-3 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
            <div className="skeleton h-6 flex-1 max-w-[12rem] mx-auto" />
            <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
            <div className="skeleton h-11 w-16 shrink-0 rounded-lg" />
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_10rem]">
            <div className="skeleton h-11 rounded-lg" />
            <div className="skeleton h-11 rounded-lg" />
          </div>
          <div className="flex gap-2 overflow-hidden">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-20 shrink-0 rounded-lg" />)}
          </div>
        </div>
        <div className="hidden md:grid card grid-cols-7 gap-px overflow-hidden p-0">
          {[...Array(35)].map((_, i) => <div key={i} className="skeleton h-28 rounded-none" />)}
        </div>
        <div className="md:hidden card grid grid-cols-7 gap-px overflow-hidden p-0">
          {[...Array(35)].map((_, i) => <div key={i} className="skeleton h-14 rounded-none" />)}
        </div>
        <div className="md:hidden space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
        </div>
      </div>
    </div>
  )
}
