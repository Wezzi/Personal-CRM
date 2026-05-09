export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Database = {
	public: {
		Tables: {
				profiles: {
					Row: {
						access_role: string;
						created_at: string;
						email: string | null;
						feature_flags: Json;
						user_id: string;
						username: string;
					};
					Insert: {
						access_role?: string;
						created_at?: string;
						email?: string | null;
						feature_flags?: Json;
						user_id: string;
						username: string;
					};
					Update: {
						access_role?: string;
						created_at?: string;
						email?: string | null;
						feature_flags?: Json;
						user_id?: string;
						username?: string;
					};
				Relationships: [
					{
						foreignKeyName: "profiles_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: true;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			reminder_preferences: {
				Row: {
					created_at: string;
					email_digest_enabled: boolean;
					last_digest_sent_on: string | null;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					email_digest_enabled?: boolean;
					last_digest_sent_on?: string | null;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					created_at?: string;
					email_digest_enabled?: boolean;
					last_digest_sent_on?: string | null;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "reminder_preferences_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: true;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			events: {
				Row: {
						category: string | null;
					created_at: string;
					event_date: string | null;
					id: string;
					name: string;
					user_id: string;
				};
				Insert: {
						category?: string | null;
					created_at?: string;
					event_date?: string | null;
					id?: string;
					name: string;
					user_id: string;
				};
				Update: {
						category?: string | null;
					created_at?: string;
					event_date?: string | null;
					id?: string;
					name?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "events_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			persons: {
				Row: {
						company: string | null;
						email: string | null;
					created_at: string;
					id: string;
					is_vip: boolean;
						linkedin_url: string | null;
					name: string | null;
					preferred_channel: string | null;
					preferred_channel_other: string | null;
					priority: string;
						phone_number: string | null;
					photo_url: string | null;
					tags: string[];
					user_id: string;
				};
				Insert: {
						company?: string | null;
						email?: string | null;
					created_at?: string;
					id?: string;
					is_vip?: boolean;
						linkedin_url?: string | null;
					name?: string | null;
					preferred_channel?: string | null;
					preferred_channel_other?: string | null;
					priority?: string;
						phone_number?: string | null;
					photo_url?: string | null;
					tags?: string[];
					user_id: string;
				};
				Update: {
						company?: string | null;
						email?: string | null;
					created_at?: string;
					id?: string;
					is_vip?: boolean;
						linkedin_url?: string | null;
					name?: string | null;
					preferred_channel?: string | null;
					preferred_channel_other?: string | null;
					priority?: string;
						phone_number?: string | null;
					photo_url?: string | null;
					tags?: string[];
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "persons_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			interactions: {
				Row: {
					created_at: string;
					event_id: string | null;
					id: string;
					person_id: string;
					raw_note: string;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					event_id?: string | null;
					id?: string;
					person_id: string;
					raw_note: string;
					user_id: string;
				};
				Update: {
					created_at?: string;
					event_id?: string | null;
					id?: string;
					person_id?: string;
					raw_note?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "interactions_event_id_fkey";
						columns: ["event_id"];
						isOneToOne: false;
						referencedRelation: "events";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "interactions_person_id_fkey";
						columns: ["person_id"];
						isOneToOne: false;
						referencedRelation: "persons";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "interactions_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	auth: {
		Tables: {
			users: {
				Row: {
					id: string;
				};
				Insert: {
					id: string;
				};
				Update: {
					id?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};
