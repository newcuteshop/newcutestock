export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด...</span>
      <div className="space-y-2">
        <div className="skeleton h-5 w-40" />
        <div className="flex items-center gap-3">
          <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-7 sm:h-8 w-56 max-w-full" />
            <div className="skeleton h-4 w-40" />
          </div>
        </div>
      </div>
      {/* แท็บ */}
      <div className="grid grid-cols-2 gap-1 sm:flex sm:gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton h-11 sm:w-32 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
        {[...Array(2)].map((_, col) => (
          <div key={col} className="space-y-4 sm:space-y-6">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="card p-4 sm:p-5 space-y-3">
                <div className="skeleton h-6 w-40" />
                <div className="skeleton h-11 rounded-lg" />
                <div className="skeleton h-11 rounded-lg" />
                <div className="skeleton h-11 w-full sm:w-36 rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
