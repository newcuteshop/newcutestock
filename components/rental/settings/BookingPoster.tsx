// ===== โปสเตอร์ QR จองชุดออนไลน์ (กระดาษ A4) — พิมพ์ผ่าน components/pos/PrintPortal.tsx (paper 'a4') =====
// แปะหน้าร้าน/ที่ลองชุด ให้ลูกค้าสแกนเข้าหน้าจอง /book ได้เอง
// รูป QR ต้องเป็น data URL ที่สร้างเสร็จแล้ว (ส่งมาทาง prop) — PrintPortal รอรูปที่อยู่ในหน้าแล้วเท่านั้น
//   ถ้าวาด QR ระหว่างพิมพ์ เครื่องพิมพ์อาจได้กรอบว่าง
// ใช้สไตล์ inline ล้วน (ขาว-ดำ ไม่มีพื้นหลังสี) — ไม่พึ่งคลาส Tailwind ที่อาจถูกตัดทิ้งตอน build
// ไม่มี hook → ใช้ได้ทั้ง server และ client ; ชื่อร้านมาจาก rental_settings.shop_name (ห้าม hardcode)

const STEPS = [
  'สแกน QR ด้วยกล้องมือถือ หรือแอป LINE',
  'เลือกชุด ไซส์ และวันรับ-วันคืนชุดที่ว่าง',
  'กรอกชื่อ เบอร์โทร แล้วส่งคำขอจอง',
  'โอนมัดจำตามยอดในหน้าสถานะการจอง แนบสลิป แล้วรอร้านยืนยัน',
]

export default function BookingPoster({
  shopName,
  tagline,
  url,
  qrDataUrl,
  phone,
  lineId,
  openingHours,
}: {
  shopName: string
  tagline: string | null
  url: string
  qrDataUrl: string
  phone: string | null
  lineId: string | null
  openingHours: string | null
}) {
  const contact = [phone ? `โทร ${phone}` : '', lineId ? `LINE ${lineId}` : ''].filter(Boolean).join('  ·  ')
  return (
    <div
      style={{
        width: '100%',
        maxWidth: '180mm',
        margin: '0 auto',
        padding: '6mm 4mm',
        color: '#000000',
        background: '#FFFFFF',
        fontFamily: 'inherit',
        textAlign: 'center',
        lineHeight: 1.4,
      }}
    >
      {/* กระดาษ A4 แนวตั้ง ขอบ 12 มม. (แทนขอบ 4 มม. ของใบเสร็จ) — แท็กนี้อยู่ในหน้าเฉพาะตอนสั่งพิมพ์ ประกาศทีหลังจึงชนะกฎใน globals.css */}
      <style>{'@page { size: A4 portrait; margin: 12mm; }'}</style>
      <p style={{ margin: 0, fontSize: '30pt', fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{shopName}</p>
      {tagline && <p style={{ margin: '2mm 0 0', fontSize: '14pt' }}>{tagline}</p>}
      <div style={{ margin: '8mm auto 0', width: '40mm', borderTop: '1.5pt solid #000000' }} />
      <p style={{ margin: '8mm 0 0', fontSize: '24pt', fontWeight: 700 }}>จองชุดออนไลน์</p>
      <p style={{ margin: '1mm 0 0', fontSize: '14pt' }}>ดูชุด เช็กวันว่าง และส่งคำขอจองได้ตลอด 24 ชั่วโมง</p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt={`คิวอาร์โค้ดหน้าจองออนไลน์ ${url}`}
        style={{ display: 'block', width: '95mm', height: '95mm', margin: '7mm auto 0' }}
      />
      <p style={{ margin: '3mm 0 0', fontSize: '12pt', overflowWrap: 'anywhere' }}>{url}</p>

      <ol
        style={{
          margin: '8mm auto 0',
          padding: '0 0 0 7mm',
          maxWidth: '140mm',
          textAlign: 'left',
          fontSize: '13pt',
        }}
      >
        {STEPS.map(s => (
          <li key={s} style={{ margin: '1.5mm 0' }}>{s}</li>
        ))}
      </ol>

      {(contact || openingHours) && (
        <div style={{ margin: '8mm auto 0', paddingTop: '4mm', borderTop: '1pt dashed #000000', maxWidth: '150mm', fontSize: '12pt' }}>
          {contact && <p style={{ margin: 0 }}>สอบถามเพิ่มเติม {contact}</p>}
          {openingHours && <p style={{ margin: '1mm 0 0' }}>เวลาเปิดร้าน {openingHours}</p>}
        </div>
      )}
    </div>
  )
}
