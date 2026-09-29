// โครงรอโหลดของหน้าเพิ่ม/แก้ไขสินค้า (รูป + ข้อมูลสินค้า + ไซส์/ราคา) — ใช้ใน loading.tsx
export default function ProductFormSkeleton() {
  return (
    <div className="relative space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="space-y-2">
        <div className="skeleton h-5 w-40 rounded-full" />
        <div className="skeleton h-8 sm:h-9 w-44 rounded-full" />
        <div className="skeleton h-4 w-56 rounded-full" />
      </div>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-start">
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="skeleton h-6 w-32 rounded-full" />
          <div className="skeleton mx-auto aspect-square w-full max-w-md rounded-3xl" />
          <div className="skeleton h-11 w-full rounded-full" />
        </div>
        <div className="card p-4 sm:p-6 space-y-4">
          <div className="skeleton h-6 w-36 rounded-full" />
          <div className="skeleton h-11 w-full rounded-full" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="skeleton h-11 rounded-full" />
            <div className="skeleton h-11 rounded-full" />
          </div>
          <div className="skeleton h-24 w-full" />
        </div>
      </div>
      <div className="card p-4 sm:p-6 space-y-4">
        <div className="skeleton h-6 w-44 rounded-full" />
        <div className="skeleton h-14 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-11 rounded-full" />)}
        </div>
      </div>
    </div>
  )
}
