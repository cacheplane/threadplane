import type { StageBeat, StageMilestone } from '../stage-beats';

export const analyticsEvents = {
  marketingCtaClick: 'marketing:cta_click',
  marketingExternalLinkClick: 'marketing:external_link_click',
  marketingWhitepaperDownloadClick: 'marketing:whitepaper_download_click',
  marketingWhitepaperSignupSubmit: 'marketing:whitepaper_signup_submit',
  marketingWhitepaperSignupSuccess: 'marketing:whitepaper_signup_success',
  marketingWhitepaperSignupFail: 'marketing:whitepaper_signup_fail',
  marketingLeadFormSubmit: 'marketing:lead_form_submit',
  marketingLeadFormSuccess: 'marketing:lead_form_success',
  marketingLeadFormFail: 'marketing:lead_form_fail',
  marketingLeadQualified: 'marketing:lead_qualified',
  marketingNewsletterSignupSubmit: 'marketing:newsletter_signup_submit',
  marketingNewsletterSignupSuccess: 'marketing:newsletter_signup_success',
  marketingNewsletterSignupFail: 'marketing:newsletter_signup_fail',
  docsSearchSubmit: 'docs:search_submit',
  docsSearchResultClick: 'docs:search_result_click',
  docsCopyPromptClick: 'docs:copy_prompt_click',
  docsCopyCodeClick: 'docs:copy_code_click',
  docsTabSelect: 'docs:tab_select',
  docsSidebarSectionToggle: 'docs:sidebar_section_toggle',
  docsWorkspaceNavigation: 'docs:workspace_navigation',
  docsWorkspaceModeSwitched: 'docs:workspace_mode_switched',
  docsWorkspaceRuntimeAction: 'docs:workspace_runtime_action',
  docsWorkspaceRuntimeStatusChanged: 'docs:workspace_runtime_status_changed',
  blogCtaClick: 'blog:cta_click',
  blogCopyCodeClick: 'blog:copy_code_click',
  marketingAiCrawlerVisit: 'marketing:ai_crawler_visit',
  marketingAiReferralVisit: 'marketing:ai_referral_visit',
  marketingStageProgress: 'marketing:stage_progress',
  marketingEngagedTime: 'marketing:engaged_time',
} as const;

export type AnalyticsEventName = (typeof analyticsEvents)[keyof typeof analyticsEvents];

export type AnalyticsSurface =
  | 'nav'
  | 'mobile_nav'
  | 'footer'
  | 'home'
  | 'home_demo'
  | 'home_whitepaper'
  | 'home_medium_switcher'
  | 'home_stage'
  | 'pricing'
  | 'docs'
  | 'blog'
  | 'library_landing'
  | 'solution'
  | 'toast'
  | 'contact'
  | 'final_cta';

/**
 * Stable identifiers for marketing CTAs. New CTAs must be added to this
 * union so PostHog gets consistent slicing — misspellings then become
 * a build-time error.
 *
 * Template-literal members (e.g. `nav_${string}`) cover callsites that
 * derive cta_id dynamically from a human label.
 */
export type CtaId =
  // Hero (spec 2026-09-02 homepage rebuild)
  | 'hero_install'
  | 'hero_install_open'
  | 'hero_quickstart'
  | 'hero_live_demo'
  | 'hero_github'
  | 'hero_demo_takeover'
  | 'hero_demo_replay'
  | 'hero_demo_play'
  | 'hero_demo_fallback_open'
  | 'hero_talk_to_engineers'
  // Homepage sections
  | 'home_runtime_parity_toggle'
  | 'home_adapter_guide'
  | 'home_coding_agent_prompt'
  | 'home_coding_agent_link'
  | 'home_no_runtime_docs'
  // retired 2026-09-02, remove after 90 days
  | 'hero_demo_open_workspace'
  | 'hero_demo_open_workspace_caption'
  | 'hero_proof_pill'
  // Whitepaper block on home
  | 'home_whitepaper_direct'
  // Why this exists section
  | 'home_why_pilot_to_prod'
  // Pricing tier CTAs
  | 'pricing_tier_community'
  | 'pricing_tier_production_assurance'
  | 'pricing_tier_enterprise'
  | 'pricing_enterprise_band'
  // Footer product links
  | 'footer_pilot_to_prod'
  | 'footer_ag_ui'
  // Announcement toast
  | 'toast_get_guide'
  // Docs surfaces — copy buttons take a dynamic label fallback
  | 'copy_code'
  | 'copy_prompt'
  | `copy_${string}`
  // Nav + footer derive ids from labels at runtime
  | `nav_${string}`
  | `mobile_nav_${string}`
  | `footer_${string}`
  // Landing section CTAs derive ids from surface + demo key at runtime
  | `final_cta_${string}`
  | `home_demo_${string}`
  // MediumSwitcher derives ids from section id + medium key at runtime
  | `medium_${string}`;

export type AnalyticsLibrary =
  | 'langgraph'
  | 'render'
  | 'chat'
  | 'ag-ui'
  | 'deep-agents'
  | 'runtimes'
  | 'unknown';

export type WhitepaperId = 'overview' | 'angular' | 'render' | 'chat';

export type AnalyticsProperties = {
  source_page?: string;
  source_section?: string;
  destination_url?: string;
  cta_id?: CtaId;
  cta_text?: string;
  surface?: AnalyticsSurface;
  library?: AnalyticsLibrary;
  paper?: WhitepaperId;
  /** Install/parity variant. */
  adapter?: 'fake' | 'langgraph' | 'ag_ui';
  email_domain?: string;
  company?: string;
  is_success?: boolean;
  result_count?: number;
  query_length?: number;
  error_reason?: string;
  /** Which CTA carried the visitor to a form; e.g. `pricing_tier_enterprise`. */
  entry_point?: string;
  ai_crawler?: string;
  ai_source?: string;
  user_agent?: string;
  /**
   * Cumulative *visible* seconds on a page (`marketing:engaged_time`).
   * Hidden background time is excluded by construction — see
   * `analytics/engaged-time.ts`.
   */
  engaged_seconds?: number;
  /** Homepage stage milestones (`marketing:stage_progress`). */
  stage_event?: StageMilestone;
  beat?: StageBeat;
  [key: string]: string | number | boolean | undefined;
};
