import json
from types import SimpleNamespace

import pytest

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
    assert json.loads(posted["data"])["result"] == ["B"]
    assert any("自动回答失败" in message for message, _ in messages)


@pytest.mark.parametrize(
    "problemtype, answer, expected",
    [
        (1, [2], ["B"]),
        (1, [4], ["D"]),
        (2, [1, 3], ["A", "C"]),
        (1, ["2"], ["B"]),
        (2, ['"1"', "'3'"], ["A", "C"]),
        (2, ["A", "C"], ["A", "C"]),
        (1, ['"b"'], ["B"]),
    ],
)
def test_answer_questions_submits_choice_strings(monkeypatch, problemtype, answer, expected):
    lesson = object.__new__(Lesson)
    lesson.lessonname = "lesson"
    lesson.config = {
        "region": "1",
        "answer_config": {"answer_delay": {"type": 1, "custom": {"percent": 50}}},
        "enable_ai_analysis": False,
    }
    lesson.headers = {}
    lesson.add_message = lambda message, level: None
    original_answer = answer.copy()
    posted = []

    def fake_post(**kwargs):
        payload = json.loads(kwargs["data"])
        posted.append(payload)
        # Emulate the server rejecting integer option values.
        if not all(isinstance(value, str) for value in payload["result"]):
            return SimpleNamespace(
                text=json.dumps("class java.lang.Integer cannot be cast to class java.lang.String"),
                status_code=500,
            )
        return SimpleNamespace(text='{"code":0,"msg":"success"}', status_code=200)

    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", fake_post)

    assert lesson.answer_questions("problem-1", problemtype, answer, 60) is True
    assert len(posted) == 1
    assert posted[0]["result"] == expected
    assert answer == original_answer


@pytest.mark.parametrize("answer", [[0], [-1], [27], [True], [2.5], ["AB"]])
def test_answer_questions_rejects_invalid_choice_without_posting(monkeypatch, answer):
    lesson = object.__new__(Lesson)
    lesson.lessonname = "lesson"
    lesson.config = {
        "region": "1",
        "answer_config": {"answer_delay": {"type": 1, "custom": {"percent": 50}}},
        "enable_ai_analysis": False,
    }
    lesson.headers = {}
    messages = []
    lesson.add_message = lambda message, level: messages.append(message)
    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", lambda **kwargs: pytest.fail("Invalid choice submitted"))

    assert lesson.answer_questions("problem-1", 1, answer, 60) is False
    assert any("答案格式错误" in message for message in messages)


def test_answer_questions_prefers_problem_type_4_answer_as_list(monkeypatch):
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
    assert payload["result"] == ["0.4"]
    assert any("答题提交payload" in message for message, _ in messages)


def test_answer_questions_retries_problem_type_4_answer_as_object_after_array_cast_error(monkeypatch):
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

    posted = []

    def fake_post(**kwargs):
        posted.append(kwargs)
        if len(posted) == 1:
            return SimpleNamespace(
                text=(
                    "class java.util.ArrayList cannot be cast to class "
                    "io.vertx.core.json.JsonObject"
                ),
                status_code=500,
            )
        return SimpleNamespace(text='{"code":0,"msg":"success"}', status_code=200)

    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", fake_post)

    result = lesson.answer_questions("problem-1", 4, ["0.184", "0.178"], 60)

    payloads = [json.loads(call["data"]) for call in posted]
    assert result is True
    assert [payload["result"] for payload in payloads] == [
        ["0.184", "0.178"],
        {"0": "0.184", "1": "0.178"},
    ]
    assert any("重试" in message for message, _ in messages)


def test_answer_questions_does_not_retry_problem_type_4_answer_for_unrelated_parse_error(monkeypatch):
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

    posted = []

    def fake_post(**kwargs):
        posted.append(kwargs)
        return SimpleNamespace(text='["login expired"]', status_code=200)

    monkeypatch.setattr("Scripts.Classes.calculate_waittime", lambda *args: 0)
    monkeypatch.setattr("Scripts.Classes.requests.post", fake_post)

    result = lesson.answer_questions("problem-1", 4, ["0.184"], 60)

    assert result is False
    assert len(posted) == 1
    assert json.loads(posted[0]["data"])["result"] == ["0.184"]


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
