export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-7 w-32 bg-gray-200 rounded animate-pulse" />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 card p-4 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
        <div className="card p-4 space-y-3 h-96 animate-pulse" />
      </div>
    </div>
  )
}
