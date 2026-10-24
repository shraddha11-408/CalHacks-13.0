from pathlib import Path

import pytest

from stepwise_edge.voice import Voice, VoiceRegistry, speech_clip

ROOT = Path(__file__).resolve().parents[2]


def test_cache_key_is_per_voice_and_stock_keys_are_unchanged(tmp_path):
    v = Voice(tmp_path)
    assert v.key("Great job!") == Voice.key("Great job!", None)  # existing stock-voice clips stay valid
    assert v.key("Great job!", "clone-1") != v.key("Great job!")
    assert v.url("Hi", "clone-1").startswith("/files/audio/") and v.path("Hi", "clone-1").parent == tmp_path


def test_registry_only_knows_consented_voices(tmp_path):
    r = VoiceRegistry(tmp_path / "voices.json")
    assert r.get("x") is None and r.get(None) is None
    r.add("x", {"consent_by": "Ana", "consent_at": 1.0})
    assert r.get("x")["consent_by"] == "Ana"


@pytest.mark.skipif(not (ROOT / "videos/supervisor.mp4").exists(), reason="demo video not present")
def test_speech_clip_from_demo_video():
    wav, secs = speech_clip(ROOT / "videos/supervisor.mp4", [{"start": 0.5, "end": 1.0}, {"start": 20.0, "end": 25.0}])
    assert wav[:4] == b"RIFF" and 20 < secs < 27
