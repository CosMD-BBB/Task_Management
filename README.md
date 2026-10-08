# Room · Team task management

เว็บจัดการงานในทีม พร้อมห้องโปรเจกต์ส่วนตัวและมุมมอง **List, Board, Calendar** ออกแบบสำหรับทีมคอนเทนต์ รองรับภาษาไทยและใช้งานบนมือถือได้

## สิ่งที่ใช้งานได้

- สมัครบัญชี, Login, Logout และ session ที่เก็บในฐานข้อมูล รหัสผ่านเข้ารหัสด้วย bcrypt
- สร้าง/แก้ไข/ลบห้องโปรเจกต์ เจ้าของเชิญสมาชิกด้วยอีเมลที่สมัครแล้ว และเลือก **Editor** หรือ **Viewer**
- API ตรวจสิทธิ์ทุกครั้ง ผู้ที่ไม่ได้เป็นสมาชิกจะมองไม่เห็นห้องหรืองาน แม้รู้ ID
- สร้าง/แก้ไข/ลบงาน ระบุ status, assignee, due date, priority, Type Content, Channel
- แนบ **ลิงก์ไฟล์** Google Drive/Figma/URL, checklist และคอลัมน์กำหนดเองแบบข้อความหรือตัวเลือก
- List จัดกลุ่มสถานะ, Board ลากการ์ดหรือเปลี่ยนสถานะจากเมนู, Calendar แสดงงานตาม due date
- ค้นหา, กรองความสำคัญ/ช่องทาง/ผู้รับผิดชอบ, เรียงลำดับ และสรุปจำนวนงาน
- ปุ่มทดลองใช้สร้างห้องตัวอย่างส่วนตัวแยกจากคนอื่น บัญชีทดลองเข้าซ้ำได้เฉพาะ session เดิม

การแนบไฟล์เป็นการแนบลิงก์ ไม่ได้อัปโหลดไฟล์เข้าเว็บไซต์ สมาชิกต้องมีสิทธิ์เปิดไฟล์ที่บริการต้นทางด้วย

## รันในเครื่องหรือ Codex Cloud

ใช้ Node.js **24.x** และ checkout เดิมที่ `/workspace/Task_Management` ไม่ต้องสร้าง Git worktree

```bash
cd /workspace/Task_Management
npm ci
npm run dev
```

Vite รันพอร์ต 5173 และ proxy `/api` ไป Express พอร์ต 3000 สำหรับพัฒนา หากต้องการรันเว็บที่ build แล้ว:

```bash
npm run build
npm start
```

Express ให้บริการทั้งหน้าเว็บและ API ที่พอร์ต 3000 `GET /api/health` ต้องตอบ `{ "status": "ok", "storage": "sqlite" }` และปุ่มทดลองใช้ต้องสร้างงานที่ดูและแก้ไขได้จริง

ฐานข้อมูล SQLite เก็บที่ `.data/workspace.sqlite` แบบ WAL และไม่ถูก commit ใน Git รีสตาร์ตแอปไม่ลบข้อมูล ตั้ง `SQLITE_PATH` เพื่อเปลี่ยนตำแหน่งได้ ก่อนสำรองฐานข้อมูลให้หยุดแอปหรือใช้ SQLite backup API และเก็บสำเนาอย่างปลอดภัย

## ทดสอบ

```bash
npm test
npm run build
npm start
# อีก terminal; Chromium ในสภาพแวดล้อมนี้ติดตั้งที่ /usr/bin/chromium
npm run test:e2e
```

API tests ใช้ฐานข้อมูลชั่วคราวแยก ทดสอบ Login/session, สิทธิ์สมาชิก, การแยกข้อมูล, validation, CRUD และข้อมูลหลังเปิดฐานข้อมูลใหม่ E2E ใช้บัญชีแยกเพื่อทดสอบผ่านเบราว์เซอร์ ดู config สำหรับการเลือก executable ของ Chromium

## ขึ้น Vercel พร้อมฐานข้อมูลถาวร

