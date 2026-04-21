import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error("Missing Supabase environment variables.")
      return Response.json({ success: false, error: "Server Configuration Error" }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    const body = await req.json();
    const { email, company, twitter } = body;

    // Validate
    if (!email) {
      return Response.json({ success: false, error: "Email is required" }, { status: 400 });
    }

    // Insert into Supabase table (assuming the table is named 'waitlist' and has these columns)
    const { data, error } = await supabase
      .from('waitlist')
      .insert([
        {
          email: email,
          company: company || null,
          twitter: twitter || null
        }
      ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }

    console.log("Successfully added to waitlist collection!");

    return Response.json({ success: true, message: "Successfully added to waitlist!" });
  } catch (err: any) {
    console.error("Unexpected error in waitlist route:", err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
