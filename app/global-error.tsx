'use client'
import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// แสดงเมื่อ root layout พังทั้งหน้า — ต้องมี <html>/<body> เอง และไม่พึ่ง CSS ของแอป (ใช้ inline style)
// สีตามธีมสตรอว์เบอร์รีมิลค์ (ค่าเดียวกับ tailwind.config.ts)
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
          background: '#FFF3F5',
          color: '#5C2336',
          fontFamily: 'Sarabun, system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        }}
      >
        <div
          role="alert"
          style={{
            width: '100%',
            maxWidth: 400,
            background: '#ffffff',
            border: '2px solid #FAD0DA',
            borderRadius: 28,
            padding: 24,
            textAlign: 'center',
            boxShadow: '0 22px 44px -28px rgba(178, 58, 94, 0.45)',
            boxSizing: 'border-box',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 68,
              height: 68,
              margin: '0 auto 12px',
              borderRadius: '50%',
              background: '#FCD9E1',
              color: '#A3304F',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={32} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>เกิดข้อผิดพลาด</h1>
          <p style={{ fontSize: 14, color: '#704453', marginTop: 8, marginBottom: 0 }}>
            ระบบขัดข้องชั่วคราว กรุณาโหลดหน้าใหม่อีกครั้ง
          </p>
          {error?.digest && (
            <p style={{ fontSize: 12, color: '#8C5D6B', marginTop: 8, marginBottom: 0, wordBreak: 'break-all' }}>
              รหัสอ้างอิง: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              minHeight: 44,
              padding: '10px 24px',
              border: 'none',
              borderRadius: 999,
              background: 'linear-gradient(180deg, #B23A5E 0%, #A3304F 100%)',
              boxShadow: 'inset 0 -4px 0 rgba(92, 35, 54, 0.28), 0 12px 22px -12px rgba(178, 58, 94, 0.75)',
              color: '#ffffff',
              fontSize: 16,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <RefreshCw size={18} strokeWidth={1.9} aria-hidden="true" />
            โหลดหน้าใหม่
          </button>
        </div>
      </body>
    </html>
  )
}
