# LangGraph Deployment & Runtime (Angular)

This capability demonstrates production deployment patterns for LangGraph agents — including environment-specific base URLs, authentication headers, and assistant resolution — using the `@threadplane/angular/chat` Angular component library. The `<chat>` component is configured through Angular's dependency injection system, making it straightforward to swap between local development, staging, and production LangGraph Cloud deployments.

Key components used: `<chat>`. Configuration is provided via an Angular environment token injected into `agent`, keeping all deployment concerns out of the component template and enabling zero-code environment switches at build time.
