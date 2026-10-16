import { createServiceSupabase } from "@/lib/supabase/server";

export interface ProposalAgentInfo {
  name: string;
  /** Agent's own direct inbox; falls back to their login email when personal_email isn't set. */
  email: string;
  photoPath: string | null;
}

interface AgentProfileRow {
  full_name: string | null;
  email: string;
  personal_email: string | null;
  photo_path: string | null;
  active: boolean;
}

const PROFILE_COLUMNS = "full_name, email, personal_email, photo_path, active";

/**
 * Resolves which in-house agent's photo/personal-email shows in the bottom
 * "your agent" section of a generated proposal PDF — the phone number shown
 * there is the agency's one shared office line/extension
 * (727-789-2200 X.1), not something per-agent, so it's hardcoded in each
 * generator rather than resolved here. Self
 * contained — every proposal-generating call site (the quote-request
 * pipeline, a manual "regenerate" click, the OneHome auto-quote finalizer)
 * calls this with just the property id; `quoteRequestId` is an optional
 * extra signal for the pipeline's own case, where the request being
 * finalized right now is more specific than the property's general
 * assignment.
 *
 * Priority:
 *   1. `quoteRequestId`'s own assigned_agent_id, when given (a producer
 *      explicitly took this particular request).
 *   2. The property's assigned_agent_id (set from the Properties list, or
 *      carried over from any earlier request against this property).
 *   3. The referring partner's linked agent
 *      (industry_contacts.referral_partner_agent_id) — via quoteRequestId's
 *      own contact_id when given, otherwise the most recent quote_request on
 *      file for this property, if any.
 *   4. The agency's earliest-created active admin, as a last-resort default
 *      so the section always has someone to show rather than going blank.
 * Returns null only if the agency has no admin at all to fall back to.
 */
export async function resolveProposalAgent(propertyId: string, quoteRequestId?: string | null): Promise<ProposalAgentInfo | null> {
  const supabase = createServiceSupabase();

  const { data: property } = await supabase.from("properties").select("agency_id, assigned_agent_id").eq("id", propertyId).maybeSingle();

  let agentId: string | null = property?.assigned_agent_id ?? null;
  let contactId: string | null = null;

  if (quoteRequestId) {
    const { data: request } = await supabase
      .from("quote_requests")
      .select("assigned_agent_id, contact_id")
      .eq("id", quoteRequestId)
      .maybeSingle();
    if (request?.assigned_agent_id) agentId = request.assigned_agent_id;
    contactId = request?.contact_id ?? null;
  } else {
    const { data: latestRequest } = await supabase
      .from("quote_requests")
      .select("contact_id")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    contactId = latestRequest?.contact_id ?? null;
  }

  if (!agentId && contactId) {
    const { data: contact } = await supabase
      .from("industry_contacts")
      .select("referral_partner_agent_id")
      .eq("id", contactId)
      .maybeSingle();
    agentId = contact?.referral_partner_agent_id ?? null;
  }

  let profile: AgentProfileRow | null = null;
  if (agentId) {
    const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", agentId).maybeSingle();
    profile = data?.active ? data : null;
  }

  if (!profile && property?.agency_id) {
    const { data: defaultAdmin } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("agency_id", property.agency_id)
      .eq("role", "admin")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    profile = defaultAdmin ?? null;
  }

  if (!profile) return null;

  return {
    name: profile.full_name ?? profile.email,
    email: profile.personal_email ?? profile.email,
    photoPath: profile.photo_path,
  };
}
