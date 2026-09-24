import type { PricingInput, ProposalContentInput } from "@bridger/shared";

/**
 * Starter templates seeded for the owner (SPEC §15 Q4).
 * PLACEHOLDER copy and pricing — John to supply the real packages.
 * Edit here, then run `pnpm gen:seed` to regenerate supabase/seed/02_starter_templates.sql.
 */

export interface StarterTemplate {
  name: string;
  description: string;
  category: string;
  content: ProposalContentInput;
  pricing: PricingInput;
}

const PLACEHOLDER_NOTE = "_Placeholder pricing: replace with Bridger's current rates._";

const closing = (prefix: string): ProposalContentInput["blocks"] => [
  { id: `${prefix}Terms01`, type: "terms", props: { title: "Terms & Conditions", markdown: "{{default_terms}}" } },
  {
    id: `${prefix}Cta0001`,
    type: "cta",
    props: { heading: "Ready to get started?", body: "Sign below and we'll get your kickoff on the calendar this week.", buttonLabel: "Accept proposal" },
  },
  {
    id: `${prefix}Sign001`,
    type: "signature",
    props: { intro: "By signing, you accept this proposal, the selected options, and the terms above.", showOwnerSignature: true },
  },
];

const cover = (prefix: string, title: string, subtitle: string): ProposalContentInput["blocks"][number] => ({
  id: `${prefix}Cover01`,
  type: "cover",
  props: { title, subtitle, clientName: "{{client_name}}", preparedBy: "John, Bridger Digital", date: "" },
});

