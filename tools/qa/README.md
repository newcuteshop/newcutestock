# ชุดทดสอบหน้าเว็บจริง (QA) — Chrome + Supabase จำลอง

ทดสอบแอปที่ build จริง (`next build` + `next start`) ในเบราว์เซอร์ Chrome แบบ headless โดยไม่ต่อเน็ตและไม่แตะ Supabase จริง
ฐานข้อมูลคือ SQL "ตัวจริง" ของ repo (`supabase-*.sql`) ที่รันใน PGlite (Postgres ในหน่วยความจำ) ตามลำดับเดียวกับ `tools/db-tests`
แล้วมีเซิร์ฟเวอร์จำลอง API ของ Supabase อยู่ด้านหน้า — ทุกคำขอของหน้าเว็บวิ่งเป็น SQL จริงใต้ role/สิทธิ์ของผู้ใช้ (RLS ทำงานจริง)

ต้องมี: Node ≥ 22 (ใช้ `WebSocket` ในตัว), Google Chrome (หรือตั้ง `CHROME_PATH`), และติดตั้ง `tools/db-tests` แล้ว (`npm install` ในโฟลเดอร์นั้น — ใช้ PGlite ตัวเดียวกัน)
ไม่มีแพ็กเกจของตัวเอง: `pngjs` (เทียบภาพ) ใช้จาก `node_modules` ของ repo (มากับ `qrcode`)

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `mock-supabase.mjs` | Supabase จำลอง: `/auth/v1` (เข้าสู่ระบบ/ต่ออายุ/ผู้ใช้/admin users, JWT ไม่เซ็น), `/rest/v1` (rpc + ตาราง: select/embed ตาม FK จริง/ตัวกรอง/or/order/range/count/single/insert/upsert/update/delete), `/storage/v1` (อัปโหลด/ลิงก์ชั่วคราว/สาธารณะ/ลบ ผ่านนโยบาย RLS ของ `storage.objects`) · error แบบ PostgREST (`PGRST202` ไม่พบฟังก์ชัน, `PGRST201` embed กำกวม, `42501` → 401/403) |
| `seed.mjs` | ข้อมูลตั้งต้นผ่าน RPC จริง: ผู้ใช้ 5 คน, NEWCUTE (สินค้า + บิล), ร้านเช่า (ชุด + การจอง), b.oncloud ครบทุกสถานะ (คิวเต็ม, ทีมชนคิว, งวดเลยกำหนด, งานส่งเลยกำหนด, ล็อกคิวใกล้หมด, เลื่อน, ยกเลิก+คืนเงิน, สลิป, รายการ void, ค่าล่วงเวลา) |
| `app-server.mjs` | `build` / `start` แอปด้วย env ของ QA (URL/คีย์ mock + ฟอนต์จำลอง) — ไม่ใช้ค่าใน `.env.local` ; `verifyBuild()` ตรวจว่าโค้ดหน้าเว็บชี้ไป mock ; start ด้วย `TZ=UTC` เหมือน Vercel |
| `font-mock.cjs` | Google Fonts จำลองสำหรับ `next build` แบบออฟไลน์ — ใช้ไฟล์ฟอนต์จริงของ Google จาก `FONT_MOCK_DIR` (หรือ `tools/qa/fonts/`) ถ้ามี ไม่งั้นใช้ฟอนต์ไทยในเครื่อง เช่น Leelawadee UI (ดูหัวข้อ "ฟอนต์จริงในภาพ QA") |
| `cdp.mjs` | ตัวขับ Chrome ผ่าน DevTools Protocol: แท็บ, ขนาดจอ/มือถือ, คลิกเมาส์จริง, พิมพ์, อัปโหลดไฟล์, ดาวน์โหลด, สื่อพิมพ์, ภาพเต็มหน้า (ขยายจอให้พอดีกล่อง `<main>` ที่เลื่อนในตัว), เก็บ console error / exception / HTTP ≥ 400 |
| `checks.mjs` | ตรวจอัตโนมัติ: ล้นจอแนวนอน, ตัวอักษรไทยถูกตัด, สีของร้านอื่น (อ่านจาก `app/globals.css`) ใน DOM และในภาพ, ปุ่มเล็ก (มือถือ), dialog อยู่ในจอ/เลื่อนได้ ; `diffPng()` เทียบภาพ |
| `qa-shell.mjs` | เปิด mock + seed + แอป (1–2 ตัว) + Chrome ค้างไว้ แล้วสั่งงานทีละคำสั่งผ่าน HTTP (ดูหัวไฟล์) — ใช้สำรวจ/ทดสอบแบบโต้ตอบ |
| `wedding-tour.mjs` | เดินทุกหน้าของ b.oncloud ที่ 375×812 และ 1440×900 + ตรวจทุกข้อ → ภาพ + `tour-report.json` |
| `wedding-docs.mjs` | เปิด "ส่งเอกสาร" ของงาน → สร้างรูป PNG จริงทุกชนิดเอกสาร (ปุ่ม "บันทึกรูป") + พิมพ์ A4 + สัญญาจ้าง (จำลองสื่อพิมพ์) |
| `regression.mjs` | เทียบภาพ NEWCUTE + ร้านเช่า ระหว่างชุด "ก่อนแก้" กับปัจจุบัน แบบพิกเซลต่อพิกเซล (ต้อง 0 ยกเว้น `/select`) |

