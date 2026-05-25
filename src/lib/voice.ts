import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { Platform } from "react-native";

import { missingSupabaseEnvMessage, supabase } from "./supabase";

export type VoiceTranscriptionResult = {
  transcript: string;
  draft: {
    whatMatters?: string;
    name?: string;
    company?: string;
    event?: string;
    nextStep?: string;
    tags?: string[];
  };
};

type TranscribeAudioInput = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("aac")) return "aac";
  return "m4a";
}

export async function transcribeContactAudio({
  uri,
  mimeType = "audio/m4a",
  fileName = "contact-note.m4a",
}: TranscribeAudioInput): Promise<VoiceTranscriptionResult> {
  if (!supabase) {
    throw new Error(missingSupabaseEnvMessage);
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message || "Could not read auth session.");
  }

  if (!session?.access_token) {
    throw new Error("No active session found. Please sign in again, then retry voice capture.");
  }

  const formData = new FormData();

  if (Platform.OS === "web") {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error("Could not read recorded audio blob.");
    }

    const blob = await response.blob();
    const actualMimeType = blob.type || mimeType || "audio/webm";
    const actualFileName = `contact-note.${extensionFromMimeType(actualMimeType)}`;

    const file = new File([blob], actualFileName, { type: actualMimeType });
    formData.append("file", file);
  } else {
    formData.append(
      "file",
      {
        uri,
        name: fileName,
        type: mimeType,
      } as any
    );
  }

  const { data, error } = await supabase.functions.invoke("transcribe-contact-route", {
    body: formData,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error instanceof FunctionsHttpError) {
    let details = "Function returned an HTTP error.";
    try {
      const body = await error.context.json();
      details = body?.details || body?.error || JSON.stringify(body);
    } catch {
      try {
        details = await error.context.text();
      } catch {
        details = error.message;
      }
    }
    throw new Error(details);
  }

  if (error instanceof FunctionsRelayError) {
    throw new Error(`Relay error: ${error.message}`);
  }

  if (error instanceof FunctionsFetchError) {
    throw new Error(`Fetch error: ${error.message}`);
  }

  if (error) {
    throw new Error(error.message || "Voice transcription failed.");
  }

  return {
    transcript: data?.transcript || "",
    draft: data?.draft || {},
  };
}
