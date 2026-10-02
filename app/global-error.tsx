'use client'
import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// แสดงเมื่อ root layout พังทั้งหน้า — ต้องมี <html>/<body> เอง และไม่พึ่ง CSS ของแอป (ใช้ inline style)
// สีตามธีมทางการ: พื้นเทาอ่อน การ์ดขาวเส้นบาง ปุ่มโรสโกลด์ชมพูตัวอักษรหมึก (ค่าเดียวกับ tailwind.config.ts) — ไม่มีไล่สี ไม่มีเงา
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box',
          background: '#F7F6F6',
          color: '#201B1D',
          fontFamily: '"IBM Plex Sans Thai", "Noto Sans Thai", system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        }}
      >
        <div
          role="alert"
          style={{
            width: '100%',
            maxWidth: 400,
            background: '#FFFFFF',
            border: '1px solid #E8E6E6',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 12px',
              borderRadius: 12,
              background: '#FFF7F8',
              color: '#C14E67',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={28} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3, margin: 0 }}>เกิดข้อผิดพลาด</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#675F62', marginTop: 8, marginBottom: 0 }}>
            ระบบขัดข้องชั่วคราว กรุณาโหลดหน้าใหม่อีกครั้ง
          </p>
          {error?.digest && (
            <p style={{ fontSize: 12, color: '#675F62', marginTop: 8, marginBottom: 0, wordBreak: 'break-all' }}>
              รหัสอ้างอิง: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              minHeight: 44,
              padding: '10px 20px',
              border: '1px solid #F0ADB9',
              borderRadius: 8,
              background: '#F0ADB9',
              color: '#201B1D',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />
            โหลดหน้าใหม่
          </button>
        </div>
      </body>
    </html>
  )
}
