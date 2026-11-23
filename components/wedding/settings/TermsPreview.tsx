// ตัวอย่างเงื่อนไขสัญญาจ้างแบบมีเลขข้อ (แสดงตามที่กำลังพิมพ์ ยังไม่ต้องบันทึก)
// แยกข้อด้วย termsLines (lib/wedding) — ตัวเดียวกับที่เอกสาร/สัญญาจ้าง/ลิงก์ลูกค้าใช้ ตัวอย่างจึงตรงกับของจริง:
//   1 บรรทัด = 1 ข้อ · บรรทัดว่างไม่นับ · เลขข้อที่พิมพ์ไว้เอง ('1.' '2)' '๓.') ถูกตัดแล้วเรียงเลขใหม่
// ไม่มี hook → ใช้ได้ทั้ง server และ client
import { termsLines } from '@/lib/wedding'

export default function TermsPreview({ text, shopName }: { text: string; shopName: string }) {
  const clauses = termsLines(text)
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-center text-sm font-semibold text-gray-900 break-words">{shopName}</p>
      <p className="mb-3 text-center text-sm font-semibold text-gray-900">เงื่อนไขการให้บริการ (สัญญาจ้าง)</p>
      {clauses.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีเงื่อนไข</p>
      ) : (
        <ol className="list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-gray-800 marker:text-gray-500">
          {clauses.map((c, i) => (
            <li key={i} className="break-words pl-1">{c}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
