// Hand-written to match supabase/migrations/0001_init_schema.sql.
// Once the project is linked, replace with the generated file:
//   supabase gen types typescript --linked > lib/types/database.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type DocumentKind = "4point" | "windmit" | "inspection" | "carrier_quote";
export type PropertyStatus =
  | "new"
  | "enriched"
  | "indication_sent"
  | "replied"
  | "quoted"
  | "closed"
  | "dead";
export type ProposalKind = "indication" | "firm" | "listing_snapshot";
export type OutreachStatus = "pending_review" | "approved" | "sent" | "bounced" | "rejected";
export type QuoteAdapterName =
  | "indicative"
  | "manual"
  | "selectsys"
  | "ivans"
  | "fetch_quoting";
export type ListingSourceName = "bridge" | "trestle" | "mlsgrid" | "county" | "onehome";

export interface Database {
  public: {
    Tables: {
      agencies: {
        Row: {
          id: string;
          name: string;
          license_number: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["agencies"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["agencies"]["Row"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          agency_id: string;
          email: string;
          role: "producer" | "admin";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          agency_id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      properties: {
        Row: {
          id: string;
          agency_id: string;
          mls_id: string | null;
          source: ListingSourceName;
          address: string;
          house_number: string | null;
          street: string | null;
          city: string | null;
          county: string | null;
          state: string;
          zipcode: string | null;
          parcel_id: string | null;
          year_built: number | null;
          construction: string | null;
          roof_year: number | null;
          sqft: number | null;
          lat: number | null;
          lng: number | null;
          list_price: number | null;
          beds: number | null;
          baths: number | null;
          listing_agent_name: string | null;
          listing_agent_email: string | null;
          listing_agent_phone: string | null;
          photo_path: string | null;
          status: PropertyStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["properties"]["Row"]> & {
          agency_id: string;
          source: ListingSourceName;
          address: string;
        };
        Update: Partial<Database["public"]["Tables"]["properties"]["Row"]>;
        Relationships: [];
      };
      enrichments: {
        Row: {
          id: string;
          agency_id: string;
          property_id: string;
          flood_zone: string | null;
          wind_borne_debris_region: boolean | null;
          dist_to_coast_miles: number | null;
          county_appraiser_payload: Json | null;
          terrain: string | null;
          provider: string | null;
          fetched_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["enrichments"]["Row"]> & {
          agency_id: string;
          property_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["enrichments"]["Row"]>;
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          agency_id: string;
          property_id: string;
          kind: DocumentKind;
          storage_path: string;
          extraction_json: Json | null;
          extraction_confidence: Json | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["documents"]["Row"]> & {
          agency_id: string;
          property_id: string;
          kind: DocumentKind;
          storage_path: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Row"]>;
        Relationships: [];
      };
      risk_profiles: {
        Row: {
          id: string;
          agency_id: string;
          property_id: string;
          underwriting_inputs: Json;
          wind_mit_credit_vector: Json | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["risk_profiles"]["Row"]> & {
          agency_id: string;
          property_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["risk_profiles"]["Row"]>;
        Relationships: [];
      };
      carrier_appetites: {
        Row: {
          id: string;
          agency_id: string;
          carrier: string;
          rules: Json;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["carrier_appetites"]["Row"]> & {
          agency_id: string;
          carrier: string;
        };
        Update: Partial<Database["public"]["Tables"]["carrier_appetites"]["Row"]>;
        Relationships: [];
      };
      quotes: {
        Row: {
          id: string;
          agency_id: string;
          property_id: string;
          carrier: string;
          adapter: QuoteAdapterName;
          premium: number | null;
          coverages: Json | null;
          credits: Json | null;
          is_indicative: boolean;
          external_quote_request_id: string | null;
          external_rate_id: string | null;
          form_type: string | null;
          raw_response: Json | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quotes"]["Row"]> & {
          agency_id: string;
          property_id: string;
          carrier: string;
          adapter: QuoteAdapterName;
        };
        Update: Partial<Database["public"]["Tables"]["quotes"]["Row"]>;
        Relationships: [];
      };
      proposals: {
        Row: {
          id: string;
          agency_id: string;
          property_id: string;
          kind: ProposalKind;
          pdf_path: string | null;
          version: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["proposals"]["Row"]> & {
          agency_id: string;
          property_id: string;
          kind: ProposalKind;
        };
        Update: Partial<Database["public"]["Tables"]["proposals"]["Row"]>;
        Relationships: [];
      };
      outreach: {
        Row: {
          id: string;
          agency_id: string;
          proposal_id: string;
          recipient: string;
          status: OutreachStatus;
          approved_by: string | null;
          sent_at: string | null;
          opens: number;
          replies: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["outreach"]["Row"]> & {
          agency_id: string;
          proposal_id: string;
          recipient: string;
        };
        Update: Partial<Database["public"]["Tables"]["outreach"]["Row"]>;
        Relationships: [];
      };
      suppressions: {
        Row: {
          id: string;
          agency_id: string;
          email_or_domain: string;
          reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["suppressions"]["Row"]> & {
          agency_id: string;
          email_or_domain: string;
        };
        Update: Partial<Database["public"]["Tables"]["suppressions"]["Row"]>;
        Relationships: [];
      };
      county_parcels: {
        Row: {
          strap: string;
          county: string;
          parcel_number: string | null;
          site_address: string | null;
          city: string | null;
          zipcode: string | null;
          str_num: string | null;
          str_name: string | null;
          str_sfx: string | null;
          year_built: number | null;
          heated_area_sqft: number | null;
          gross_area_sqft: number | null;
          exterior_walls: string | null;
          roof_cover: string | null;
          roof_frame: string | null;
          impr_dscr: string | null;
          synced_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["county_parcels"]["Row"]> & {
          strap: string;
        };
        Update: Partial<Database["public"]["Tables"]["county_parcels"]["Row"]>;
        Relationships: [];
      };
      county_roof_permits: {
        Row: {
          strap: string;
          parcel_number: string | null;
          permit_number: string | null;
          agency_name: string | null;
          issue_dt: string;
          roof_year: number;
          est_val: number | null;
          roof_permit_count: number;
          synced_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["county_roof_permits"]["Row"]> & {
          strap: string;
          issue_dt: string;
          roof_year: number;
        };
        Update: Partial<Database["public"]["Tables"]["county_roof_permits"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
