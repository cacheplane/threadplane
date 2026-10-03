from ag_ui_langgraph import LangGraphAgent


class NativeRefundAgent(LangGraphAgent):
    """Serve native decisions while the ordinary endpoint keeps its legacy contract."""

    def __init__(self, *, name, graph, description=None, config=None, **kwargs):
        kwargs['enable_legacy_on_interrupt_event'] = False
        kwargs['emit_interrupt_outcome'] = True
        super().__init__(
            name=name, graph=graph, description=description, config=config, **kwargs,
        )
