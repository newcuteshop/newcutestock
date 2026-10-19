// โครงรอโหลดตั้งค่าร้านเช่า: หัวหน้า → ทางลัดหมวด → การ์ดฟอร์ม 2 ใบ (ช่องกรอก 2 คอลัมน์บนจอกว้าง)
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-7 sm:h-8 w-44" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-11 md:h-9 w-24 rounded-lg" />)}
      </div>
      {[0, 1].map(card => (
        <div key={card} className="card">
          <div className="card-header">
            <div className="skeleton h-5 w-40" />
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:gap-x-4 sm:p-5">
            {[...Array(card === 0 ? 6 : 4)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="skeleton h-4 w-28" />
                <div className="skeleton h-11 rounded-lg" />
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t border-gray-150 px-4 py-3 sm:px-5">
            <div className="skeleton h-11 w-full sm:w-40 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}
