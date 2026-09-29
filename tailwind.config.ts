import type { Config } from 'tailwindcss'

// ธีม 16 · สตรอว์เบอร์รีมิลค์ (+ กลีบกุหลาบปลิวจากธีม 11)
// พื้นนมชมพู #FFF3F5 · บลัช #FCD9E1 · ชมพูสตรอว์เบอร์รี #F4A7BB · กุหลาบสตรอว์เบอร์รี #B23A5E (สีหลัก) · เบอร์รีเข้ม #5C2336 (ตัวอักษร)
// keyframes และคลาสสำเร็จรูป (.btn-primary, .card, .chip ฯลฯ) อยู่ใน app/globals.css

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // สีหลัก: คลาส brand-* เดิมทั้งระบบเปลี่ยนเป็นโทนสตรอว์เบอร์รีอัตโนมัติ
        // ตัวอักษรบนพื้นขาว/นม ใช้ 600 ขึ้นไป (600 = 5.7:1, 700 = 7.2:1) · 300-500 ใช้เป็นเส้น/ตกแต่ง/วงแหวนโฟกัสเท่านั้น
        brand: {
          50: '#FFF3F5',
          100: '#FCE0E7',
          200: '#F9C6D3',
          300: '#F4A7BB',
          400: '#E27F9B',
          500: '#C9557A',
          600: '#B23A5E',
          700: '#9A2F52',
          800: '#7A2442',
          900: '#5C2336',
          950: '#3F1624',
        },
        // เทาเดิมเปลี่ยนเป็น "โกโก้อมชมพู" — text-gray-* / bg-gray-* / border-gray-* ทั้งระบบเข้าธีมเอง
        // 50-300 = พื้น/เส้น (300 ห้ามใช้กับตัวอักษรที่ต้องอ่าน) · 400 = ตัวอักษรรองที่จางที่สุด (5.4:1 บนขาว) · 900 = เบอร์รีเข้ม
        gray: {
          50: '#FFF6F8',
          100: '#FBE9EE',
          200: '#F4D7DF',
          300: '#E3BAC6',
          400: '#8C5D6B',
          500: '#7D4F5E',
          600: '#704453',
          700: '#643947',
          800: '#5E2D3E',
          900: '#5C2336',
          950: '#3F1624',
        },
        // สีสถานะ: ปรับโทนให้เข้ากับธีม แต่ยังเป็นแดง/เขียว/น้ำผึ้ง/ส้มเหมือนเดิม
        // 600 ขึ้นไป = ตัวอักษรบนขาวได้ และตัวอักษรขาวบนพื้นสีนี้ได้ (>= 4.5:1)
        red: {
          50: '#FFF1F1',
          100: '#FFE1E1',
          200: '#FDC7C7',
          300: '#F7A0A0',
          400: '#EC6F6F',
          500: '#C93434',
          600: '#BF2B2B',
          700: '#A12222',
          800: '#841E1E',
          900: '#6C1C1C',
          950: '#3D0B0B',
        },
        green: {
          50: '#EFF8F2',
          100: '#DCF1E3',
          200: '#BCE3C9',
          300: '#8ECDA6',
          400: '#5DB27F',
          500: '#3A9662',
          600: '#2A7D50',
          700: '#216641',
          800: '#1C5236',
          900: '#18432D',
          950: '#0B2517',
        },
        amber: {
          50: '#FFF7EA',
          100: '#FDEBCD',
          200: '#F9D59C',
          300: '#F2BA62',
          400: '#E39A33',
          500: '#C97F1C',
          600: '#9C5B0F',
          700: '#874F0F',
          800: '#6E4010',
          900: '#5B3510',
          950: '#331C06',
        },
        orange: {
          50: '#FFF4EC',
          100: '#FEE5D3',
          200: '#FBCAA6',
          300: '#F5A673',
          400: '#EC7F45',
          500: '#D9632A',
          600: '#B84E1C',
          700: '#963F19',
          800: '#7A3519',
          900: '#642D17',
          950: '#361508',
        },
        // ชื่อเรียกตามแบบธีม (ใช้ตรงๆ ได้ เช่น bg-milk, border-blush-line, text-berry)
        milk: {
          DEFAULT: '#FFF3F5',
          soft: '#FFFBFC',
          deep: '#FDE6EC',
        },
        blush: {
          DEFAULT: '#FCD9E1',
          line: '#FAD0DA',
          hair: '#FCE0E7',
          soft: '#FDEBF0',
          deep: '#F6C1CE',
        },
        strawberry: {
          DEFAULT: '#F4A7BB',
        },
        berry: {
          DEFAULT: '#5C2336',
        },
      },
      fontFamily: {
        // Sarabun = เนื้อหา · Kodchasan = หัวเรื่อง/ปุ่ม/ตัวเลขเด่น (คลาส font-display)
        sans: ['var(--font-sans)', 'Sarabun', 'system-ui', '-apple-system', 'Segoe UI', 'Tahoma', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', '-apple-system', 'Tahoma', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '1.75rem', // 28px — การ์ด
        '5xl': '2.25rem', // 36px — แผงใหญ่ (ล็อกอิน / ป็อปอัป)
      },
      boxShadow: {
        // เงาเดิมของ Tailwind (shadow-sm/md/lg/xl) เปลี่ยนเป็นเงาชมพูนุ่ม
        sm: '0 1px 2px rgba(178, 58, 94, 0.06), 0 1px 1px rgba(92, 35, 54, 0.04)',
        DEFAULT: '0 6px 14px -8px rgba(178, 58, 94, 0.3)',
        md: '0 14px 28px -16px rgba(178, 58, 94, 0.45)',
        lg: '0 22px 44px -24px rgba(178, 58, 94, 0.5)',
        xl: '0 30px 60px -28px rgba(178, 58, 94, 0.55)',
        '2xl': '0 40px 80px -32px rgba(92, 35, 54, 0.45)',
        soft: '0 22px 44px -28px rgba(178, 58, 94, 0.45)',
        'soft-sm': '0 8px 18px -12px rgba(178, 58, 94, 0.5)',
        candy: 'inset 0 -4px 0 rgba(92, 35, 54, 0.28), inset 0 2px 0 rgba(255, 255, 255, 0.18), 0 12px 22px -12px rgba(178, 58, 94, 0.75)',
        lip: 'inset 0 -4px 0 #FDEBF0',
        'lip-blush': 'inset 0 -4px 0 #F6C1CE',
        bar: '0 -10px 24px -16px rgba(178, 58, 94, 0.45)',
      },
      // keyframes อยู่ใน app/globals.css (ใช้ร่วมกับคลาสตกแต่ง .bob/.hop/.candy) — ตรงนี้แค่ตั้งชื่อ animate-* สำหรับของที่โผล่ขึ้นมา
      animation: {
        'pop-in': 'pop-in 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.25) both',
        'fade-up': 'fade-up 0.35s ease-out both',
      },
    },
  },
  plugins: [],
}
export default config
