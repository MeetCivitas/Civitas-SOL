import { createClient } from '@supabase/supabase-js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error("[waitlist] Missing Supabase env vars")
      return Response.json(
        {
          success: false,
          error:
            "Waitlist storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and a Supabase key in .env.local.",
        },
        { status: 503 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const rawEmail = typeof body?.email === "string" ? body.email : ""
    const company = typeof body?.company === "string" ? body.company.trim() : ""
    const twitter = typeof body?.twitter === "string" ? body.twitter.trim() : ""

    const email = rawEmail.trim().toLowerCase()
    if (!email) {
      return Response.json({ success: false, error: "Email is required." }, { status: 400 })
    }
    if (!EMAIL_RE.test(email)) {
      return Response.json({ success: false, error: "Please enter a valid email address." }, { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    })

    const { error } = await supabase.from('waitlist').insert([
      {
        email,
        company: company || null,
        twitter: twitter || null,
      },
    ])

    if (error) {
      // 23505 = unique_violation (duplicate email). Treat as idempotent success.
      if (error.code === "23505") {
        return Response.json({
          success: true,
          alreadyOnList: true,
          message: "You're already on the list. We'll be in touch soon.",
        })
      }
      console.error("[waitlist] Supabase insert error:", error)
      return Response.json(
        { success: false, error: error.message || "Failed to save your entry." },
        { status: 500 },
      )
    }

    return Response.json({ success: true, message: "You're on the waitlist." })
  } catch (err: any) {
    console.error("[waitlist] Unexpected error:", err)
    return Response.json(
      { success: false, error: err?.message || "Unexpected error." },
      { status: 500 },
    )
  }
}
