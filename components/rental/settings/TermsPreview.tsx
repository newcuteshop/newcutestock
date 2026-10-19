// ตัวอย่างข้อตกลงในสัญญาเช่าแบบมีเลขข้อ (แสดงตามที่กำลังพิมพ์ ยังไม่ต้องบันทึก)
// แยกข้อด้วยฟังก์ชันเดียวกับสัญญาเช่าที่พิมพ์จริง (termsList ใน components/rental/docs/docKit) — ตัวอย่างต้องตรงกับกระดาษ:
//   1 บรรทัดใหม่ = 1 ข้อ · เลขข้อที่พิมพ์ไว้เอง ('1.' '2)' '๓.') ถูกตัดแล้วเรียงเลขใหม่ (แทรก/ลบข้อกลางรายการแล้วเลขไม่เพี้ยน)
//   บรรทัดที่ขึ้นต้นด้วยช่องว่าง หรือ - • * = ต่อท้ายข้อก่อนหน้า (รายละเอียดย่อยของข้อเดิม)
// ไม่มี hook → ใช้ได้ทั้ง server และ client
import { termsList } from '@/components/rental/docs/docKit'

export default function TermsPreview({ text, shopName }: { text: string; shopName: string }) {
  const clauses = termsList(text)
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-center text-sm font-semibold text-gray-900 break-words">{shopName}</p>
      <p className="mb-3 text-center text-sm font-semibold text-gray-900">ข้อตกลงและเงื่อนไขการเช่า</p>
      {clauses.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีข้อตกลง</p>
      ) : (
        <ol className="list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-gray-800 marker:text-gray-500">
          {clauses.map((c, i) => (
            <li key={i} className="whitespace-pre-line break-words pl-1">{c}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
