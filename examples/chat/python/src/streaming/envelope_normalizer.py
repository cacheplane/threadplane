"""Normalises the four envelope-args shapes the parent LLM may emit into
a canonical envelope list. Parity with libs/angular/chat/src/lib/a2ui/envelope-normalizer.ts.

The spike (examples/chat/python/spike/parent_envelope_quality.py) observed
these shapes across gpt-5-mini and gpt-5; strict-mode tool binding should
eliminate the non-canonical ones in production, but this normalizer is
the safety net.
"""
from __future__ import annotations

from typing import Any

_ENVELOPE_KEYS = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")


def normalize_envelope_args(args: Any) -> list[dict] | None:
    """Return a canonical envelope list, or None if `args` is unrecognised."""
    if not isinstance(args, dict) or not args:
        return None
    # (a) canonical {envelopes: [...]}
    envelopes = args.get("envelopes")
    if isinstance(envelopes, list):
        return envelopes
    # (b) singular {envelope: [...]} typo
    envelope = args.get("envelope")
    if isinstance(envelope, list):
        return envelope
    keys = list(args.keys())
    # (c) positional keys {"0": env, "1": env, ...}
    if keys and all(isinstance(k, str) and k.isdigit() for k in keys):
        return [args[k] for k in sorted(keys, key=int)]
    # (d) flat single envelope
    if any(k in args for k in _ENVELOPE_KEYS):
        return [args]
    return None
