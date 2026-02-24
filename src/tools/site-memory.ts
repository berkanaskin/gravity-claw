import * as fs from "node:fs";
import * as path from "node:path";

// ── Site Approval Memory ────────────────────────────────────
// Remembers which domains the user has approved.
// First visit to a domain → ask for approval.
// After approval → domain is stored and never asked again.

const MEMORY_DIR = "memory";
const SITES_FILE = path.join(MEMORY_DIR, "approved_sites.json");

interface SiteEntry {
  approvedAt: string;
  count: number;
}

type SitesStore = Record<string, SiteEntry>;

function loadSites(): SitesStore {
  try {
    if (fs.existsSync(SITES_FILE)) {
      const raw = fs.readFileSync(SITES_FILE, "utf-8");
      return JSON.parse(raw) as SitesStore;
    }
  } catch {
    console.error("⚠️ Failed to load approved sites, starting fresh");
  }
  return {};
}

function saveSites(sites: SitesStore): void {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ Failed to save approved sites:", err);
  }
}

/** Extract domain from a URL */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Check if a domain has been approved */
export function isSiteApproved(url: string): boolean {
  const domain = extractDomain(url);
  const sites = loadSites();
  return domain in sites;
}

/** Mark a domain as approved */
export function approveSite(url: string): void {
  const domain = extractDomain(url);
  const sites = loadSites();
  if (sites[domain]) {
    sites[domain].count += 1;
  } else {
    sites[domain] = {
      approvedAt: new Date().toISOString().substring(0, 10),
      count: 1,
    };
  }
  saveSites(sites);
  console.log(`✅ Site approved: ${domain}`);
}

/** Increment access count for an already-approved domain */
export function recordSiteAccess(url: string): void {
  const domain = extractDomain(url);
  const sites = loadSites();
  if (sites[domain]) {
    sites[domain].count += 1;
    saveSites(sites);
  }
}

/** Get all approved domains */
export function listApprovedSites(): SitesStore {
  return loadSites();
}
