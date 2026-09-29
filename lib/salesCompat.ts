// sales.channel / sales.voided_at มาจาก supabase-fix-03-integrations.sql
// ก่อนรัน fix-03 หน้าขาย / ภาพรวม / รายงาน ต้องยังเปิดได้: ลองแบบใหม่ก่อน ถ้าฐานข้อมูลยังไม่มีคอลัมน์ค่อยใช้แบบเดิม
// (ยังไม่มีบิลจากแพลตฟอร์ม = ไม่มีบิลยกเลิกให้กรอง ผลจึงเหมือนกัน)
export function isMissingSalesColumn(err: unknown): boolean {
  if (err === null || err === undefined) return false
  const e = typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  const msg = e ? (typeof e.message === 'string' ? e.message : '') : String(err)
  if (!/voided_at|channel/i.test(msg)) return false
  return (e !== null && e.code === '42703') || /does not exist|could not find/i.test(msg)
}
