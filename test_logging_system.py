import json
import sys
import threading
from types import SimpleNamespace

import pytest
from loguru import logger

from Scripts.Classes import Lesson
from Scripts.Logger import setup_logging


def test_setup_logging_writes_to_requested_log_dir(tmp_path):
    log_path = setup_logging(log_dir=tmp_path, enqueue=False)

    logger.info("diagnostic log entry")
    logger.remove()

    assert log_path.parent == tmp_path
    assert log_path.exists()
    assert "diagnostic log entry" in log_path.read_text(encoding="utf-8")


def test_checkin_class_logs_response_details_when_lesson_token_missing(
    monkeypatch, tmp_path
):
    log_path = setup_logging(log_dir=tmp_path, enqueue=False)
    lesson = object.__new__(Lesson)
    lesson.lessonid = "lesson-1"
    lesson.lessonname = "测试课程"
    lesson.config = {"region": 1}
    lesson.headers = {"Cookie": "sessionid=test-session"}
    messages = []
    lesson.add_message = lambda message, level: messages.append((message, level))

    response = SimpleNamespace(
        status_code=200,
        headers={},
        text=json.dumps({"code": 50000, "data": None, "msg": "login expired"}),
    )

    monkeypatch.setattr("Scripts.Classes.requests.post", lambda **kwargs: response)
    monkeypatch.setattr("Scripts.Classes.time.sleep", lambda seconds: None)

    with pytest.raises(RuntimeError, match="课程签到失败"):
        lesson.checkin_class()

    logger.remove()
    log_text = log_path.read_text(encoding="utf-8")
    assert "课程签到响应异常" in log_text
    assert "lesson-1" in log_text
    assert "login expired" in log_text
    assert any("课程签到失败" in message for message, _ in messages)


def test_setup_logging_installs_exception_hooks(monkeypatch, tmp_path):
    original_hook = sys.excepthook
    original_thread_hook = getattr(threading, "excepthook", None)

    try:
        setup_logging(log_dir=tmp_path, enqueue=False)
        assert sys.excepthook is not original_hook
        assert getattr(threading, "excepthook", None) is not original_thread_hook
    finally:
        sys.excepthook = original_hook
        if original_thread_hook is not None:
            threading.excepthook = original_thread_hook
