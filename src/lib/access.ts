import { User } from "@supabase/supabase-js";

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

function parseEmailList(value?: string) {
  return new Set(
    (value || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getUserEmail(user: User | null | undefined) {
  return typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
}

export function getFeatureAccess(user: User | null | undefined): FeatureAccess {
  const email = getUserEmail(user);
  const adminEmails = parseEmailList(process.env.EXPO_PUBLIC_ADMIN_EMAILS);
  const vipEmails = parseEmailList(process.env.EXPO_PUBLIC_VIP_EMAILS);
  const isAdmin = Boolean(email && adminEmails.has(email));
  const isVip = Boolean(email && vipEmails.has(email));
  const accessMode: AccessMode = isAdmin ? "admin" : isVip ? "vip" : "public";

  return {
    accessMode,
    features: {
      campaignMode: accessMode === "vip" || accessMode === "admin",
      copySlackCanvas: true,
      exportCsv: accessMode === "vip" || accessMode === "admin",
      directSlackCanvas: accessMode === "admin",
      aiEnhancedFollowUp: accessMode === "admin",
    },
  };
}
