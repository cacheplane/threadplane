import pytest
from src.graph import _reasoning_param


@pytest.mark.smoke
def test_effort_omitted_when_client_did_not_choose_one():
    # No effort from the client → the model's own default applies.
    assert _reasoning_param("gpt-5-mini", None) == {"summary": "auto"}
    assert _reasoning_param("gpt-5-mini", "") == {"summary": "auto"}


@pytest.mark.smoke
def test_explicit_effort_is_forwarded():
    assert _reasoning_param("gpt-5", "high") == {"effort": "high", "summary": "auto"}
    assert _reasoning_param("gpt-5-nano", "minimal") == {"effort": "minimal", "summary": "auto"}


@pytest.mark.smoke
@pytest.mark.parametrize("model", ["gpt-5", "gpt-5-mini", "gpt-6", "gpt-6-mini", "o1", "o3-mini", "o4-mini"])
def test_reasoning_models_get_the_parameter(model):
    assert _reasoning_param(model, None) == {"summary": "auto"}


@pytest.mark.smoke
@pytest.mark.parametrize("model", ["gpt-4o", "gpt-4.1-mini"])
def test_non_reasoning_models_get_no_parameter(model):
    assert _reasoning_param(model, "high") is None
