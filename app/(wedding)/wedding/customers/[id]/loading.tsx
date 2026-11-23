// โครงรอโหลดรายละเอียดลูกค้า: ลิงก์กลับ + ชื่อ → การ์ดสถิติ 4 ใบ → ข้อมูลลูกค้า | ประวัติงาน
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton h-7 sm:h-8 w-56 max-w-full" />
          <div className="skeleton h-5 w-48 max-w-full" />
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-11 w-40 rounded-lg" />
          <div className="skeleton h-11 w-32 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 sm:gap-6">
        <div className="card p-4 sm:p-5 space-y-3 xl:col-span-2">
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
        </div>
        <div className="card p-4 sm:p-5 space-y-3 xl:col-span-3">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      </div>
    </div>
  )
}
