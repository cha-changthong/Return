# TikTok Return Parcel Inspection System (ระบบเช็คพัสดุสินค้าตีกลับ)

ระบบเช็คพัสดุตีกลับที่ออกแบบสำหรับการใช้งานในคลังสินค้า รองรับการทำงานร่วมกันระหว่าง **GitHub Pages + Google Apps Script + Google Sheets + Google Drive**

## ✨ คุณสมบัติเด่น (Features)

- 📱 **Mobile First for Warehouse Staff**:
  - สแกนบาร์โค้ด Tracking ID จากหน้ากล่องพัสดุได้รวดเร็วทันใจ (รองรับ Code 128, QR Code, DataMatrix)
  - ระบบเสียง Beep และการสั่น (Haptic Feedback) เมื่อสแกนติด
  - Checklist ตรวจสอบจำนวนและรายการสินค้าแต่ละ SKU
  - ถ่ายรูปกล่องพัสดุและคลิปวิดีโอแกะกล่องตรวจสภาพสินค้า
  - **Client-Side Compression**: บีบอัดรูปถ่ายในเครื่องก่อนส่ง ลดขนาดไฟล์ 80-90% ส่งไวเสร็จใน 1-2 วินาที
  - **Local Cache**: ค้นหาเลขพัสดุในเครื่องได้ทันที 0.01 วินาที แม้เน็ตช้า

- 💻 **Admin Portal & Dashboard**:
  - อัปโหลดไฟล์ Excel 2 ไฟล์จาก TikTok (`ทั้งหมด คำสั่งซื้อ` และ `คำสั่งซื้อที่ส่งคืน_คืนเงิน`)
  - รวมรายการและกรอง Order ID ซ้ำให้อัตโนมัติใน Browser
  - สรุปสถิติภาพรวม: ยอดคืนทั้งหมด, ตรวจแล้ว, มีปัญหา/ไม่ครบ, รอดำเนินการ
  - ค้นหาและกรองข้อมูลแบบละเอียด
  - ดูรูปถ่ายและคลิปวิดีโอหลักฐานที่พนักงานบันทึกไว้
  - ส่งออกรายงานกลับเป็นไฟล์ Excel (.xlsx)

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
├── index.html          # หน้าเว็บหลัก Single Page Application
├── css/
│   └── style.css       # สไตล์ CSS และ Animation
├── js/
│   └── app.js          # Logic หลักของระบบ (Scanner, Merge Excel, Compression, API)
├── backend/
│   └── Code.gs         # โค้ด Google Apps Script API สำหรับเชื่อมต่อ Google Sheets & Drive
├── SETUP_GUIDE.md      # คู่มือการติดตั้งและใช้งานอย่างละเอียด
└── README.md           # คำอธิบายโปรเจกต์
```

## 🚀 เริ่มต้นใช้งาน (Quick Start)

อ่านขั้นตอนการติดตั้งอย่างละเอียดได้ที่ [SETUP_GUIDE.md](SETUP_GUIDE.md)
