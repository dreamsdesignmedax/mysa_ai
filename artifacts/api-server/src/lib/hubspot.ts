// HubSpot integration via Replit Connectors SDK
import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

interface HsListResponse<T> {
  results?: T[];
  paging?: { next?: { after?: string } };
}

async function hs<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await connectors.proxy("hubspot", path, options as any);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

export async function fetchAllContacts(): Promise<HubSpotContact[]> {
  const props = [
    "firstname","lastname","email","phone","jobtitle","company",
    "city","country","website","industry","linkedin_bio","hs_lead_status",
    "num_associated_deals","hubspot_owner_id",
  ].join(",");

  let all: HubSpotContact[] = [];
  let after: string | undefined;

  do {
    const url = `/crm/v3/objects/contacts?limit=100&properties=${props}${after ? `&after=${after}` : ""}`;
    const data = await hs<HsListResponse<HubSpotContact>>(url);
    all = all.concat(data.results ?? []);
    after = data.paging?.next?.after;
  } while (after);

  return all;
}

// ─── Companies ──────────────────────────────────────────────────────────────

export interface HubSpotCompany {
  id: string;
  properties: Record<string, string | null>;
}

export async function fetchAllCompanies(): Promise<HubSpotCompany[]> {
  const props = [
    "name","domain","city","country","industry","phone","numberofemployees","annualrevenue",
  ].join(",");

  let all: HubSpotCompany[] = [];
  let after: string | undefined;

  do {
    const url = `/crm/v3/objects/companies?limit=100&properties=${props}${after ? `&after=${after}` : ""}`;
    const data = await hs<HsListResponse<HubSpotCompany>>(url);
    all = all.concat(data.results ?? []);
    after = data.paging?.next?.after;
  } while (after);

  return all;
}

// ─── Deals ──────────────────────────────────────────────────────────────────

export interface HubSpotDeal {
  id: string;
  properties: Record<string, string | null>;
}

export async function fetchPipelines(): Promise<any[]> {
  const data = await hs<HsListResponse<Record<string, unknown>>>("/crm/v3/pipelines/deals");
  return data.results ?? [];
}

export async function createDeal(params: {
  dealname: string;
  pipeline: string;
  dealstage: string;
  amount?: string;
  company?: string;
  email?: string;
  phone?: string;
  description?: string;
  lead_status?: string;
}): Promise<HubSpotDeal> {
  const body = {
    properties: {
      dealname: params.dealname,
      pipeline: params.pipeline,
      dealstage: params.dealstage,
      ...(params.amount ? { amount: params.amount } : {}),
      ...(params.description ? { description: params.description } : {}),
      closedate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  };

  const deal = await hs<HubSpotDeal>("/crm/v3/objects/deals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // If there's an email, try to find the contact and associate them
  if (params.email) {
    try {
      const search = await hs<HsListResponse<HubSpotContact>>("/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: "email", operator: "EQ", value: params.email }],
          }],
          limit: 1,
        }),
      });

      let contactId: string | undefined = search.results?.[0]?.id;

      // Create contact if not found
      if (!contactId) {
        const [firstName, ...rest] = (params.dealname ?? "").split(" ");
        const newContact = await hs<HubSpotContact>("/crm/v3/objects/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            properties: {
              email: params.email,
              firstname: firstName ?? params.dealname,
              lastname: rest.join(" ") || "",
              phone: params.phone ?? "",
              company: params.company ?? "",
            },
          }),
        });
        contactId = newContact.id;
      }

      // Associate contact to deal
      if (contactId) {
        await hs(`/crm/v4/objects/deals/${deal.id}/associations/contacts/${contactId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }]),
        });
      }
    } catch (_) {
      // non-fatal — deal is created even if association fails
    }
  }

  return deal;
}

export async function upsertContact(params: {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
  jobtitle?: string;
  city?: string;
  country?: string;
  website?: string;
}): Promise<HubSpotContact> {
  return hs<HubSpotContact>(`/crm/v3/objects/contacts?idProperty=email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: params }),
  });
}