export const starterTemplates: StarterTemplate[] = [
  {
    name: "Content War Chest",
    description: "Two shoot days turned into a year of short- and long-form content. [placeholder copy & pricing]",
    category: "Content",
    content: {
      schemaVersion: 1,
      blocks: [
        cover("cwc", "Content War Chest", "A year of content from two days of filming"),
        {
          id: "cwcIntro01",
          type: "text",
          props: {
            markdown:
              "Most businesses know they should be posting video. Few have the time to film every week.\n\n" +
              "The **Content War Chest** fixes that: we film everything in two focused days, then edit it into a steady stream of content you can post all year.",
          },
        },
        {
          id: "cwcDeliv01",
          type: "deliverables",
          props: {
            title: "What you get",
            items: [
              { title: "52 short-form videos", description: "Vertical, captioned, and ready for Reels, TikTok, and Shorts.", icon: "video" },
              { title: "12 long-form edits", description: "One flagship video a month for YouTube and your website.", icon: "film" },
              { title: "Photo library", description: "Stills pulled from both shoot days.", icon: "camera" },
              { title: "Posting calendar", description: "A 12-month plan so nothing sits on a hard drive.", icon: "calendar" },
            ],
          },
        },
        {
          id: "cwcTimel01",
          type: "timeline",
          props: {
            phases: [
              { title: "Discovery & shot list", duration: "1–2 weeks", description: "Interviews, story mining, and a shot list built around your offers." },
              { title: "Shoot days", duration: "2 days", description: "On-site filming with a two-person crew." },
              { title: "Edit & deliver", duration: "4–6 weeks", description: "First batch in four weeks; the full library by week six." },
            ],
          },
        },
        { id: "cwcPrHead1", type: "heading", props: { text: "Investment", level: 2 } },
        { id: "cwcPrice01", type: "pricing", props: { pricingSectionIds: ["sec_cwc_package", "sec_cwc_addons"], showTotals: true } },
        ...closing("cwc"),
      ],
    },
    pricing: {
      currency: "USD",
      sections: [
        {
          id: "sec_cwc_package",
          title: "Package",
          mode: "choose_one",
          items: [
            { id: "item_cwc_1day", name: "Half Chest: 1 shoot day", description: "26 short-form, 6 long-form", quantity: 1, unitPriceCents: 450_000, billing: "one_time", selectedByDefault: false },
            { id: "item_cwc_2day", name: "Full Chest: 2 shoot days", description: "52 short-form, 12 long-form", quantity: 1, unitPriceCents: 800_000, billing: "one_time", selectedByDefault: true },
          ],
          discounts: [],
        },
        {
          id: "sec_cwc_addons",
          title: "Add-ons",
          mode: "optional",
          items: [
            { id: "item_cwc_drone", name: "Drone footage", quantity: 1, unitPriceCents: 75_000, billing: "one_time", selectedByDefault: false },
            { id: "item_cwc_posting", name: "Posting management", description: "We schedule and post for you.", quantity: 1, unitPriceCents: 125_000, unitLabel: "month", billing: "monthly", selectedByDefault: false },
          ],
          discounts: [],
        },
      ],
      discounts: [],
      notes: PLACEHOLDER_NOTE,
    },
  },
  {
    name: "Authority Engine",
    description: "Monthly content retainer that positions the client as the go-to expert. [placeholder copy & pricing]",
    category: "Retainer",
    content: {
      schemaVersion: 1,
      blocks: [
        cover("ae", "Authority Engine", "Become the obvious choice in your market"),
        {
          id: "aeIntro001",
          type: "text",
          props: {
            markdown:
              "People hire the expert they already trust. The **Authority Engine** is a monthly retainer that puts your expertise in front of the right people, every week.",
          },
        },
        {
          id: "aeDeliv001",
          type: "deliverables",
          props: {
            title: "Every month",
            items: [
              { title: "Monthly filming session", description: "Half a day on site or in studio.", icon: "video" },
              { title: "8 short-form videos", description: "Edited, captioned, and scheduled.", icon: "sparkles" },
              { title: "1 long-form episode", description: "Podcast or YouTube format.", icon: "mic" },
              { title: "Performance report", description: "What worked, what didn't, what's next.", icon: "chart" },
            ],
          },
        },
        { id: "aePrHead01", type: "heading", props: { text: "Investment", level: 2 } },
        { id: "aePrice001", type: "pricing", props: { pricingSectionIds: ["sec_ae_setup", "sec_ae_tier"], showTotals: true } },
        ...closing("ae"),
      ],
    },
    pricing: {
      currency: "USD",
      sections: [
        {
          id: "sec_ae_setup",
          title: "Onboarding",
          mode: "fixed",
          items: [{ id: "item_ae_setup", name: "Strategy & brand setup", quantity: 1, unitPriceCents: 150_000, billing: "one_time", selectedByDefault: true }],
          discounts: [],
        },
        {
          id: "sec_ae_tier",
          title: "Monthly retainer",
          mode: "choose_one",
          items: [
            { id: "item_ae_good", name: "Starter", description: "4 short-form videos a month", quantity: 1, unitPriceCents: 200_000, unitLabel: "month", billing: "monthly", selectedByDefault: false },
            { id: "item_ae_better", name: "Growth", description: "8 short-form + 1 long-form a month", quantity: 1, unitPriceCents: 350_000, unitLabel: "month", billing: "monthly", selectedByDefault: true },
            { id: "item_ae_best", name: "Dominate", description: "16 short-form + 2 long-form a month", quantity: 1, unitPriceCents: 600_000, unitLabel: "month", billing: "monthly", selectedByDefault: false },
          ],
          discounts: [],
        },
      ],
      discounts: [],
      notes: PLACEHOLDER_NOTE,
    },
  },
  {
    name: "Website Build",
    description: "Design and build of a marketing website. [placeholder copy & pricing]",
    category: "Web",
    content: {
      schemaVersion: 1,
      blocks: [
        cover("web", "Website Build", "A site that works as hard as you do"),
        { id: "webIntro01", type: "text", props: { markdown: "Your website is your best salesperson. We'll design and build a fast, clear site that turns visitors into calls." } },
        {
          id: "webTimel01",
          type: "timeline",
          props: {
            phases: [
              { title: "Discovery & sitemap", duration: "1 week", description: "Goals, audience, and page structure." },
              { title: "Design", duration: "2 weeks", description: "Homepage and key page designs, two revision rounds." },
              { title: "Build & launch", duration: "3 weeks", description: "Development, content load, QA, and launch." },
            ],
          },
        },
        { id: "webPrHead1", type: "heading", props: { text: "Investment", level: 2 } },
        { id: "webPrice01", type: "pricing", props: { pricingSectionIds: ["sec_web_build", "sec_web_addons"], showTotals: true } },
        ...closing("web"),
      ],
    },
    pricing: {
      currency: "USD",
      sections: [
        {
          id: "sec_web_build",
          title: "Website",
          mode: "fixed",
          items: [
            { id: "item_web_design", name: "Design", quantity: 1, unitPriceCents: 400_000, billing: "one_time", selectedByDefault: true },
            { id: "item_web_dev", name: "Development (up to 8 pages)", quantity: 1, unitPriceCents: 600_000, billing: "one_time", selectedByDefault: true },
          ],
          discounts: [],
        },
        {
          id: "sec_web_addons",
          title: "Add-ons",
          mode: "optional",
          items: [
            { id: "item_web_copy", name: "Copywriting", quantity: 8, unitPriceCents: 25_000, unitLabel: "page", billing: "one_time", selectedByDefault: false },
            { id: "item_web_care", name: "Hosting & care plan", quantity: 1, unitPriceCents: 15_000, unitLabel: "month", billing: "monthly", selectedByDefault: true },
          ],
          discounts: [],
        },
      ],
      discounts: [],
      notes: PLACEHOLDER_NOTE,
    },
  },
  {
    name: "Video Production",
    description: "A single commercial or brand video, from concept to final cut. [placeholder copy & pricing]",
    category: "Video",
    content: {
      schemaVersion: 1,
      blocks: [
        cover("vid", "Video Production", "Your story, told well"),
        { id: "vidIntro01", type: "text", props: { markdown: "One great video can carry your brand for years. We handle everything from concept to final cut." } },
        {
          id: "vidDeliv01",
          type: "deliverables",
          props: {
            title: "Deliverables",
            items: [
              { title: "Hero video (60–90 s)", description: "Scripted, shot, and edited.", icon: "film" },
              { title: "Cutdowns", description: "15 s and 30 s versions for ads and social.", icon: "scissors" },
            ],
          },
        },
        { id: "vidPrHead1", type: "heading", props: { text: "Investment", level: 2 } },
        { id: "vidPrice01", type: "pricing", props: { pricingSectionIds: ["sec_vid_prod", "sec_vid_addons"], showTotals: true } },
        ...closing("vid"),
      ],
    },
    pricing: {
      currency: "USD",
      sections: [
        {
          id: "sec_vid_prod",
          title: "Production",
          mode: "fixed",
          items: [
            { id: "item_vid_pre", name: "Pre-production & scripting", quantity: 1, unitPriceCents: 150_000, billing: "one_time", selectedByDefault: true },
            { id: "item_vid_shoot", name: "Shoot day", quantity: 1, unitPriceCents: 350_000, unitLabel: "day", billing: "one_time", selectedByDefault: true },
            { id: "item_vid_edit", name: "Editing & color", quantity: 20, unitPriceCents: 12_500, unitLabel: "hr", billing: "one_time", selectedByDefault: true },
          ],
          discounts: [],
        },
        {
          id: "sec_vid_addons",
          title: "Add-ons",
          mode: "optional",
          items: [
            { id: "item_vid_drone", name: "Drone footage", quantity: 1, unitPriceCents: 75_000, billing: "one_time", selectedByDefault: false },
            { id: "item_vid_music", name: "Licensed music", quantity: 1, unitPriceCents: 20_000, billing: "one_time", selectedByDefault: true },
          ],
          discounts: [],
        },
      ],
      discounts: [],
      notes: PLACEHOLDER_NOTE,
    },
  },
];
