import sys
import types

pyqt5_stub = types.ModuleType("PyQt5")
qtcore_stub = types.ModuleType("PyQt5.QtCore")
qtgui_stub = types.ModuleType("PyQt5.QtGui")
qtwidgets_stub = types.ModuleType("PyQt5.QtWidgets")


class _MessageBox:
    Information = 1
    Warning = 2
    Ok = 1024

    calls = []

    @classmethod
    def information(cls, parent, title, text, buttons):
        cls.calls.append(("information", parent, title, text, buttons))

    @classmethod
    def warning(cls, parent, title, text, buttons):
        cls.calls.append(("warning", parent, title, text, buttons))


qtwidgets_stub.QMessageBox = _MessageBox
pyqt5_stub.QtCore = qtcore_stub
pyqt5_stub.QtGui = qtgui_stub
pyqt5_stub.QtWidgets = qtwidgets_stub
sys.modules.setdefault("PyQt5", pyqt5_stub)
sys.modules.setdefault("PyQt5.QtCore", qtcore_stub)
sys.modules.setdefault("PyQt5.QtGui", qtgui_stub)
sys.modules.setdefault("PyQt5.QtWidgets", qtwidgets_stub)

from UI import Config


def test_config_dialog_test_email_shows_success(monkeypatch):
    config = {"email_config": {"enabled": True}}
    ui = Config.Config_Ui.__new__(Config.Config_Ui)
    ui.dialog_config = config

    monkeypatch.setattr(Config, "send_test_email_notification", lambda cfg: cfg is config)
    monkeypatch.setattr(Config.QtWidgets, "QMessageBox", _MessageBox)
    _MessageBox.calls = []

    ui.test_email(parent="dialog")

    assert _MessageBox.calls == [
        (
            "information",
            "dialog",
            "邮件测试",
            "测试邮件发送成功，请检查收件箱。",
            _MessageBox.Ok,
        )
    ]


def test_config_dialog_test_email_shows_failure(monkeypatch):
    ui = Config.Config_Ui.__new__(Config.Config_Ui)
    ui.dialog_config = {"email_config": {"enabled": False}}

    monkeypatch.setattr(Config, "send_test_email_notification", lambda cfg: False)
    monkeypatch.setattr(Config.QtWidgets, "QMessageBox", _MessageBox)
    _MessageBox.calls = []

    ui.test_email(parent="dialog")

    assert _MessageBox.calls == [
        (
            "warning",
            "dialog",
            "邮件测试",
            "测试邮件发送失败，请检查邮件配置和网络连接。",
            _MessageBox.Ok,
        )
    ]
