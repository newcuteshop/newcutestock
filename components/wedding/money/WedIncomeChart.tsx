'use client'
// กราฟแท่งรายรับสุทธิรายเดือนของร้าน b.oncloud (หน้ารายงาน) — Chart.js ผ่าน react-chartjs-2 แบบเดียวกับกราฟร้านเช่า
// react-chartjs-2 ทำลาย (destroy) กราฟเดิมก่อนวาดใหม่ให้เองทุกครั้งที่ข้อมูลเปลี่ยน/ถอด component → ไม่มีกราฟซ้อน/หน่วยความจำรั่ว
// สีอ่านจากตัวแปร CSS ของร้านตอนวาด (canvas ใช้คลาส Tailwind ไม่ได้): แท่ง brand-400 + ขอบ brand-600 (แท่งสีอ่อนบนพื้นขาว
// ต้องมีขอบเข้มให้มองเห็นชัด ≥ 3:1) · เดือนติดลบ = เทาเข้ม gray-500 · ค่า fallback (ฝั่งเซิร์ฟเวอร์/อ่านไม่ได้) = ทองแชมเปญ
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { useEffect, useLayoutEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { baht } from '@/lib/format'
import { num } from '@/lib/money'
import { cssColor } from '@/lib/shopTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

export interface WedIncomeBucket {
  key: string          // 'YYYY-MM'
  label: string        // ป้ายใต้แท่ง เช่น 'พ.ย. 69'
  title: string        // หัวกล่องทิป เช่น 'พฤศจิกายน 2569'
  payment: number
  refund: number
  net: number
}

// สีของร้านที่เปิดอยู่ (อ่านจาก <html data-shop>) — ต้องอ่านซ้ำหลัง commit (ดูเหตุผลใน components/rental/money/IncomeChart.tsx:
// เปลี่ยนหน้าในแอปเข้ามา render แรกอาจยังเห็น data-shop ของร้านก่อนหน้า)
function chartColors() {
  return {
    bar: cssColor('--c-brand-400', '#DCC291'),
    barHover: cssColor('--c-brand-500', '#D2B47C'),
    barBorder: cssColor('--c-brand-600', '#85652A'),
    negative: cssColor('--c-gray-500', '#625C54'),
    grid: cssColor('--c-gray-150', '#EFECE5'),
    tick: cssColor('--c-gray-500', '#625C54'),
    tooltipBg: cssColor('--c-ink', '#24211C'),
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

export default function WedIncomeChart({ buckets, ariaLabel }: { buckets: readonly WedIncomeBucket[]; ariaLabel: string }) {
  const font = themeFont('Prompt, sans-serif')
  const C = useShopChartColors()
  return (
    <Bar
      aria-label={ariaLabel}
      role="img"
      data={{
        labels: buckets.map(b => b.label),
        datasets: [{
          label: 'รายรับสุทธิ (บาท)',
          data: buckets.map(b => b.net),
          backgroundColor: buckets.map(b => (b.net < 0 ? C.negative : C.bar)),
          hoverBackgroundColor: buckets.map(b => (b.net < 0 ? C.negative : C.barHover)),
          borderColor: buckets.map(b => (b.net < 0 ? C.negative : C.barBorder)),
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 48,
        }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: C.tooltipBg,
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
            grid: { color: C.grid },
            ticks: { color: C.tick, font: { family: font, size: 12 }, callback: value => baht(num(value)) },
          },
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: C.tick, font: { family: font, size: 12 }, maxRotation: 0, autoSkipPadding: 8 },
          },
        },
      }}
    />
  )
}
