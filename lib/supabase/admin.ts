import { createClient } from '@supabase/supabase-js'

// ใช้ service role key — เฉพาะใน server action เท่านั้น
// อย่า import ใน client component
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
