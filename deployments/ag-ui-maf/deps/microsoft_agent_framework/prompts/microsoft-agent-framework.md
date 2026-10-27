# Prompt: expense approval copilot on Microsoft Agent Framework

Build an agent-framework agent exposed over AG-UI:

- Define tools with `@tool`; mark `submit_expense` with
  `approval_mode="always_require"` so the run pauses for a human decision
  (the AG-UI bridge signals it as a protocol-standard `RUN_FINISHED`
  interrupt outcome).
- Add a plain backend tool (`lookup_expense_policy`) that executes
  server-side without pausing.
- Wrap the agent in `AgentFrameworkAgent` with a `state_schema` and
  `predict_state_config` so the `expense` tool argument streams into shared
  frontend state while the model is still generating it.
- Default the model client to Azure OpenAI (`AZURE_OPENAI_ENDPOINT` +
  `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_MODEL`), falling back to the plain
  OpenAI client on `OPENAI_API_KEY`.
- Mount with `add_agent_framework_fastapi_endpoint(app, agent, path="/agent")`.
