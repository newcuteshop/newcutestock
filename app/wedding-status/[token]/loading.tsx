// โครงรอโหลดหน้าติดตามงาน (แถบบน + การ์ดเทาอ่อน) — ข้อมูลร้านยังไม่มา จึงไม่แสดงชื่อร้าน
export default function WeddingStatusLoading() {
  return (
    <>
      <div className="surface-topbar pt-safe">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2.5 px-4 sm:h-16 sm:px-6">
          <div className="skeleton h-9 w-9 rounded-lg" />
          <div className="skeleton h-4 w-40" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-5 sm:px-6 sm:py-8" role="status" aria-live="polite">
        <span className="sr-only">กำลังโหลด...</span>
        <div className="card space-y-3 p-4 sm:p-5">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-7 w-2/3 max-w-xs" />
          <div className="skeleton h-4 w-1/2 max-w-[12rem]" />
          <div className="grid grid-cols-5 gap-1 pt-2">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton mx-auto h-8 w-8 rounded-full" />)}
          </div>
        </div>
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="card space-y-3 p-4 sm:p-5">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-4/5" />
          </div>
        ))}
      </div>
    </>
  )
}
