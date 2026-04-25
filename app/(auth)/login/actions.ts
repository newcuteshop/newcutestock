'use server'
import { createClient } from '@/lib/supabase/server'

export async function loginAction(email: string, password: string) {
  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  return { success: true }
}