## วิธีใช้

ผลลัพธ์ (ภาพ/รายงาน/ไฟล์ดาวน์โหลด/โปรไฟล์ Chrome) ให้เก็บนอก repo เสมอ — ส่ง `--out <โฟลเดอร์ชั่วคราว>` (ค่าเริ่มต้น `tools/qa/out/` ซึ่งอยู่ใน `.gitignore`)

```sh
cd tools/qa
node app-server.mjs build ../..                      # build repo ปัจจุบัน (ชี้ไป mock ที่ 127.0.0.1:54321)
node qa-shell.mjs --app <repo>:3485 --out <OUT>      # หน้าต่างที่ 1: ค้างไว้ (Ctrl+C หรือ {"op":"quit"} ปิดทุกอย่าง)
node wedding-tour.mjs                                # หน้าต่างที่ 2: เดินทุกหน้า → <OUT>/tour-*.png + tour-report.json
node wedding-docs.mjs --booking capA --view m        # รูปเอกสาร → <OUT>/docs/
```

สั่งเองทีละคำสั่ง (ส่ง JSON เป็น UTF-8 — บน Git Bash ของ Windows ให้ส่งผ่าน stdin ของ node ไม่ใช่ `curl -d` ที่มีภาษาไทย):

```sh
echo '{"op":"goto","url":"/wedding/calendar"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',async()=>console.log(await (await fetch('http://127.0.0.1:3499',{method:'POST',body:s})).text()))"
```

ผู้ใช้ของ seed (หน้า /login: ชื่อผู้ใช้ = รหัสผ่าน): `boss` (แอดมิน 3 ร้าน), `wmgr` (wedding_manage), `wstaff` (wedding), `ncute` (NEWCUTE), `rent` (ร้านเช่า)
แท็บแรกเข้าสู่ระบบผ่านหน้า /login จริง ; แท็บอื่นใช้คุกกี้เดิม + ตั้งธง `sessionStorage['newcute-entered']='1'` ก่อนโหลดหน้า
(เปิดหน้า /login = ออกจากระบบทุกแท็บ เพราะคุกกี้ใช้ร่วมกัน — ส่ง `{"op":"login"}` เพื่อเข้าใหม่ ; `{"op":"page","name":"x","user":"wstaff"}` = เปลี่ยนผู้ใช้ทั้งเบราว์เซอร์)

### เทียบภาพก่อน/หลัง (regression)

```sh
git -C <repo> archive HEAD | tar -x -C <BASE>
# Windows: cmd /c mklink /J <BASE>\node_modules <repo>\node_modules   (macOS/Linux: ln -s <repo>/node_modules <BASE>/node_modules)
node app-server.mjs build <BASE>
node qa-shell.mjs --app <repo>:3485 --app <BASE>:3486 --out <OUT>
node regression.mjs --cur 3485 --base 3486 --out <OUT>/reg          # exit 1 ถ้ามีหน้าที่ต่าง (ไม่นับ /select)
```

