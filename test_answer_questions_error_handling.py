import json
from types import SimpleNamespace

from Scripts.Classes import Lesson


def test_answer_questions_handles_non_object_response(monkeypatch):
    messages = []
    lesson = object.__new__(Lesson)
    lesson.lessonname = "lesson"
    lesson.config = {
        "region": "1",
        "answer_config": {
            "answer_delay": {
                "type": 1,
                "custom": {"percent": 50},
            }
        },
        "enable_ai_analysis": False,
    }
    lesson.headers = {}
    lesson.add_message = lambda message, level: messages.append((message, level))

    posted = {}

    def fake_post(**kwargs):
        posted.update(kwargs)
        return SimpleNamespace(text='["login expired"]')

    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", fake_post)

    result = lesson.answer_questions("problem-1", 1, [2], 60)

    assert result is False
    assert json.loads(posted["data"])["result"] == [2]
    assert any("自动回答失败" in message for message, _ in messages)


def test_answer_questions_formats_problem_type_4_answer_as_object(monkeypatch):
    messages = []
    lesson = object.__new__(Lesson)
    lesson.lessonname = "lesson"
    lesson.config = {
        "region": "1",
        "answer_config": {
            "answer_delay": {
                "type": 1,
                "custom": {"percent": 50},
            }
        },
        "enable_ai_analysis": False,
    }
    lesson.headers = {}
    lesson.add_message = lambda message, level: messages.append((message, level))

    posted = {}

    def fake_post(**kwargs):
        posted.update(kwargs)
        return SimpleNamespace(text='{"code":0,"msg":"success"}', status_code=200)

    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", fake_post)

    result = lesson.answer_questions("problem-1", 4, ["0.4"], 60)

    payload = json.loads(posted["data"])
    assert result is True
    assert payload["result"] == {"0": "0.4"}
    assert any("答题提交payload" in message for message, _ in messages)


def test_answer_questions_formats_problem_type_5_answer_as_content_object(monkeypatch):
    lesson = object.__new__(Lesson)
    lesson.lessonname = "lesson"
    lesson.config = {
        "region": "1",
        "answer_config": {
            "answer_delay": {
                "type": 1,
                "custom": {"percent": 50},
            }
        },
        "enable_ai_analysis": False,
    }
    lesson.headers = {}
    lesson.add_message = lambda message, level: None

    posted = {}

    def fake_post(**kwargs):
        posted.update(kwargs)
        return SimpleNamespace(text='{"code":0,"msg":"success"}', status_code=200)

    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", fake_post)

    result = lesson.answer_questions(
        "problem-1",
        5,
        ["r^2+(12kl^2-3Wl)/(2ml^2)=0"],
        60,
    )

    payload = json.loads(posted["data"])
    assert result is True
    assert payload["result"] == {
        "content": "r^2+(12kl^2-3Wl)/(2ml^2)=0",
        "pics": [{"pic": "", "thumb": ""}],
    }
