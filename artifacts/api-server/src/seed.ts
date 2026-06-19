import { db, auditCategories, auditSignals, outreachSequences, icps, leads } from "@workspace/db";

async function seed() {
  console.log("🌱 Seeding database...");

  // Clear and re-seed audit categories/signals with canonical taxonomy
  await db.delete(auditSignals);
  await db.delete(auditCategories);

  const categories = [
    { name: "AI SEO & Organic Search", slug: "seo-organic" },
    { name: "Google My Business (GMB)", slug: "gmb" },
    { name: "Website & Conversion", slug: "website-conversion" },
    { name: "Online Reputation & Reviews", slug: "online-reputation" },
    { name: "Social Media & Content", slug: "social-media" },
    { name: "Paid Ads & Retargeting", slug: "paid-ads" },
    { name: "Traffic & Keyword Analytics", slug: "traffic-keywords" },
    { name: "AI & Automation Readiness", slug: "ai-automation" },
  ];

  const insertedCategories = await db
    .insert(auditCategories)
    .values(categories)
    .returning();

  console.log(`✅ Audit categories: ${insertedCategories.length} inserted`);

  const allCategories = await db.select().from(auditCategories);
  const catMap = Object.fromEntries(allCategories.map((c) => [c.slug, c.id]));

  const signals = [
    // AI SEO & Organic Search — 17 signals (12 classic + 5 AI-specific)
    { categoryId: catMap["seo-organic"]!, name: "Google Search Console verified and active", severity: "critical" },
    { categoryId: catMap["seo-organic"]!, name: "SEO meta titles and descriptions on all pages", severity: "critical" },
    { categoryId: catMap["seo-organic"]!, name: "AI-generated content strategy and topic clusters in place", severity: "critical" },
    { categoryId: catMap["seo-organic"]!, name: "Keyword-optimised service/product pages", severity: "high" },
    { categoryId: catMap["seo-organic"]!, name: "Blog or thought leadership content (10+ posts)", severity: "high" },
    { categoryId: catMap["seo-organic"]!, name: "Backlink profile (10+ quality referring domains)", severity: "high" },
    { categoryId: catMap["seo-organic"]!, name: "Core Web Vitals passing (LCP < 2.5s)", severity: "high" },
    { categoryId: catMap["seo-organic"]!, name: "AI SEO platform in use (Surfer SEO / Ahrefs / Semrush AI)", severity: "high" },
    { categoryId: catMap["seo-organic"]!, name: "Google AI Overview / SGE optimisation (FAQ + entity markup)", severity: "high" },
    { categoryId: catMap["seo-organic"]!, name: "Structured data (Schema.org) markup present", severity: "medium" },
    { categoryId: catMap["seo-organic"]!, name: "Internal linking structure across key pages", severity: "medium" },
    { categoryId: catMap["seo-organic"]!, name: "Local SEO pages for each service city/region", severity: "medium" },
    { categoryId: catMap["seo-organic"]!, name: "Alt text on all website images", severity: "medium" },
    { categoryId: catMap["seo-organic"]!, name: "Voice search optimised pages (conversational keywords + FAQ schema)", severity: "medium" },
    { categoryId: catMap["seo-organic"]!, name: "Entity-based SEO: Google Knowledge Panel claimed", severity: "medium" },
    { categoryId: catMap["seo-organic"]!, name: "XML sitemap submitted to Google", severity: "low" },
    { categoryId: catMap["seo-organic"]!, name: "Robots.txt file correctly configured", severity: "low" },

    // Google My Business (GMB) — 10 signals
    { categoryId: catMap["gmb"]!, name: "Google Business Profile claimed and verified (publicly confirmed)", severity: "critical" },
    { categoryId: catMap["gmb"]!, name: "Google reviews: 4+ stars with 10+ reviews visible publicly", severity: "critical" },
    { categoryId: catMap["gmb"]!, name: "GMB photos present and profile looks active (publicly visible)", severity: "high" },
    { categoryId: catMap["gmb"]!, name: "GMB posts or updates published recently (requires manual check)", severity: "high" },
    { categoryId: catMap["gmb"]!, name: "Business category and attributes fully complete (requires manual check)", severity: "high" },
    { categoryId: catMap["gmb"]!, name: "Products/services listed with descriptions and prices (requires manual check)", severity: "high" },
    { categoryId: catMap["gmb"]!, name: "Business description optimised with service keywords", severity: "medium" },
    { categoryId: catMap["gmb"]!, name: "GMB Q&A section actively managed (requires manual check)", severity: "medium" },
    { categoryId: catMap["gmb"]!, name: "Responding to reviews promptly (requires manual check)", severity: "medium" },
    { categoryId: catMap["gmb"]!, name: "GMB messaging/chat enabled (requires manual check)", severity: "low" },

    // Website & Conversion — 14 signals
    { categoryId: catMap["website-conversion"]!, name: "Professional website live and functional", severity: "critical" },
    { categoryId: catMap["website-conversion"]!, name: "Mobile-responsive design across all pages", severity: "critical" },
    { categoryId: catMap["website-conversion"]!, name: "Clear CTA (call-to-action) on every page", severity: "critical" },
    { categoryId: catMap["website-conversion"]!, name: "Lead capture form above the fold", severity: "high" },
    { categoryId: catMap["website-conversion"]!, name: "SSL certificate active (HTTPS)", severity: "high" },
    { categoryId: catMap["website-conversion"]!, name: "Website load speed under 3 seconds", severity: "high" },
    { categoryId: catMap["website-conversion"]!, name: "Pricing page or service packages visible", severity: "high" },
    { categoryId: catMap["website-conversion"]!, name: "About page with team and credibility signals", severity: "high" },
    { categoryId: catMap["website-conversion"]!, name: "Case studies or portfolio with results", severity: "high" },
    { categoryId: catMap["website-conversion"]!, name: "Free consultation or discovery call booking", severity: "medium" },
    { categoryId: catMap["website-conversion"]!, name: "Exit-intent popup or lead magnet offer", severity: "medium" },
    { categoryId: catMap["website-conversion"]!, name: "FAQ section addressing buyer objections", severity: "medium" },
    { categoryId: catMap["website-conversion"]!, name: "Live chat or chatbot enabled", severity: "low" },
    { categoryId: catMap["website-conversion"]!, name: "404 page and broken links audited", severity: "low" },

    // Online Reputation & Reviews — 8 signals
    { categoryId: catMap["online-reputation"]!, name: "Testimonials or case studies on website", severity: "critical" },
    { categoryId: catMap["online-reputation"]!, name: "Clear value proposition above the fold", severity: "critical" },
    { categoryId: catMap["online-reputation"]!, name: "Portfolio or work samples publicly visible", severity: "high" },
    { categoryId: catMap["online-reputation"]!, name: "Client logos displayed (social proof wall)", severity: "high" },
    { categoryId: catMap["online-reputation"]!, name: "Awards or industry certifications listed", severity: "high" },
    { categoryId: catMap["online-reputation"]!, name: "Media mentions or press coverage", severity: "medium" },
    { categoryId: catMap["online-reputation"]!, name: "Negative reviews addressed publicly and professionally", severity: "medium" },
    { categoryId: catMap["online-reputation"]!, name: "Privacy policy and terms of service present", severity: "low" },

    // Social Media & Content — 8 signals
    { categoryId: catMap["social-media"]!, name: "Instagram account active (post within 7 days)", severity: "critical" },
    { categoryId: catMap["social-media"]!, name: "LinkedIn company page active and complete", severity: "critical" },
    { categoryId: catMap["social-media"]!, name: "Video content on website or social channels", severity: "high" },
    { categoryId: catMap["social-media"]!, name: "Content published at least weekly", severity: "high" },
    { categoryId: catMap["social-media"]!, name: "Facebook business page active", severity: "medium" },
    { categoryId: catMap["social-media"]!, name: "Email newsletter with regular cadence", severity: "medium" },
    { categoryId: catMap["social-media"]!, name: "Engagement rate > 2% on primary social channel", severity: "medium" },
    { categoryId: catMap["social-media"]!, name: "Downloadable lead magnet (guide/whitepaper)", severity: "low" },

    // Paid Ads & Retargeting — 10 signals
    { categoryId: catMap["paid-ads"]!, name: "Meta (Facebook/Instagram) Ads account active", severity: "critical" },
    { categoryId: catMap["paid-ads"]!, name: "Google Ads campaign live with conversion tracking", severity: "critical" },
    { categoryId: catMap["paid-ads"]!, name: "Meta Pixel installed on website", severity: "high" },
    { categoryId: catMap["paid-ads"]!, name: "Retargeting campaigns running (warm audiences)", severity: "high" },
    { categoryId: catMap["paid-ads"]!, name: "Lookalike audience campaigns configured", severity: "high" },
    { categoryId: catMap["paid-ads"]!, name: "Google Ads ROAS tracked and >2x", severity: "high" },
    { categoryId: catMap["paid-ads"]!, name: "Ad copy A/B testing in progress", severity: "medium" },
    { categoryId: catMap["paid-ads"]!, name: "Ad creative refreshed within 30 days", severity: "medium" },
    { categoryId: catMap["paid-ads"]!, name: "Monthly ad spend > AED 3,000", severity: "medium" },
    { categoryId: catMap["paid-ads"]!, name: "Landing pages dedicated per ad campaign", severity: "low" },

    // Traffic & Keyword Analytics — 10 signals
    { categoryId: catMap["traffic-keywords"]!, name: "Google Analytics 4 (GA4) installed on website", severity: "critical" },
    { categoryId: catMap["traffic-keywords"]!, name: "Conversion goals or events configured in GA4 (requires manual check)", severity: "critical" },
    { categoryId: catMap["traffic-keywords"]!, name: "Website has indexable content and likely ranks for brand name", severity: "high" },
    { categoryId: catMap["traffic-keywords"]!, name: "Top service keywords tracked with an SEO tool (requires manual check)", severity: "high" },
    { categoryId: catMap["traffic-keywords"]!, name: "Organic traffic performance (requires Google Search Console access)", severity: "high" },
    { categoryId: catMap["traffic-keywords"]!, name: "Core page load performance acceptable (under 3 seconds)", severity: "high" },
    { categoryId: catMap["traffic-keywords"]!, name: "Competitor keyword landscape monitored (requires manual check)", severity: "medium" },
    { categoryId: catMap["traffic-keywords"]!, name: "Heatmap or session recording tool active (Hotjar / MS Clarity)", severity: "medium" },
    { categoryId: catMap["traffic-keywords"]!, name: "UTM tracking parameters used on campaign links", severity: "medium" },
    { categoryId: catMap["traffic-keywords"]!, name: "Monthly analytics performance report reviewed regularly (requires manual check)", severity: "low" },

    // AI & Automation Readiness — 7 signals
    { categoryId: catMap["ai-automation"]!, name: "CRM or lead tracking system in active use", severity: "critical" },
    { categoryId: catMap["ai-automation"]!, name: "Email marketing automation or sequences active", severity: "critical" },
    { categoryId: catMap["ai-automation"]!, name: "AI chatbot or FAQ bot deployed on website", severity: "high" },
    { categoryId: catMap["ai-automation"]!, name: "Social media scheduling tool in regular use", severity: "high" },
    { categoryId: catMap["ai-automation"]!, name: "AI tools used in content creation workflow", severity: "medium" },
    { categoryId: catMap["ai-automation"]!, name: "Automated review/testimonial collection system", severity: "medium" },
    { categoryId: catMap["ai-automation"]!, name: "Lead scoring or qualification automation active", severity: "low" },
  ];

  const insertedSignals = await db.insert(auditSignals).values(signals).returning();
  console.log(`✅ Audit signals: ${insertedSignals.length} inserted`);

  // Canonical 7-step sequences (days 1,3,5,8,12,16,21) — delete and re-seed each time
  await db.delete(outreachSequences);

  const sequences = [
    {
      name: "Generic",
      industry: null,
      active: true,
      steps: [
        { day: 1,  channel: "linkedin",                                                              description: "LinkedIn connection request with personalised note referencing their brand or industry" },
        { day: 3,  channel: "email",    subject: "Quick question about {{company}}'s brand",        description: "First touch email — identify pain point and offer value proposition" },
        { day: 5,  channel: "email",    subject: "Free brand audit for {{company}}",                description: "Offer free brand audit report as a low-friction entry point" },
        { day: 8,  channel: "whatsapp",                                                             description: "Short voice note or text following up on the audit offer" },
        { day: 12, channel: "email",    subject: "Case study relevant to {{company}}",             description: "Value-add email with relevant case study and clear CTA" },
        { day: 16, channel: "linkedin",                                                              description: "Comment on their recent post or share an insight relevant to their industry" },
        { day: 21, channel: "email",    subject: "Last touch — is now a good time, {{firstName}}?", description: "Break-up email with an open door — low pressure final CTA" },
      ],
    },
    {
      name: "Healthcare",
      industry: "Healthcare",
      active: true,
      steps: [
        { day: 1,  channel: "email",    subject: "Patient trust starts with your brand, {{firstName}}", description: "Open with patient trust and regulatory compliance angle" },
        { day: 3,  channel: "linkedin",                                                                   description: "Connect and comment on their latest healthcare content or news" },
        { day: 5,  channel: "email",    subject: "Healthcare brand audit for {{company}}",               description: "Offer specialised audit covering trust signals, compliance, and digital presence" },
        { day: 8,  channel: "whatsapp",                                                                   description: "Brief voice note referencing a healthcare industry trend or recent news" },
        { day: 12, channel: "email",    subject: "How we helped a UAE clinic increase bookings 40%",     description: "Social proof email with healthcare-specific ROI case study" },
        { day: 16, channel: "linkedin",                                                                   description: "Share a healthcare brand insight or comment on their clinic updates" },
        { day: 21, channel: "email",    subject: "Final note — patient-first brand for {{company}}",     description: "Compassionate break-up email with open door and referral ask" },
      ],
    },
    {
      name: "SaaS",
      industry: "Technology",
      active: true,
      steps: [
        { day: 1,  channel: "email",    subject: "Your product deserves a brand that converts, {{firstName}}", description: "Lead with conversion rates and competitive differentiation" },
        { day: 3,  channel: "linkedin",                                                                          description: "Connect and engage with their product launch or funding announcement" },
        { day: 5,  channel: "email",    subject: "Brand teardown: {{company}} vs competitors",                  description: "Send personalised competitive brand analysis as a hook" },
        { day: 8,  channel: "whatsapp",                                                                          description: "Quick voice note referencing their product demo or website" },
        { day: 12, channel: "email",    subject: "Series A brand playbook — {{company}}",                       description: "SaaS brand scaling framework with discovery call CTA" },
        { day: 16, channel: "linkedin",                                                                          description: "Engage with their latest product update or share a SaaS brand win" },
        { day: 21, channel: "email",    subject: "Last ask — is brand holding back {{company}}'s growth?",      description: "Final break-up email with bold subject line and no-commitment CTA" },
      ],
    },
  ];

  const insertedSequences = await db.insert(outreachSequences).values(sequences).returning();
  console.log(`✅ Outreach sequences: ${insertedSequences.length} inserted (7-step canonical day map 1/3/5/8/12/16/21)`);

  // Delete and re-seed exactly 3 canonical ICPs
  await db.delete(icps);

  const icpData = [
    {
      name: "Mid-Market UAE Retail",
      markets: ["UAE", "Saudi Arabia"],
      industries: ["Retail", "E-commerce", "Fashion"],
      roles: ["CEO", "CMO", "Marketing Director"],
      companySize: "50-500",
      filters: { minRevenue: 5000000, hasBrick: true },
      active: true,
    },
    {
      name: "Dubai Real Estate Developer",
      markets: ["UAE", "Qatar", "Kuwait"],
      industries: ["Real Estate", "Property Development", "Construction"],
      roles: ["Managing Director", "CEO", "Sales Director"],
      companySize: "20-200",
      filters: { projectType: "luxury", minProjects: 2 },
      active: true,
    },
    {
      name: "GCC F&B Chain",
      markets: ["UAE", "Saudi Arabia", "Bahrain", "Kuwait"],
      industries: ["Food & Beverage", "Hospitality", "Restaurant"],
      roles: ["Owner", "CEO", "Brand Manager"],
      companySize: "10-300",
      filters: { outlets: 2, hasFranchise: false },
      active: true,
    },
  ];

  const insertedIcps = await db.insert(icps).values(icpData).returning();
  console.log(`✅ ICPs: ${insertedIcps.length} inserted`);

  const sampleLeads = [
    {
      firstName: "Rania",
      lastName: "Al Masri",
      email: "rania@eliteretail.ae",
      company: "Elite Retail Group",
      designation: "CEO",
      industry: "Retail",
      country: "UAE",
      companySize: "200-500",
      website: "https://eliteretail.ae",
      source: "linkedin",
      status: "enquiry_qualified",
      bantScore: 78,
      bantBreakdown: { budget: 20, authority: 22, need: 18, timeline: 18 },
      tags: ["hot-lead", "decision-maker"],
      notes: "Interested in full brand refresh. Has allocated budget for Q2.",
      sequenceDay: 5,
    },
    {
      firstName: "Khalid",
      lastName: "Al Rashid",
      email: "khalid@alrashiddev.com",
      company: "Al Rashid Developments",
      designation: "Managing Director",
      industry: "Real Estate",
      country: "UAE",
      companySize: "50-200",
      website: "https://alrashiddev.com",
      source: "referral",
      status: "new_enquiry",
      tags: ["real-estate", "dubai"],
      notes: "Referred by Ahmed Hassan. Launching new luxury project in Q3.",
      sequenceDay: 1,
    },
    {
      firstName: "Sara",
      lastName: "Noor",
      email: "sara@tastebeirut.com",
      company: "Taste of Beirut Restaurant Group",
      designation: "Owner",
      industry: "Food & Beverage",
      country: "UAE",
      companySize: "50-150",
      website: "https://tastebeirut.com",
      source: "instagram",
      status: "follow_up",
      bantScore: 52,
      bantBreakdown: { budget: 12, authority: 22, need: 10, timeline: 8 },
      tags: ["f&b", "franchise-potential"],
      notes: "Currently working with a freelancer. Open to professional agency if ROI is demonstrated.",
      sequenceDay: 8,
    },
    {
      firstName: "Omar",
      lastName: "Shaikh",
      email: "omar@techvision.io",
      company: "TechVision MENA",
      designation: "Co-founder & CEO",
      industry: "Technology",
      country: "UAE",
      companySize: "20-80",
      website: "https://techvision.io",
      source: "cold-email",
      status: "discovery_call",
      bantScore: 89,
      bantBreakdown: { budget: 23, authority: 25, need: 22, timeline: 19 },
      tags: ["saas", "high-value", "urgent"],
      notes: "Seed stage, just raised $2M. Needs complete brand identity before Series A. HOT.",
      sequenceDay: 3,
    },
    {
      firstName: "Fatima",
      lastName: "Al Zaabi",
      email: "fatima@zaabiconsulting.ae",
      company: "Al Zaabi Management Consulting",
      designation: "Managing Partner",
      industry: "Consulting",
      country: "UAE",
      companySize: "10-50",
      website: "https://zaabiconsulting.ae",
      source: "linkedin",
      status: "quote_sent",
      bantScore: 71,
      bantBreakdown: { budget: 17, authority: 22, need: 18, timeline: 14 },
      tags: ["consulting", "professional-services"],
      notes: "Proposal sent for brand identity + website. Decision expected within 2 weeks.",
      sequenceDay: 12,
    },
  ];

  // Insert exactly 5 seed leads without deleting existing user data
  const insertedLeads = await db
    .insert(leads)
    .values(sampleLeads)
    .onConflictDoNothing()
    .returning();

  console.log(`✅ Sample leads: ${insertedLeads.length} inserted (${sampleLeads.length} seed leads defined)`);
  console.log("🎉 Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
