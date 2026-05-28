import sys
import types

loguru_stub = types.ModuleType("loguru")


class _Logger:
    def info(self, *args, **kwargs):
        pass

    def add(self, *args, **kwargs):
        pass

    def exception(self, *args, **kwargs):
        pass


loguru_stub.logger = _Logger()
sys.modules.setdefault("loguru", loguru_stub)

from UI import MainWindow


def test_main_window_add_message_dispatches_type4_email(monkeypatch):
    calls = []

    class FakeOutput:
        def append(self, message):
            pass

    ui = MainWindow.MainWindow_Ui.__new__(MainWindow.MainWindow_Ui)
    ui.output_textarea = FakeOutput()
    ui.config = {"email_config": {"enabled": True}}
    ui.audio = lambda message, level: None

    monkeypatch.setattr(MainWindow.logger, "info", lambda message: None)
    monkeypatch.setattr(
        MainWindow,
        "send_email_notification_if_needed",
        lambda message, level, config: calls.append((message, level, config)),
    )

    ui.add_message("自动答题情况", 4)
    ui.add_message("普通消息", 0)

    assert calls == [("自动答题情况", 4, ui.config)]
