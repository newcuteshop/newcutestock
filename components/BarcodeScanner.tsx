'use client'
import { useEffect, useRef, useState } from 'react'

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const scannerRef = useRef<HTMLDivElement>(null)
  const scannerIdRef = useRef('barcode-scanner-' + Math.random().toString(36).slice(2))

  useEffect(() => {
    let html5QrCode: { stop: () => Promise<void>; clear: () => void } | null = null
    let stopped = false

    async function start() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (stopped) return
        html5QrCode = new Html5Qrcode(scannerIdRef.current)
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 140 } },
          (decoded: string) => {
            onScan(decoded)
          },
          () => {}
        )
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'ไม่สามารถเปิดกล้องได้')
      }
    }

    start()

    return () => {
      stopped = true
      if (html5QrCode) {
        html5QrCode.stop().then(() => html5QrCode?.clear()).catch(() => {})
      }
    }
  }, [onScan])

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (manual.trim()) onScan(manual.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">📷 สแกนบาร์โค้ด</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {error ? (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
        ) : (
          <>
            <div id={scannerIdRef.current} ref={scannerRef} className="rounded-lg overflow-hidden bg-black" />
            <p className="text-xs text-center text-gray-400">เล็งบาร์โค้ดเข้ากรอบ — ระบบจะอ่านอัตโนมัติ</p>
          </>
        )}

        <div className="border-t border-gray-100 pt-4">
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              autoFocus
              className="input flex-1 text-sm"
              placeholder="หรือพิมพ์บาร์โค้ด/SKU..."
              value={manual}
              onChange={e => setManual(e.target.value)}
            />
            <button type="submit" className="btn-primary text-sm">ยืนยัน</button>
          </form>
          <p className="text-xs text-gray-400 mt-2">💡 ใช้เครื่องสแกน USB ก็ได้ พิมพ์แล้วกด Enter</p>
        </div>
      </div>
    </div>
  )
}
