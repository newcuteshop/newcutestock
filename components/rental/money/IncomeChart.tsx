'use client'
// กราฟแท่งรายรับสุทธิของร้านเช่าชุด (หน้ารายงาน) — Chart.js ผ่าน react-chartjs-2
// react-chartjs-2 ทำลาย (destroy) กราฟเดิมก่อนวาดใหม่ให้เองทุกครั้งที่ข้อมูลเปลี่ยน/ถอด component → ไม่มีกราฟซ้อน/หน่วยความจำรั่ว
// สีชุดเดียวกับรายงานร้าน NEWCUTE: แท่งโรสโกลด์ (brand-400) · วันที่คืนเงินมากกว่ารับ (ติดลบ) = แท่งเทาเข้ม
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { baht } from '@/lib/format'
import { num } from '@/lib/money'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

export interface IncomeBucket {
  key: string
  label: string        // ป้ายใต้แท่ง (เช่น '5 ต.ค.' หรือ 'ต.ค. 69')
  title: string        // หัวกล่องทิป (เช่น 'วันอาทิตย์ที่ 5 ต.ค. 2569')
  payment: number
  refund: number
  net: number
}

const CHART = {
  bar: '#F0ADB9',
  barHover: '#E694A4',
  negative: '#675F62',
  grid: '#EFEDEE',
  tick: '#675F62',
  tooltipBg: '#201B1D',
}

// next/font ตั้งชื่อฟอนต์แบบสุ่มไว้ในตัวแปร CSS บน <body> — canvas ต้องใช้ชื่อจริง จึงอ่านจากตัวแปรนั้น
function themeFont(fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const family = getComputedStyle(document.body).getPropertyValue('--font-sans').trim()
  return family ? `${family}, ${fallback}` : fallback
}

export default function IncomeChart({ buckets, ariaLabel }: { buckets: readonly IncomeBucket[]; ariaLabel: string }) {
  const font = themeFont('IBM Plex Sans Thai, sans-serif')
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
