import { blockRegistry, type BlockType } from "@bridger/shared";
import { case_study } from "./caseStudy";
import { columns } from "./columns";
import { cover } from "./cover";
import { cta } from "./cta";
import { deliverables } from "./deliverables";
import { faq } from "./faq";
import { image } from "./image";
import { divider, page_break } from "./layout";
import { pricing } from "./pricing";
import { heading, text } from "./prose";
import { signature } from "./signature";
import { team } from "./team";
import { terms } from "./terms";
import { testimonial } from "./testimonial";
import { timeline } from "./timeline";
import type { BlockUI, BlockUIRegistry, MenuGroup } from "./types";
import { video } from "./video";

/**
 * Web block registry. The `BlockUIRegistry` type requires an entry for every block
 * type in the shared registry, so adding a type there fails type-checking until its
 * UI exists here. To add an object:
 *   1. packages/shared: props schema (blocks/definitions.ts) + registry entry + BlockSchema union
 *   2. apps/web/src/blocks/<type>.tsx: a BlockUI (menu, Renderer, Editor)
 *   3. register it below. It then shows up in the "/" menu automatically.
 */
export const blockUI: BlockUIRegistry = {
  cover,
  heading,
  text,
  image,
  video,
  columns,
  deliverables,
  timeline,
  pricing,
  testimonial,
  case_study,
  team,
  faq,
  terms,
  cta,
  divider,
  page_break,
  signature,
};

export const getBlockUI = <T extends BlockType>(type: T) => blockUI[type] as BlockUI<T>;

export const blockLabel = (type: BlockType) => blockRegistry[type].label;

export const MENU_GROUP_ORDER: MenuGroup[] = ["Basics", "Sales", "Content", "Media", "Layout"];

/** Initial props + aux for a newly inserted object. */
export function createBlockValue<T extends BlockType>(type: T) {
  const ui = getBlockUI(type);
  if (ui.create) return ui.create();
  return { props: blockRegistry[type].defaultProps() as never, aux: null as never };
}
