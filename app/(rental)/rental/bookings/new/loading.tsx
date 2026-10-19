import BookingFormSkeleton from '@/components/rental/booking-form/BookingFormSkeleton'

// รอโหลดหน้าสร้างการจอง — โครงเดียวกับฟอร์มจริง (หัวหน้า + แถบขั้นตอน + การ์ด + แถบสรุปข้างจอ)
export default function Loading() {
  return <BookingFormSkeleton />
}
