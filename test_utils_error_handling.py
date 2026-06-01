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


def test_send_email_notification_if_needed_only_dispatches_type4(monkeypatch):
    started = []

    class ImmediateThread:
        def __init__(self, target, args=(), daemon=False):
            self.target = target
            self.args = args
            self.daemon = daemon

        def start(self):
            started.append((self.target, self.args, self.daemon))

    config = {
        "email_config": {
            "enabled": True,
            "smtp_server": "smtp.example.com",
            "smtp_port": 465,
            "username": "sender@example.com",
            "password": "secret",
            "recipient": "receiver@example.com",
        }
    }

    monkeypatch.setattr(Utils.threading, "Thread", ImmediateThread)

    assert Utils.send_email_notification_if_needed("自动答题情况", 4, config) is True
    assert Utils.send_email_notification_if_needed("收到题目", 3, config) is False

    assert len(started) == 1
    target, args, daemon = started[0]
    assert target == Utils.send_email_notification
    assert args == ("自动答题情况", config)
    assert daemon is True


def test_send_email_notification_uses_smtp_ssl(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent["host"] = host
            sent["port"] = port
            sent["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def login(self, username, password):
            sent["login"] = (username, password)

        def send_message(self, message):
            sent["message"] = message

    monkeypatch.setattr(Utils.smtplib, "SMTP_SSL", FakeSMTP)

    config = {
        "email_config": {
            "enabled": True,
            "smtp_server": "smtp.example.com",
            "smtp_port": 465,
            "username": "sender@example.com",
            "password": "secret",
            "recipient": "receiver@example.com",
            "subject": "雨课堂助手通知",
        }
    }

    assert Utils.send_email_notification("自动答题失败", config) is True

    message = sent["message"]
    assert sent["host"] == "smtp.example.com"
    assert sent["port"] == 465
    assert sent["login"] == ("sender@example.com", "secret")
    assert message["Subject"] == "雨课堂助手通知"
    assert message["From"] == "sender@example.com"
    assert message["To"] == "receiver@example.com"
    assert message.get_content().strip() == "自动答题失败"


def test_send_test_email_notification_uses_standard_sender(monkeypatch):
    sent = {}

    def fake_send_email_notification(message, config):
        sent["message"] = message
        sent["config"] = config
        return True

    config = {
        "email_config": {
            "enabled": True,
            "smtp_server": "smtp.example.com",
            "username": "sender@example.com",
            "password": "secret",
            "recipient": "receiver@example.com",
        }
    }

    monkeypatch.setattr(Utils, "send_email_notification", fake_send_email_notification)

    assert Utils.send_test_email_notification(config) is True
    assert sent["config"] is config
    assert sent["message"] == "这是一封雨课堂助手测试邮件。收到此邮件表示邮件通知配置可用。"
