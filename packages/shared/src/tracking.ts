import { z } from "zod";
import { DocIdSchema } from "./schemas/common.js";

/** Tracker payloads (SPEC §11.1). Validated by the Worker before anything is stored. */

export const DeviceSchema = z.enum(["desktop", "tablet", "mobile"]);
export type Device = z.infer<typeof DeviceSchema>;

export const TrackSessionSchema = z.object({
  slug: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
  version: z.number().int().min(1),
  /** Random ID in a first-party cookie/localStorage; identifies repeat visits, not people. */
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  device: DeviceSchema,
  viewportW: z.number().int().min(0).max(20_000),
  viewportH: z.number().int().min(0).max(20_000),
  referrer: z.string().max(2_000).optional(),
  /** The viewer's own browser has an admin session: never counts. */
  ownerHint: z.boolean().default(false),
});
export type TrackSession = z.input<typeof TrackSessionSchema>;

export const TrackEventsSchema = z.object({
  sessionId: z.uuid(),
  blockStats: z.array(z.object({ blockId: DocIdSchema, visibleMsDelta: z.number().int().min(0).max(600_000), entered: z.boolean() })).max(300),
  points: z.array(z.object({ blockId: DocIdSchema, kind: z.enum(["click", "tap", "move"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(1_000),
  pricing: z.array(z.object({ sectionId: DocIdSchema, itemId: DocIdSchema, action: z.enum(["selected", "deselected"]) })).max(200),
  activeMsDelta: z.number().int().min(0).max(600_000),
  maxScrollPct: z.number().int().min(0).max(100),
});
export type TrackEvents = z.infer<typeof TrackEventsSchema>;

/** Largest accepted tracker request body (SPEC §11.2). */
export const MAX_TRACK_BYTES = 64 * 1024;

/**
 * Known bots, crawlers, link previewers, and email security scanners (Gmail, Outlook,
 * Slack and friends open links to preview or scan them). Plus headless markers.
 */
export const BOT_UA_RE =
  /bot\b|crawl|spider|slurp|preview|scanner|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|python-requests|python-urllib|curl\/|wget\/|go-http-client|java\/|okhttp|axios\/|node-fetch|facebookexternalhit|facebookcatalog|slackbot|slack-imgproxy|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|skypeuripreview|microsoft office|ms-office|outlook|mimecast|proofpoint|barracuda|symantec|forcepoint|trendmicro|google-inspectiontool|googleother|bingpreview|yahoo! slurp|embedly|quora link preview|pinterest|redditbot|applebot|iframely|vkshare|nuzzel|w3c_validator/i;

export const isBotUserAgent = (ua: string | undefined | null) => !ua || BOT_UA_RE.test(ua);
