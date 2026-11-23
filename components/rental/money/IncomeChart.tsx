'use client'
// กราฟแท่งรายรับสุทธิของร้านเช่าชุด (หน้ารายงาน) — Chart.js ผ่าน react-chartjs-2
// react-chartjs-2 ทำลาย (destroy) กราฟเดิมก่อนวาดใหม่ให้เองทุกครั้งที่ข้อมูลเปลี่ยน/ถอด component → ไม่มีกราฟซ้อน/หน่วยความจำรั่ว
// สีอ่านจากตัวแปร CSS ของร้านตอนวาด (canvas ใช้คลาส Tailwind ไม่ได้): แท่ง brand-400 · ชี้ brand-500 · วันติดลบ = เทาเข้ม gray-500
// → ร้านเช่าเป็นฟ้าใส (ธีม #18 ที่บอสเลือก 22/10/2569) · ค่า fallback (ฝั่งเซิร์ฟเวอร์/อ่านไม่ได้) = ค่าของร้านเช่า
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { useEffect, useLayoutEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { baht } from '@/lib/format'
import { num } from '@/lib/money'
import { cssColor } from '@/lib/shopTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

export interface IncomeBucket {
  key: string
  label: string        // ป้ายใต้แท่ง (เช่น '5 ต.ค.' หรือ 'ต.ค. 69')
  title: string        // หัวกล่องทิป (เช่น 'วันอาทิตย์ที่ 5 ต.ค. 2569')
  payment: number
  refund: number
  net: number
}

// สีของร้านที่เปิดอยู่ (อ่านจาก <html data-shop>)
// ห้ามอ่านระหว่าง render อย่างเดียว: ตอนเปลี่ยนหน้าในแอปเข้ามาหน้านี้ (เช่น /select → กด Back กลับ /rental/reports)
// layout ร้านเช่า mount ใน commit เดียวกัน และ ShopThemeSync ตั้ง data-shop="rental" ใน layout effect ซึ่งรัน "หลัง" ทุก render
// → render แรกยังเห็น data-shop="newcute" ได้สีโรสโกลด์ค้างอยู่บนหน้าฟ้า — จึงอ่านซ้ำหลัง commit (ดู useShopChartColors)
function chartColors() {
  return {
    bar: cssColor('--c-brand-400', '#A8D9EC'),
    barHover: cssColor('--c-brand-500', '#92CFE6'),
    negative: cssColor('--c-gray-500', '#51636E'),
    grid: cssColor('--c-gray-150', '#EBF1F4'),
    tick: cssColor('--c-gray-500', '#51636E'),
    tooltipBg: cssColor('--c-ink', '#15232A'),
  }
}

// next/font ตั้งชื่อฟอนต์แบบสุ่มไว้ในตัวแปร CSS บน <body> — canvas ต้องใช้ชื่อจริง จึงอ่านจากตัวแปรนั้น
function themeFont(fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const family = getComputedStyle(document.body).getPropertyValue('--font-sans').trim()
  return family ? `${family}, ${fallback}` : fallback
}

type ChartColors = ReturnType<typeof chartColors>
const sameColors = (a: ChartColors, b: ChartColors) =>
  (Object.keys(a) as (keyof ChartColors)[]).every(k => a[k] === b[k])
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// ค่าแรก = อ่านตอน render (โหลดหน้าเต็ม/F5 ถูกอยู่แล้ว เพราะสคริปต์ใน <head> ตั้ง data-shop ก่อน)
// แล้วอ่านซ้ำหลัง commit 2 จังหวะ (เปลี่ยนเฉพาะเมื่อสีต่างจริง → ปกติไม่ render ซ้ำ):
// - layout effect: ก่อนเบราว์เซอร์วาด (ShopThemeSync อยู่ก่อนเนื้อหาหน้าใน layout จึงตั้ง data-shop ไปแล้ว) → ไม่เห็นสีผิดแวบหนึ่ง
// - passive effect: รันหลัง layout effect "ทุกตัว" ของ commit แน่นอน → กันกรณีลำดับใน layout เปลี่ยนในอนาคต
function resyncColors(set: (fn: (prev: ChartColors) => ChartColors) => void) {
  const next = chartColors()
  set(prev => (sameColors(prev, next) ? prev : next))
}
function useShopChartColors(): ChartColors {
  const [colors, setColors] = useState(chartColors)
  useIsoLayoutEffect(() => resyncColors(setColors), [])
  useEffect(() => resyncColors(setColors), [])
  return colors
}

export default function IncomeChart({ buckets, ariaLabel }: { buckets: readonly IncomeBucket[]; ariaLabel: string }) {
  const font = themeFont('Prompt, sans-serif')
  const CHART = useShopChartColors()
  return (
    <Bar
      aria-label={ariaLabel}
      role="img"
      data={{
        labels: buckets.map(b => b.label),
        datasets: [{
          label: 'รายรับสุทธิ (บาท)',
          data: buckets.map(b => b.net),
          backgroundColor: buckets.map(b => (b.net < 0 ? CHART.negative : CHART.bar)),
          hoverBackgroundColor: buckets.map(b => (b.net < 0 ? CHART.negative : CHART.barHover)),
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 40,
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CHART.tooltipBg,
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            titleFont: { family: font, size: 13, weight: 600 },
            bodyFont: { family: font, size: 13 },
            padding: 10,
            cornerRadius: 8,
            boxPadding: 4,
            displayColors: false,
            callbacks: {
              title: items => (items.length > 0 ? buckets[items[0].dataIndex]?.title ?? '' : ''),
              label: ctx => ` สุทธิ ${baht(num(ctx.raw))}`,
              afterLabel: ctx => {
                const b = buckets[ctx.dataIndex]
                if (!b) return ''
                return b.refund > 0 ? ` รับ ${baht(b.payment)} · คืน ${baht(b.refund)}` : ` รับ ${baht(b.payment)}`
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: CHART.grid },
            ticks: { color: CHART.tick, font: { family: font, size: 12 }, callback: value => baht(num(value)) },
          },
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: CHART.tick, font: { family: font, size: 12 }, maxRotation: 0, autoSkipPadding: 8 },
          },
        },
      }}
    />
  )
}
