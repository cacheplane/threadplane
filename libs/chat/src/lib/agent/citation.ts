/**
 * Provider-agnostic citation entry. Populated by adapters from message
 * metadata (LangGraph additional_kwargs.citations, AG-UI STATE_DELTA at
 * `/citations/{messageId}`). Pandoc-formatted `[^id]: ...` defs in message
 * content remain in the markdown AST sidecar and are merged via
 * CitationsResolverService at render time.
 */
export interface Citation {
  /** Stable id used to match `[^id]` markers in Pandoc-formatted content. */
  id: string;
  /** 1-based display order. Stable per-message. */
  index: number;
  title?: string;
  url?: string;
  snippet?: string;
  /** Provider-specific extras (retrieval score, source type, etc.). */
  extra?: Record<string, unknown>;

  /**
   * Source classification driving the type badge. Free-form and extensible:
   * 'web' (default-inferred from an http(s) url) | 'file' | 'app' | 'memory'
   * | any custom string. Optional — display derives 'web' from the url when absent.
   */
  sourceType?: string;
  /**
   * Provider-supplied favicon/logo (absolute URL or `data:` URI). NEVER
   * auto-fetched by the library — supply this from your own resolver if you
   * want real favicons; otherwise a monogram is rendered.
   */
  iconUrl?: string;
  /** Freshness signal shown in the preview-card footer. */
  publishedAt?: string | number | Date;
}
