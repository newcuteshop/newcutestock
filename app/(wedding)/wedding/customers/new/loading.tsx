// โครงรอโหลดฟอร์มเพิ่มลูกค้า: ลิงก์กลับ + หัวหน้า → การ์ดฟอร์ม 3 ส่วน
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="space-y-2">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-7 sm:h-8 w-44" />
        <div className="skeleton h-4 w-72 max-w-full" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="card p-4 sm:p-5 space-y-4">
          <div className="skeleton h-6 w-36" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="skeleton h-16 rounded-lg" />
            <div className="skeleton h-16 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}
