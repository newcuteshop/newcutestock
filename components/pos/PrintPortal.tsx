'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PrintPaper } from '@/lib/pos'

export type { PrintPaper } from '@/lib/pos'

// สั่งพิมพ์เฉพาะเนื้อหาที่ส่งมา (ใบเสร็จ/ใบคืนสินค้า/สรุปยอด) ด้วย window.print() ของเบราว์เซอร์ — ไม่ต้องสร้าง PDF
// วิธีทำงาน: open = true → วาด children ลงกล่อง div#print-root ที่ต่อท้าย <body>
//   → ใส่ class "printing" + data-paper ที่ <body> (CSS ใน globals.css ซ่อนทุกอย่างตอนพิมพ์ ยกเว้น #print-root
//     และกำหนดความกว้าง .receipt ตามกระดาษ 58/80 มม./A4) → รอวาดเสร็จ 2 เฟรม + ฟอนต์ไทยโหลดครบ → window.print()
//   → พิมพ์เสร็จ/ยกเลิก (afterprint) หรือครบ 60 วินาที (เบราว์เซอร์มือถือบางตัวไม่ส่ง afterprint) หรือ component ถูกถอด
//   → เอา class/กล่องออก แล้วเรียก onDone() ครั้งเดียวต่อการเปิด 1 ครั้ง (ผู้ใช้ตั้ง open = false ใน onDone)
// บนหน้าจอ #print-root ถูกซ่อนเสมอ ผู้ใช้จึงไม่เห็นอะไรเปลี่ยนนอกจากหน้าต่างพิมพ์ของเบราว์เซอร์
//
// ใช้: const [printing, setPrinting] = useState(false)
//      <button type="button" onClick={() => setPrinting(true)}>พิมพ์ใบเสร็จ</button>
//      <PrintPortal open={printing} paper={shop.receipt_paper} onDone={() => setPrinting(false)}>
//        <Receipt ... />   ← ห่อด้วย <div className="receipt"> ... </div> (สไตล์ใน globals.css)
//      </PrintPortal>
// ให้ render <PrintPortal> ไว้ตลอด แล้วสลับ open (ไม่ต้อง {printing && ...}) — ตั้ง open จากการกดปุ่มของผู้ใช้

const ROOT_ID = 'print-root'
const FALLBACK_MS = 60000
const FONT_WAIT_MS = 3000
const IMAGE_WAIT_MS = 3000

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
    else window.setTimeout(resolve, 16)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

// รอฟอนต์ (ฟอนต์ไทยจาก next/font โหลดแบบ swap — ยังไม่มาจะพิมพ์ออกมาเป็นฟอนต์สำรอง) ไม่เกินเวลาที่กำหนด
async function fontsReady(): Promise<void> {
  const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
  if (!fonts || !fonts.ready) return
  await Promise.race([fonts.ready.then(() => undefined, () => undefined), delay(FONT_WAIT_MS)])
}

// รอรูปในเนื้อหาที่จะพิมพ์ (ถ้ามี) — รูปเสียหรือช้าเกินก็พิมพ์ต่อ
async function imagesReady(root: HTMLElement): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img')).filter(img => !img.complete)
  if (pending.length === 0) return
  const all = Promise.all(
    pending.map(img => new Promise<void>(resolve => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })),
  ).then(() => undefined)
  await Promise.race([all, delay(IMAGE_WAIT_MS)])
}

export default function PrintPortal({
  open,
  paper,
  onDone,
  children,
}: {
  open: boolean
  paper: PrintPaper
  onDone(): void
  children: ReactNode
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  // ค่าล่าสุดเสมอ (ผู้ใช้มักส่งฟังก์ชันใหม่ทุกครั้งที่ render — ไม่ให้ effect เริ่มพิมพ์ใหม่)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const paperRef = useRef(paper)
  paperRef.current = paper
  const finishRef = useRef<(() => void) | null>(null)
  // onDone ที่เลื่อนไว้ตอน cleanup — React StrictMode (dev) รัน cleanup แล้วรัน effect ซ้ำทันที → ยกเลิกได้ ไม่ให้งานพิมพ์หลุด
  const pendingDoneRef = useRef<number | null>(null)

  // เปิด: สร้างกล่อง #print-root + ติด class ที่ body ; ปิด/ถอด component: เก็บกวาด
  useEffect(() => {
    if (!open) return
    if (pendingDoneRef.current !== null) {
      window.clearTimeout(pendingDoneRef.current)
      pendingDoneRef.current = null
    }
    const body = document.body
    // กล่องค้างจากการพิมพ์ครั้งก่อนที่ไม่ถูกเก็บ (ไม่ควรเกิด) → เอาออกก่อน ไม่ให้มี id ซ้ำ
    document.getElementById(ROOT_ID)?.remove()
    const el = document.createElement('div')
    el.id = ROOT_ID
    body.appendChild(el)
    body.classList.add('printing')
    body.setAttribute('data-paper', paperRef.current)
    setRoot(el)

    let finished = false
    const cleanUp = () => {
      if (finished) return false
      finished = true
      window.removeEventListener('afterprint', onAfterPrint)
      window.clearTimeout(fallback)
      // ถ้ามี PrintPortal ตัวอื่นเปิดทับไปแล้ว (ไม่ควรเกิด) อย่าถอด class ของมัน
      const current = document.getElementById(ROOT_ID)
      if (!current || current === el) {
        body.classList.remove('printing')
        body.removeAttribute('data-paper')
      }
      el.remove()
      setRoot(null)
      if (finishRef.current === finish) finishRef.current = null
      return true
    }
    // พิมพ์เสร็จ/ยกเลิก/หมดเวลา → เก็บกวาด + แจ้งทันที
    const finish = () => {
      if (cleanUp()) onDoneRef.current()
    }
    // afterprint บางเบราว์เซอร์ส่งมาระหว่างที่ print() ยังทำงาน → เลื่อนไปทำหลังจบรอบนี้
    const onAfterPrint = () => {
      window.setTimeout(finish, 0)
    }
    window.addEventListener('afterprint', onAfterPrint)
    const fallback = window.setTimeout(finish, FALLBACK_MS)
    finishRef.current = finish

    return () => {
      // ปิดจากภายนอก (open = false) หรือถอด component → เก็บกวาด แล้วแจ้ง onDone หลังจบรอบนี้
      if (cleanUp()) {
        pendingDoneRef.current = window.setTimeout(() => {
          pendingDoneRef.current = null
          onDoneRef.current()
        }, 0)
      }
    }
  }, [open])

  // เปลี่ยนขนาดกระดาษระหว่างเปิดอยู่ (ไม่ค่อยเกิด) → อัปเดต data-paper
  useEffect(() => {
    if (root) document.body.setAttribute('data-paper', paper)
  }, [paper, root])

  // เนื้อหาถูกวาดลง #print-root แล้ว (effect นี้รันหลัง commit ที่มี portal) → รอ 2 เฟรม + ฟอนต์ + รูป แล้วสั่งพิมพ์
  useEffect(() => {
    if (!root) return
    let cancelled = false
    void (async () => {
      await nextFrame()
      await nextFrame()
      await fontsReady()
      await imagesReady(root)
      if (cancelled || !root.isConnected) return
      try {
        window.print()
      } catch {
        // เบราว์เซอร์ในแอป (เช่น LINE) บางตัวไม่มีหน้าต่างพิมพ์ → เก็บกวาดทันที
        finishRef.current?.()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [root])

  if (!root) return null
  return createPortal(children, root)
}
