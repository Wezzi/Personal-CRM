import { missingSupabaseEnvMessage, supabase } from "./supabase";

function assertClient() {
  if (!supabase) {
    throw new Error(missingSupabaseEnvMessage);
  }

  return supabase;
}

export async function getEmailDigestEnabled(userId: string) {
  const client = assertClient();
  const { data, error } = await client
    .from("reminder_preferences")
    .select("email_digest_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.email_digest_enabled);
}

export async function setEmailDigestEnabled(userId: string, enabled: boolean) {
  const client = assertClient();
  const { error } = await client.from("reminder_preferences").upsert({
    user_id: userId,
    email_digest_enabled: enabled,
  });

  if (error) {
    throw new Error(error.message);
  }
}
