'use client'
import { useEffect } from 'react'

// แสดงเมื่อ root layout พังทั้งหน้า — ต้องมี <html>/<body> เอง และไม่พึ่ง CSS ของแอป (ใช้ inline style)
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
          background: '#f9fafb',
          color: '#111827',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        }}
      >
        <div
          role="alert"
          style={{
            width: '100%',
            maxWidth: 400,
            background: '#ffffff',
            border: '1px solid #f3f4f6',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>เกิดข้อผิดพลาด</h1>
          <p style={{ fontSize: 14, color: '#4b5563', marginTop: 8, marginBottom: 0 }}>
            ระบบขัดข้องชั่วคราว กรุณาโหลดหน้าใหม่อีกครั้ง
          </p>
          {error?.digest && (
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8, marginBottom: 0, wordBreak: 'break-all' }}>
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
              border: 'none',
              borderRadius: 8,
              background: '#0284c7',
              color: '#ffffff',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            โหลดหน้าใหม่
          </button>
        </div>
      </body>
    </html>
  )
}