`/users` จะต่างเมื่อ seed มีผู้ใช้ที่มีสิทธิ์ b.oncloud (ชุดก่อนแก้ไม่รู้จักคีย์ใหม่) — ดูภาพ `diff-*.png` ว่าต่างเฉพาะข้อความสิทธิ์

### ฟอนต์จริงในภาพ QA

ฟอนต์ของระบบ (Prompt — ชุด "ก่อนแก้" ที่เก่ากว่า 23/11/2569 ใช้ IBM Plex Sans Thai) ต้องเป็นไฟล์จริงตอน build ไม่งั้น mock ใช้ฟอนต์ในเครื่องแทน ความกว้างตัวอักษรไม่ตรง → ซ่อนปัญหาข้อความล้น
ดึงไฟล์สาธารณะ (OFL) ไว้ "นอก repo" ครั้งเดียว แล้วตั้ง `FONT_MOCK_DIR` ตอน build (ห้าม commit ไฟล์ฟอนต์ — `tools/qa/fonts/` อยู่ใน `.gitignore` ถ้าจะเก็บในนั้น):

```sh
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36'   # user-agent เดียวกับ next → ได้ woff2
D=<โฟลเดอร์ฟอนต์>; mkdir -p $D/prompt $D/ibm-plex-sans-thai
curl -sS -A "$UA" -o $D/prompt/google.css 'https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700;800&display=swap'
curl -sS -A "$UA" -o $D/ibm-plex-sans-thai/google.css 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap'
for fam in prompt ibm-plex-sans-thai; do for u in $(grep -o 'https://fonts.gstatic.com/[^)]*' $D/$fam/google.css | sort -u); do curl -sS -f -o $D/$fam/$(basename $u) $u; done; done
FONT_MOCK_DIR=$D node app-server.mjs build ../..       # ไฟล์ขาด → stderr ของ build มีบรรทัด [font-mock] เตือน
```

ชื่อโฟลเดอร์ย่อย = ชื่อฟอนต์ตัวเล็กคั่นด้วย `-` · น้ำหนักใน `google.css` ต้องครอบคลุมที่ `app/layout.tsx` ขอ (ขาดน้ำหนักไหน = ฟอนต์นั้นกลับไปใช้ฟอนต์ในเครื่อง)
ตรวจหลัง build: `<dir>/.next/static/media/` มีไฟล์ `.woff2` = ฟอนต์จริง ; มีแต่ `.ttf` = ฟอนต์แทนในเครื่อง (คำเตือน `[font-mock]` อาจหลุดจากท้าย log ที่ `app-server.mjs` พิมพ์)

### เก็บกวาด

- ปิด qa-shell (`{"op":"quit"}`) — ปิด Chrome, next start และ mock ให้เอง
- ลบ `.next` ทุกชุดที่ build (`rm -rf <repo>/.next <BASE>/.next`)
- ลบ junction `node_modules` ของชุดก่อนแก้ด้วย `cmd /c rmdir <BASE>\node_modules` ก่อนลบโฟลเดอร์ (อย่าลบแบบ recursive ทะลุ junction — จะลบ node_modules ของ repo)

## ข้อจำกัดของ mock

- PostgREST: รองรับเฉพาะรูปแบบที่แอปใช้ (ไม่มี full-text search, ไม่มี aggregate นอกจาก `count()` แบบไม่ใช้, กรองบน embed ใช้ได้กับ `rel.col=...`)
- Auth: ไม่ตรวจลายเซ็น JWT, ไม่มีอีเมลยืนยัน/OTP ; logout ไม่เพิกถอน token
- Storage: ไฟล์อยู่ในหน่วยความจำ, ไม่มีการแปลงรูป (`render/image`)
- ปิด mock = ข้อมูลหายทั้งหมด (เปิดใหม่ = seed ใหม่)
