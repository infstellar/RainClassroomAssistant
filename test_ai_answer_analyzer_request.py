import requests
import json

from Scripts.AIAnswerAnalyzer import AIAnswerAnalyzer


def test_analyze_slide_uses_responses_protocol_by_default(monkeypatch, tmp_path):
    image_path = tmp_path / "slide.jpg"
    image_path.write_bytes(b"not a real jpeg, but enough for base64 encoding")

    analyzer = AIAnswerAnalyzer(
        {
            "enable_ai_analysis": False,
            "openai_api_key": "test-key",
            "openai_api_base": "https://example.invalid/v1",
            "openai_model": "gpt-5.5",
        }
    )

    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

        def json(self):
            return {"output_text": "[2]"}

    class FakeSession:
        trust_env = True

        def post(self, url, **kwargs):
            captured["url"] = url
            captured["payload"] = kwargs["json"]
            captured["timeout"] = kwargs["timeout"]
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.requests.Session", FakeSession)

    answers = analyzer.analyze_slide_with_openai(str(image_path), 11)

    assert answers == [2]
    assert captured["url"] == "https://example.invalid/v1/responses"
    assert captured["timeout"] == 120
    assert captured["payload"]["model"] == "gpt-5.5"
    assert captured["payload"]["reasoning"] == {"effort": "high"}
    assert captured["payload"]["max_output_tokens"] == 900
    message = captured["payload"]["input"][0]
    assert message["role"] == "user"
    assert message["content"][0]["type"] == "input_text"
    assert message["content"][1]["type"] == "input_image"
    assert message["content"][1]["image_url"].startswith("data:image/jpeg;base64,")


def test_extract_response_content_reads_responses_output_items():
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})

    class FakeResponse:
        text = ""

        def json(self):
            return {
                "output": [
                    {
                        "content": [
                            {"type": "output_text", "text": "[3, B]"},
                        ]
                    }
                ]
            }

    assert analyzer._extract_response_content(FakeResponse()) == "[3, B]"


def test_extract_response_content_reads_responses_sse():
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})

    class FakeResponse:
        text = (
            'data: {"type":"response.output_text.delta","delta":"["}\n\n'
            'data: {"type":"response.output_text.delta","delta":"4"}\n\n'
            'data: {"type":"response.output_text.delta","delta":"]"}\n\n'
            "data: [DONE]\n\n"
        )

        def json(self):
            raise ValueError("SSE response is not JSON")

    assert analyzer._extract_response_content(FakeResponse()) == "[4]"


def test_analyze_slide_bypasses_proxy_retries_ssl_and_parses_sse(monkeypatch, tmp_path):
    image_path = tmp_path / "slide.jpg"
    image_path.write_bytes(b"not a real jpeg, but enough for base64 encoding")

    analyzer = AIAnswerAnalyzer(
        {
            "enable_ai_analysis": False,
            "openai_api_key": "test-key",
            "openai_api_base": "https://example.invalid/v1",
            "openai_model": "gpt-5.5",
            "ai_analysis_settings": {
                "protocol": "chat_completions",
                "max_retries": 1,
                "request_timeout": 5,
                "delay_between_requests": 0,
            },
        }
    )

    calls = {"count": 0}
    created_sessions = []

    class FakeResponse:
        status_code = 200
        headers = {"Content-Type": "text/event-stream"}
        text = (
            'data: {"choices":[{"delta":{"content":"["}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"1, A"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"]"}}]}\n\n'
            "data: [DONE]\n\n"
        )

        def json(self):
            raise ValueError("SSE response is not a JSON document")

    class FakeSession:
        def __init__(self):
            self.trust_env = True
            created_sessions.append(self)

        def post(self, *args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                raise requests.exceptions.SSLError("UNEXPECTED_EOF_WHILE_READING")
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.requests.Session", FakeSession)
    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.time.sleep", lambda *_: None)

    answers = analyzer.analyze_slide_with_openai(str(image_path), 11)

    assert answers == [1, "A"]
    assert calls["count"] == 2
    assert created_sessions
    assert all(session.trust_env is False for session in created_sessions)


def test_analyze_slide_treats_usage_only_sse_as_empty_content(monkeypatch, tmp_path):
    image_path = tmp_path / "slide.jpg"
    image_path.write_bytes(b"not a real jpeg, but enough for base64 encoding")

    analyzer = AIAnswerAnalyzer(
        {
            "enable_ai_analysis": False,
            "openai_api_key": "test-key",
            "openai_api_base": "https://example.invalid/v1",
            "openai_model": "gpt-5.5",
            "ai_analysis_settings": {
                "protocol": "chat_completions",
            },
        }
    )

    class FakeResponse:
        status_code = 200
        headers = {"Content-Type": "text/event-stream"}
        text = (
            'data: {"choices":[],"usage":{"prompt_tokens":12}}\n\n'
            "data: [DONE]\n\n"
        )

        def json(self):
            raise ValueError("SSE response is not a JSON document")

    class FakeSession:
        trust_env = True

        def post(self, *args, **kwargs):
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.requests.Session", FakeSession)

    answers = analyzer.analyze_slide_with_openai(str(image_path), 12)

    assert answers == []


def test_analyze_presentation_ignores_title_cache_missing_current_problem_slide(monkeypatch, tmp_path):
    cache_dir = tmp_path / "ai_cache"
    image_path = tmp_path / "9.jpg"
    image_path.write_bytes(b"image")

    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    analyzer.cache_dir = str(cache_dir)
    analyzer.ensure_cache_dir()
    cache_file = analyzer.get_cache_file_path("lesson", "title")
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "metadata": {
                    "lesson_name": "lesson",
                    "presentation_title": "title",
                    "analysis_status": "completed",
                    "total_slides": 1,
                    "ai_analyzed_slides": 1,
                },
                "answers": {"10": ["old"]},
                "manual_answers": {},
            },
            f,
        )

    monkeypatch.setattr(analyzer, "analyze_slide_with_openai", lambda image_path, slide_index: ["new"])
    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.time.sleep", lambda *_: None)

    answers = analyzer.analyze_presentation(
        "lesson",
        "title",
        [
            {
                "index": 9,
                "id": "slide-9",
                "problem": {"problemId": "problem-9"},
            }
        ],
        str(tmp_path),
    )

    assert answers == {"9": ["new"]}


def test_analyze_presentation_reuses_cache_when_problem_signature_matches(monkeypatch, tmp_path):
    cache_dir = tmp_path / "ai_cache"
    image_path = tmp_path / "9.jpg"
    image_path.write_bytes(b"image")

    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    analyzer.cache_dir = str(cache_dir)
    analyzer.ensure_cache_dir()
    analyzer.save_cached_answers(
        "lesson",
        "title",
        {"9": ["cached"]},
        [
            {
                "index": 9,
                "id": "slide-9",
                "problem": {"problemId": "problem-9"},
            }
        ],
        "completed",
    )

    def fail_if_called(*args):
        raise AssertionError("cache should have been reused")

    monkeypatch.setattr(analyzer, "analyze_slide_with_openai", fail_if_called)

    answers = analyzer.analyze_presentation(
        "lesson",
        "title",
        [
            {
                "index": 9,
                "id": "slide-9",
                "problem": {"problemId": "problem-9"},
            }
        ],
        str(tmp_path),
    )

    assert answers == {"9": ["cached"]}
