import yaml

from stepwise_edge import config


def test_save_hsv_keeps_comments_and_other_keys(tmp_path, monkeypatch):
    src = config.CONFIG_PATH.read_text()
    p = tmp_path / "config.yaml"
    p.write_text(src)
    monkeypatch.setattr(config, "CONFIG_PATH", p)
    config.save_hsv("soap", [101, 110, 50], [129, 250, 250])
    config.save_hsv("towel", [0, 0, 200], [179, 30, 255])
    out = p.read_text()
    data = yaml.safe_load(out)
    assert data["hsv"]["soap"] == {"lo": [101, 110, 50], "hi": [129, 250, 250]}
    assert data["hsv"]["towel"]["hi"] == [179, 30, 255]
    assert data["hsv"]["shampoo"]  # untouched items survive
    assert data["thresholds"] == yaml.safe_load(src)["thresholds"]
    assert "# Stepwise edge config" in out  # comments elsewhere survive