SQLite ของเครื่องพัฒนาใช้บน Vercel ไม่ได้ เพราะไฟล์ของ serverless ไม่คงอยู่ แอปรองรับ PostgreSQL ผ่าน `DATABASE_URL` และจะไม่เผลอใช้ SQLite บน Vercel

1. นำโค้ด repository นี้ขึ้น GitHub แล้ว Import Project ใน [Vercel](https://vercel.com/new)
2. เชื่อม [Neon](https://neon.tech) หรือ PostgreSQL provider ผ่าน Vercel Storage/Marketplace
3. เพิ่ม `DATABASE_URL` เป็น pooled PostgreSQL URL ใน Vercel Environment Variables ให้ทั้ง Preview และ Production เก็บค่าลับใน Settings เท่านั้น อย่าใส่ในโค้ดหรือแชต ต้องเปิด TLS พร้อมตรวจ certificate
4. ใช้ Node.js 24.x, install `npm ci`, build `npm run build`, output `dist` และ config `vercel.json` ที่ให้ไว้
5. Deploy แล้วตรวจ `/api/health` ต้องตอบ `storage: "postgres"` สมัครบัญชี สร้างงาน รีโหลด และทดสอบการเข้าถึงด้วยอีกบัญชี

ฐานข้อมูลสร้างตารางและดัชนีอัตโนมัติจาก `server/database.js` การ deploy แต่ละครั้งไม่ลบข้อมูล ถ้าต้องย้ายข้อมูล SQLite เดิมเข้า Postgres ต้องมีขั้นตอน migration แยก **ไม่ได้ย้ายข้อมูลให้อัตโนมัติ**

เมื่อ GitHub เชื่อมกับ Vercel แล้ว commit ใหม่จะสร้าง deployment ใหม่ได้ ให้ Codex แก้โค้ดและทดสอบก่อน push หรือ review PR การแก้ settings/deploy ผ่าน Codex โดยตรงต้องเชื่อมบัญชีหรือให้สิทธิ์ Vercel ผ่านช่องทางที่ปลอดภัยก่อน

## ลิงก์ตัวอย่างชั่วคราว

เว็บในเครื่องเปิดให้ทีมภายนอกได้ผ่าน tunnel ที่ forward เฉพาะพอร์ต 3000 ลิงก์จะอยู่ได้เฉพาะช่วงที่ cloud machine, แอป และ tunnel ทำงาน ลิงก์นี้ไม่ใช่ hosting ถาวร เก็บ URL ที่บริการออกให้จริงเท่านั้น ไม่ใช้ localhost เป็นลิงก์สำหรับผู้ใช้ภายนอก

มี GitHub Actions workflow **Temporary website preview** สำหรับ repository นี้ โดย build/test แอปบน runner แล้วเปิด Cloudflare tunnel **30 นาที** ตรวจหน้าเว็บและ CRUD ผ่านลิงก์สาธารณะก่อนเผยแพร่ URL ที่ [preview-live/preview.json](https://github.com/CosMD-BBB/Task_Management/blob/preview-live/preview.json) รันใหม่ได้จาก Actions → Temporary website preview → Run workflow การเปลี่ยน source บน main จะเริ่มรอบใหม่และปิดรอบเก่า

ฐานข้อมูลของ preview runner แยกจากเครื่องพัฒนาและถูกลบเมื่อจบรอบ จึงควรใช้ข้อมูลทดลองเท่านั้น เว็บไซต์ถาวรต้องใช้ Vercel + Postgres ตามขั้นตอนด้านบน การเปิด preview ต้องมี GitHub Actions และสิทธิ์ workflow เขียน branch สำหรับ metadata

## ก่อนใช้จริงกับทีม

ระบบนี้มี Login ด้วยรหัสผ่านและกำหนดสิทธิ์รายโปรเจกต์แล้ว แต่ยังไม่มีอีเมลยืนยันบัญชี/รีเซ็ตรหัสผ่าน, OAuth, การอัปโหลดไฟล์, comment thread, realtime synchronization หรือการแจ้งเตือนทางอีเมล ต้องกำหนดระบบสำรองข้อมูลและนโยบายสมัครสมาชิกก่อนใช้งานในองค์กร
