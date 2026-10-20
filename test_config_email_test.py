"""使用真实 Qt 控件验证设置页面；邮件发送和配置路径均隔离。"""

import json
import os
from copy import deepcopy
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest
from PyQt5 import QtWidgets

from Scripts.Utils import get_initial_data
from UI import Config


@pytest.fixture(scope="module")
def app():
    application = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    yield application


@pytest.fixture
def settings(app, monkeypatch, tmp_path):
    dialog = QtWidgets.QDialog()
    ui = Config.Config_Ui()
    ui.setupUi(dialog)
    path = tmp_path / "config.json"
    monkeypatch.setattr(Config, "get_config_path", lambda: str(path))
    messages = []
    monkeypatch.setattr(
        QtWidgets.QMessageBox,
        "information",
        lambda *args: messages.append(("information", args)),
    )
    monkeypatch.setattr(
        QtWidgets.QMessageBox,
        "warning",
        lambda *args: messages.append(("warning", args)),
    )
    yield ui, dialog, path, messages
    dialog.close()


def _leaves(config, prefix=""):
    result = {}
    for key, value in config.items():
        path = prefix + key
        if isinstance(value, dict):
            result.update(_leaves(value, path + "."))
        else:
            result[path] = value
    return result


def _email_config():
    return {
        "enabled": True,
        "smtp_server": "smtp.example.com",
        "username": "sender@example.com",
        "password": "example-authorization-code",
        "recipient": "recipient@example.com",
    }


def test_all_default_and_example_parameters_have_controls(settings):
    ui, _, _, _ = settings
    example = json.loads(Path("config.example.json").read_text(encoding="utf-8"))
    assert set(ui.fields) == set(_leaves(get_initial_data())) == set(_leaves(example))
    assert ui.tabs.count() == 4
    expected = get_initial_data()
    expected["region"] = int(expected["region"])
    assert ui.collect_config() == expected


def test_old_partial_config_is_completed_without_mutation(settings):
    ui, _, _, _ = settings
    original = {
        "sessionid": "old-session",
        "audio_config": {"audio_type": {"im_called": False}},
    }
    snapshot = deepcopy(original)
    ui.load_config(original)
    assert original == snapshot
    assert ui.collect_config()["email_config"] == get_initial_data()["email_config"]
    assert ui.self_called.isChecked() is False
    assert ui.collect_config()["sessionid"] == "old-session"


def test_save_round_trips_all_fields_and_keeps_extensions(settings):
    ui, dialog, path, messages = settings
    source = get_initial_data()
    source["region"] = 3
    source["sessionid"] = "new-session"
    source["auto_danmu"] = True
    source["danmu_config"]["danmu_limit"] = 17
    source["audio_on"] = False
    for key, value in source["audio_config"]["audio_type"].items():
        source["audio_config"]["audio_type"][key] = not value
    source["auto_answer"] = False
    source["answer_config"]["answer_delay"] = {"type": 4, "custom": {"percent": 100}}
    source["sign_config"]["delay_time"] = {
        "type": 2,
        "custom": {"time": 50000, "cutoff": 60000},
    }
    source["email_config"].update(_email_config())
    source["email_config"].update(
        {
            "smtp_port": 587,
            "sender": "other@example.com",
            "subject": "中文通知",
            "use_ssl": False,
            "starttls": False,
            "timeout": 25,
        }
    )
    source.update(
        {
            "enable_ai_analysis": True,
            "openai_api_key": "test-key",
            "openai_api_base": "http://localhost:8000/v1",
            "openai_model": "custom-model",
        }
    )
    source["ai_analysis_settings"].update(
        {
            "protocol": "chat_completions",
            "stream": False,
            "reasoning_effort": "vendor-effort",
            "reasoning_summary": None,
            "max_output_tokens": 100000,
            "max_retries": 0,
            "request_timeout": 0.125,
            "delay_between_requests": 0.25,
            "extension": "preserved",
        }
    )
    source["extension"] = {"example": True}
    ui.load_config(source)
    assert ui.collect_config() == source
    ui.save.click()
    assert dialog.result() == QtWidgets.QDialog.Accepted
    assert json.loads(path.read_text(encoding="utf-8")) == source
    assert "中文通知" in path.read_text(encoding="utf-8")
    assert messages == []
    ui.load_config(json.loads(path.read_text(encoding="utf-8")))
    assert ui.collect_config() == source


def test_editing_controls_is_saved_and_cancel_does_not_mutate(settings):
    ui, dialog, path, _ = settings
    original = get_initial_data()
    snapshot = deepcopy(original)
    ui.load_config(original)
    ui.fields["openai_model"].setText("edited-model")
    ui.fields["ai_analysis_settings.max_output_tokens"].setValue(32768)
    ui.reasoning_effort.setEditText("custom-effort")
    ui.cancel.click()
    assert dialog.result() == QtWidgets.QDialog.Rejected
    assert original == snapshot
    assert not path.exists()
    ui.save_config(dialog)
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["openai_model"] == "edited-model"
    assert saved["ai_analysis_settings"]["max_output_tokens"] == 32768
    assert saved["ai_analysis_settings"]["reasoning_effort"] == "custom-effort"
    assert original == snapshot


