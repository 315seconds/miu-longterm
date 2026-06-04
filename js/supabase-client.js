const SUPABASE_URL = "https://yqnocnzjrcsrwrvsvsyg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxbm9jbnpqcmNzcndydnN2c3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjExNzgsImV4cCI6MjA5MTgzNzE3OH0.u172XxuUcRF7WhT0UmLq-xQjoeDjBt95Qgbstln8mMs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function sbUploadPhoto(hangerId, file) {
  const ext  = file.name.split(".").pop() || "jpg";
  const path = `${hangerId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("inventory-photos").upload(path, file, { upsert: true });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("inventory-photos").getPublicUrl(path);
  return data.publicUrl;
}
