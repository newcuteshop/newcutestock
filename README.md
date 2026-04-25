# 👕 Stock App — ระบบสต๊อกสินค้าเสื้อผ้า

Next.js 14 + Supabase + Vercel (ฟรีทั้งหมด)

---

## 🚀 วิธีติดตั้ง (ทำตามลำดับ)

### 1. ตั้งค่า Supabase

1. ไปที่ [supabase.com](https://supabase.com) → สร้าง Project ใหม่
2. ไปที่ **SQL Editor** → วาง SQL จากไฟล์ `supabase-schema.sql` → กด **Run**
3. ไปที่ **Project Settings > API** → copy ค่าสองตัว:
   - `Project URL`
   - `anon public` key

### 2. ตั้งค่า Environment Variables

```bash
cp .env.local.example .env.local
```

แก้ไข `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 3. ติดตั้งและรัน Local

```bash
npm install
npm run dev
```

เปิดที่ http://localhost:3000

### 4. สร้าง User แรก

ไปที่ Supabase Dashboard → **Authentication > Users** → **Add user**  
ใส่ email + password แล้วกด Create

### 5. Deploy บน Vercel

1. Push โค้ดขึ้น GitHub
2. ไปที่ [vercel.com](https://vercel.com) → Import Repository
3. เพิ่ม Environment Variables เดียวกันใน Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. กด Deploy → รอ 1-2 นาที

---

## 📁 โครงสร้างไฟล์

```
stock-app/
├── app/
│   ├── (auth)/login/          # หน้า Login
│   ├── (dashboard)/
│   │   ├── dashboard/         # ภาพรวม + สถิติ
│   │   ├── products/          # จัดการสินค้า + เพิ่ม/แก้ไข
│   │   ├── stock/             # รับ-จ่ายสต๊อก + ประวัติ
│   │   ├── sales/             # POS บันทึกการขาย
│   │   └── reports/           # รายงาน + กราฟ
│   └── api/                   # (เพิ่มเติมได้)
├── components/layout/         # Sidebar
├── lib/supabase/              # Client + Server
├── types/                     # TypeScript types
├── supabase-schema.sql        # SQL สร้างตาราง
└── middleware.ts              # Auth guard
```

## ✨ ฟีเจอร์

- ✅ Login / Logout ด้วย Supabase Auth
- ✅ Dashboard สรุปสต๊อก + แจ้งเตือนสต๊อกใกล้หมด
- ✅ จัดการสินค้า (เพิ่ม / แก้ไข / ค้นหา / กรองหมวดหมู่)
- ✅ รับ-จ่ายสต๊อก + ประวัติการเคลื่อนไหว
- ✅ POS บันทึกการขาย + คำนวณส่วนลด
- ✅ รายงาน กราฟยอดขาย + Doughnut chart ช่องทางชำระ
- ✅ Auto-generate เลขที่ใบขาย
- ✅ Row Level Security (RLS) บน Supabase

## 🔧 พัฒนาต่อใน Claude Code

```bash
# ติดตั้ง Claude Code
npm install -g @anthropic-ai/claude-code

# เข้า project แล้วรัน
cd stock-app
claude
```
