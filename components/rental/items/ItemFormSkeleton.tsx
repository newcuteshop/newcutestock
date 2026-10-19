// โครงรอโหลดหน้าเพิ่ม/แก้ไขชุดเช่า (ใช้ใน loading.tsx ของ /rental/items/new และ /rental/items/[id])
export default function ItemFormSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="page-header">
        <div className="min-w-0 space-y-2">
          <div className="skeleton h-4 w-36" />
          <div className="skeleton h-7 sm:h-8 w-48" />
          <div className="skeleton h-4 w-64 max-w-full" />
        </div>
      </div>
      <div className="flex gap-2 overflow-hidden">
        {[28, 24, 28].map((w, i) => <div key={i} className="skeleton h-11 shrink-0 rounded-lg" style={{ width: `${w * 4}px` }} />)}
      </div>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-start">
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton mx-auto aspect-[4/5] w-full max-w-md rounded-xl" />
        </div>
        <div className="card p-4 sm:p-5 space-y-4">
          <div className="skeleton h-5 w-32" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
      <div className="card p-4 sm:p-5 space-y-3">
        <div className="skeleton h-5 w-40" />
        {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}
      </div>
    </div>
  )
}
