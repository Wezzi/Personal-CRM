import { User } from "@supabase/supabase-js";

import { supabase } from "./supabase";

export type AccessMode = "public" | "vip" | "admin";

export type FeatureAccess = {
  accessMode: AccessMode;
  features: {
    campaignMode: boolean;
    copySlackCanvas: boolean;
    exportCsv: boolean;
    directSlackCanvas: boolean;
    aiEnhancedFollowUp: boolean;
  };
};

type ProfileAccessRow = {
  access_role: string | null;
  feature_flags: Record<string, unknown> | null;
};

const publicAccess: FeatureAccess = {
  accessMode: "public",
  features: {
    campaignMode: false,
    copySlackCanvas: true,
    exportCsv: false,
    directSlackCanvas: false,
    aiEnhancedFollowUp: false,
  },
};

function normalizeAccessMode(value?: string | null): AccessMode {
  return value === "admin" || value === "vip" ? value : "public";
}

function buildAccessFromRole(accessMode: AccessMode, flags: Record<string, unknown> = {}): FeatureAccess {
  return {
    accessMode,
    features: {
      campaignMode: Boolean(flags.campaignMode) || accessMode === "vip" || accessMode === "admin",
      copySlackCanvas: flags.copySlackCanvas === false ? false : true,
      exportCsv: Boolean(flags.exportCsv) || accessMode === "vip" || accessMode === "admin",
      directSlackCanvas: Boolean(flags.directSlackCanvas) || accessMode === "admin",
      aiEnhancedFollowUp: Boolean(flags.aiEnhancedFollowUp) || accessMode === "admin",
    },
  };
}

export function getPublicFeatureAccess(): FeatureAccess {
  return publicAccess;
}

export async function getFeatureAccessForUser(user: User | null | undefined): Promise<FeatureAccess> {
  if (!user || user.is_anonymous) {
    return publicAccess;
  }

  if (supabase) {
    const { data, error } = await supabase
      .from("profiles")
      .select("access_role,feature_flags")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data) {
      const row = data as ProfileAccessRow;
      return buildAccessFromRole(normalizeAccessMode(row.access_role), row.feature_flags || {});
    }
  }

  return publicAccess;
}
