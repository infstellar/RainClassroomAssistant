import pytest

from Scripts import Utils


def test_dict_result_rejects_non_object_json_with_clear_error():
    with pytest.raises(ValueError, match="Expected JSON object"):
        Utils.dict_result('["login expired"]')


def test_dict_result_rejects_invalid_json_with_context():
    with pytest.raises(ValueError, match="Invalid JSON response"):
        Utils.dict_result("<html>login expired</html>")


def test_show_info_uses_resource_path_for_toast_icon(monkeypatch):
    captured = {}

    class FakeToaster:
        def show_toast(self, title, text, icon_path=None, **kwargs):
            captured["title"] = title
            captured["text"] = text
            captured["icon_path"] = icon_path

    monkeypatch.setattr(Utils, "TOAST_AVAILABLE", True)
    monkeypatch.setattr(Utils, "toaster", FakeToaster())
    monkeypatch.setattr(Utils, "resource_path", lambda path: f"resolved/{path}")

    Utils.show_info("body", "title")

    assert captured["icon_path"] == "resolved/UI\\Image\\favicon.ico"
