export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-4 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-50 rounded animate-pulse" />
          ))}
        </div>
        <div className="card p-5 h-96 animate-pulse" />
      </div>
    </div>
  )
}