@pytest.mark.parametrize("tokens", [None, 1, 32768, 2147483647])
@pytest.mark.parametrize("summary", [None, "auto", "concise", "vendor-summary"])
def test_optional_ai_values_round_trip(settings, tokens, summary):
    ui, _, _, _ = settings
    ui.load_config(
        {
            "ai_analysis_settings": {
                "max_output_tokens": tokens,
                "reasoning_summary": summary,
            }
        }
    )
    collected = ui.collect_config()["ai_analysis_settings"]
    assert collected["max_output_tokens"] == tokens
    assert collected["reasoning_summary"] == summary


def test_dependent_controls_follow_loaded_values_and_switches(settings):
    ui, _, _, _ = settings
    ui.load_config(
        {
            "auto_answer": True,
            "answer_config": {"answer_delay": {"type": 4}},
            "enable_ai_analysis": True,
            "email_config": {"enabled": True},
        }
    )
    assert ui.delay_time_4_input.isEnabled()
    ui.answer_delay_type.setCurrentIndex(0)
    assert not ui.delay_time_4_input.isEnabled()
    ui.answer_delay_type.setCurrentIndex(3)
    ui.answer_on.setChecked(False)
    assert not ui.delay_time_4_input.isEnabled()
    assert ui.reasoning_effort.isEnabled()
    ui.ai_protocol.setCurrentIndex(1)
    assert not ui.reasoning_effort.isEnabled()
    assert not ui.reasoning_summary.isEnabled()
    assert ui.fields["ai_analysis_settings.max_output_tokens"].isEnabled()
    ui.ai_on.setChecked(False)
    assert not ui.ai_details.isEnabled()
    assert not ui.ai_request_details.isEnabled()
    assert not ui.email_starttls.isEnabled()
    ui.email_ssl.setChecked(False)
    assert ui.email_starttls.isEnabled()
    ui.email_on.setChecked(False)
    assert not ui.test_email_btn.isEnabled()
    assert ui.collect_config()["email_config"]["starttls"] is True


def test_secrets_hidden_by_default_and_on_reload(settings):
    ui, _, _, _ = settings
    secrets = [ui.api_key, ui.email_password, ui.sessionid]
    assert all(widget.echoMode() == QtWidgets.QLineEdit.Password for widget in secrets)
    ui.show_secrets.setChecked(True)
    assert all(widget.echoMode() == QtWidgets.QLineEdit.Normal for widget in secrets)
    ui.load_config(get_initial_data())
    assert all(widget.echoMode() == QtWidgets.QLineEdit.Password for widget in secrets)


@pytest.mark.parametrize("success", [True, False])
def test_email_uses_unsaved_form_without_saving(settings, monkeypatch, success):
    ui, dialog, path, messages = settings
    source = {"email_config": _email_config()}
    snapshot = deepcopy(source)
    ui.load_config(source)
    ui.fields["email_config.recipient"].setText("edited@example.com")
    # 邮件测试不受其他页面未填完的 AI 配置影响。
    ui.ai_on.setChecked(True)
    sent = []

    def send(config):
        sent.append(config)
        return success

    monkeypatch.setattr(Config, "send_test_email_notification", send)
    ui.test_email_btn.click()
    assert len(sent) == 1
    assert sent[0]["email_config"]["recipient"] == "edited@example.com"
    assert messages[0][0] == ("information" if success else "warning")
    assert messages[0][1][0] is dialog
    assert ui.test_email_btn.isEnabled()
    assert source == snapshot
    assert not path.exists()


@pytest.mark.parametrize(
    "config,tab",
    [({"enable_ai_analysis": True}, 2), ({"email_config": {"enabled": True}}, 1)],
)
def test_incomplete_enabled_features_block_save(settings, config, tab):
    ui, dialog, path, messages = settings
    ui.load_config(config)
    ui.save_config(dialog)
    assert not path.exists()
    assert dialog.result() != QtWidgets.QDialog.Accepted
    assert messages[0][0] == "warning"
    assert ui.tabs.currentIndex() == tab


def test_incomplete_email_does_not_send(settings, monkeypatch):
    ui, dialog, path, messages = settings
    ui.email_on.setChecked(True)
    monkeypatch.setattr(
        Config,
        "send_test_email_notification",
        lambda cfg: pytest.fail("不完整的配置不应发送"),
    )
    ui.test_email(dialog)
    assert messages[0][1][1] == "配置不完整"
    assert not path.exists()


def test_failed_save_preserves_original_file(settings, monkeypatch):
    ui, dialog, path, messages = settings
    path.write_text('{"existing":true}', encoding="utf-8")

    def deny_replace(*args):
        raise PermissionError("test error")

    monkeypatch.setattr(Config.os, "replace", deny_replace)
    ui.save_config(dialog)
    assert path.read_text(encoding="utf-8") == '{"existing":true}'
    assert dialog.result() != QtWidgets.QDialog.Accepted
    assert messages[0][1][1] == "保存失败"
    assert list(path.parent.glob(".config-*.tmp")) == []
