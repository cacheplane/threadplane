"""Parity tests with libs/angular/chat/src/lib/a2ui/envelope-normalizer.spec.ts."""
import pytest

from src.streaming.envelope_normalizer import normalize_envelope_args


class TestNormalizeEnvelopeArgs:
    def test_canonical_envelopes_shape(self):
        args = {"envelopes": [{"version": "v0.9", "updateComponents": {"surfaceId": "s", "components": []}}]}
        assert normalize_envelope_args(args) == args["envelopes"]

    def test_singular_envelope_typo_shape(self):
        args = {"envelope": [{"version": "v0.9", "createSurface": {"surfaceId": "s", "catalogId": "c"}}]}
        assert normalize_envelope_args(args) == args["envelope"]

    def test_positional_keys_unflattened_in_numeric_order(self):
        e1 = {"version": "v0.9", "createSurface": {"surfaceId": "s", "catalogId": "c"}}
        e2 = {"version": "v0.9", "updateComponents": {"surfaceId": "s", "components": []}}
        args = {"1": e2, "0": e1}
        assert normalize_envelope_args(args) == [e1, e2]

    def test_flat_single_envelope_wrapped_in_list(self):
        args = {"updateComponents": {"surfaceId": "s", "components": []}}
        assert normalize_envelope_args(args) == [args]

    def test_flat_single_update_data_model_wrapped_in_list(self):
        args = {"updateDataModel": {"surfaceId": "s", "path": "/", "value": {}}}
        assert normalize_envelope_args(args) == [args]

    def test_empty_object_returns_none(self):
        assert normalize_envelope_args({}) is None

    def test_non_dict_input_returns_none(self):
        assert normalize_envelope_args(None) is None
        assert normalize_envelope_args("x") is None
