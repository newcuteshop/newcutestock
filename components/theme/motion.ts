// ค่าที่ใช้ร่วมกันระหว่าง app/layout.tsx (server) และ MotionToggle (client)
// เก็บแยกไฟล์ เพราะค่าที่ export จากไฟล์ 'use client' นำไปใช้ฝั่ง server ตรงๆ ไม่ได้

export const MOTION_STORAGE_KEY = 'newcute-motion'

// รันใน <head> ก่อนหน้าเว็บแสดงผล: ผู้ใช้ที่ปิดเอฟเฟกต์ไว้จะไม่เห็นแสง/กลีบวิ่งแวบแรก
export const MOTION_BOOT_SCRIPT = `try{document.documentElement.dataset.motion=localStorage.getItem('${MOTION_STORAGE_KEY}')==='off'?'off':'on'}catch(e){}`
