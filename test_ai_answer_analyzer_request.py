import requests
import json
import pytest

from Scripts.AIAnswerAnalyzer import AIAnswerAnalyzer


@pytest.mark.parametrize("protocol", ["responses", "chat_completions"])
@pytest.mark.parametrize("limit", [None, 32768])
def test_request_output_limit_and_stream_can_be_configured(protocol, limit):
    analyzer = AIAnswerAnalyzer({
        "enable_ai_analysis": False,
        "ai_analysis_settings": {
            "protocol": protocol, "stream": False,
            "reasoning_summary": None, "max_output_tokens": limit,
        },
    })
    _, payload = analyzer._build_ai_request("https://example.invalid/v1", "test-model", "image")
    assert payload["stream"] is False
    limit_key = "max_output_tokens" if protocol == "responses" else "max_tokens"
    if limit is None:
        assert limit_key not in payload
    else:
        assert payload[limit_key] == limit
    if protocol == "responses":
        assert payload["reasoning"] == {"effort": "high"}
    else:
        assert "reasoning" not in payload


@pytest.mark.parametrize("limit", [0, -1, True, 1.5, "32768"])
def test_invalid_output_limit_is_rejected(limit):
    with pytest.raises(ValueError, match="max_output_tokens"):
        AIAnswerAnalyzer({"ai_analysis_settings": {"max_output_tokens": limit}})


def test_stream_is_consumed_before_close_without_buffering_and_deduplicates(monkeypatch):
    logs = []
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False}, lambda message, _: logs.append(message))
    final = {
        "status": "completed",
        "output": [
            {"type": "reasoning", "summary": [{"type": "summary_text", "text": "检查题目"}]},
            {"type": "message", "content": [{"type": "output_text", "text": "[2]"}]},
        ],
        "usage": {"input_tokens": 12, "output_tokens": 50, "output_tokens_details": {"reasoning_tokens": 45}},
    }

    class StreamResponse:
        status_code = 200
        headers = {"Content-Type": "text/event-stream; charset=utf-8"}
        closed = False

        @property
        def text(self):
            raise AssertionError("must not buffer the response")

        def json(self):
            raise AssertionError("must not buffer the response")

        def iter_lines(self, **kwargs):
            assert not self.closed and not session.closed
            events = [
                {"type": "response.reasoning_summary_text.delta", "delta": "检查题目"},
                {"type": "response.output_text.delta", "delta": "["},
                {"type": "response.output_text.delta", "delta": "2]"},
                {"type": "response.output_text.done", "text": "[2]"},
                {"type": "response.completed", "response": final},
            ]
            for index, event in enumerate(events):
                yield ("data: " + json.dumps(event, ensure_ascii=False)).encode("utf-8")
                yield b""
                if index == 0:
                    assert any("推理摘要片段: 检查题目" in message for message in logs)
            raise AssertionError("must stop after response.completed")

        def close(self):
            self.closed = True

    response = StreamResponse()

    class Session:
        closed = False

        def post(self, url, **kwargs):
            assert kwargs["stream"] is True
            assert kwargs["json"]["stream"] is True
            return response

        def close(self):
            self.closed = True

    session = Session()
    monkeypatch.setattr(analyzer, "_create_request_session", lambda: session)
    _, payload = analyzer._build_ai_request("https://example.invalid/v1", "test-model", "image")
    assert analyzer._post_ai_request("https://example.invalid/v1/responses", {}, payload) == [2]
    assert response.closed and session.closed
    assert sum("检查题目" in message for message in logs) == 1
    assert any("reasoning=45" in message for message in logs)


@pytest.mark.parametrize("status", ["incomplete", "failed"])
def test_sse_rejects_partial_answer_on_terminal_failure(status):
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    events = [
        {"type": "response.output_text.delta", "delta": "[2]"},
        {"type": f"response.{status}", "response": {
            "status": status, "incomplete_details": {"reason": "max_output_tokens"},
        }},
    ]
    lines = []
    for event in events:
        lines.extend(["data: " + json.dumps(event), ""])
    with pytest.raises(ValueError, match="未完成"):
        analyzer._extract_sse_content(lines)


def test_json_reports_summary_usage_and_rejects_incomplete_output():
    logs = []
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False}, lambda message, _: logs.append(message))

    class Response:
        def json(self):
            return {
                "status": "incomplete", "output_text": "[2]",
                "output": [{"type": "reasoning", "summary": [{"text": "检查题目"}]}],
                "usage": {"output_tokens_details": {"reasoning_tokens": 900}},
                "incomplete_details": {"reason": "max_output_tokens"},
            }

    with pytest.raises(ValueError, match="max_output_tokens"):
        analyzer._extract_response_content(Response())
    assert any("推理摘要: 检查题目" in message for message in logs)
    assert any("reasoning=900" in message for message in logs)


def test_sse_handles_multiline_data_and_ignores_reasoning_in_answers():
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    lines = [
        ": keepalive", "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta",', 'data: "delta":"[3]"}', "",
        'data: {"type":"response.reasoning_summary_text.done","text":"参考[1]"}', "",
        'data: {"type":"response.completed","response":{"status":"completed"}}',
    ]
    assert analyzer._extract_sse_content(lines) == "[3]"


def test_sse_keeps_text_done_when_completed_snapshot_omits_output():
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    lines = [
        'data: {"type":"response.output_text.done","text":"[3]"}', "",
        'data: {"type":"response.completed","response":{"status":"completed"}}', "",
    ]
    assert analyzer._extract_sse_content(lines) == "[3]"


@pytest.mark.parametrize("tail", [None, {"type": "error", "message": "upstream failed"}])
def test_sse_rejects_broken_or_error_stream(tail):
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    lines = ['data: {"type":"response.output_text.delta","delta":"[2]"}', ""]
    if tail:
        lines += ["data: " + json.dumps(tail), ""]
    with pytest.raises((ValueError, requests.exceptions.ConnectionError)):
        analyzer._extract_sse_content(lines)


def test_real_http_stream_delivers_summary_before_server_finishes():
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    summary_received = threading.Event()
    observed = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            observed["payload"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            event = {"type": "response.reasoning_summary_text.delta", "delta": "检查题目"}
            self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
            self.wfile.flush()
            observed["incremental"] = summary_received.wait(3)
            final = {"type": "response.completed", "response": {
                "status": "completed", "output_text": "[2]",
                "usage": {"output_tokens_details": {"reasoning_tokens": 15}},
            }}
            self.wfile.write(("data: " + json.dumps(final) + "\n\n").encode())
            self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()

    def log(message, _):
        if "推理摘要片段: 检查题目" in message:
            summary_received.set()

    try:
        analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False}, log)
        url, payload = analyzer._build_ai_request(f"http://127.0.0.1:{server.server_port}/v1", "test-model", "image")
        assert analyzer._post_ai_request(url, {}, payload) == [2]
        assert observed["incremental"] is True
        assert observed["payload"]["stream"] is True
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)


def test_stream_read_failure_retries_with_new_session_and_closes_resources(monkeypatch):
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False, "ai_analysis_settings": {"max_retries": 1}})
    sessions = []
    responses = []

    class Response:
        status_code = 200
        headers = {"Content-Type": "text/event-stream"}
        closed = False

        def iter_lines(self, **kwargs):
            if len(responses) == 1:
                yield b'data: {"type":"response.output_text.delta","delta":"[9]"}'
                yield b""
                raise requests.exceptions.ChunkedEncodingError("stream interrupted")
            yield b'data: {"type":"response.completed","response":{"status":"completed","output_text":"[2]"}}'
            yield b""

        def close(self):
            self.closed = True

    class Session:
        closed = False

        def post(self, *args, **kwargs):
            response = Response()
            responses.append(response)
            return response

        def close(self):
            self.closed = True

    def create_session():
        session = Session()
        sessions.append(session)
        return session

    monkeypatch.setattr(analyzer, "_create_request_session", create_session)
    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.time.sleep", lambda *_: None)
    assert analyzer._post_ai_request("https://example.invalid/v1/responses", {}, {"stream": True}) == [2]
    assert len(sessions) == 2
    assert all(session.closed for session in sessions)
    assert all(response.closed for response in responses)


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
    assert captured["payload"]["reasoning"] == {"effort": "high", "summary": "auto"}
    assert "max_output_tokens" not in captured["payload"]
    assert captured["payload"]["stream"] is True
    message = captured["payload"]["input"][0]
    assert message["role"] == "user"
    assert message["content"][0]["type"] == "input_text"
    assert message["content"][1]["type"] == "input_image"
    assert message["content"][1]["image_url"].startswith("data:image/jpeg;base64,")


def test_parse_answer_array_recognizes_insufficient_context_marker():
    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})

    assert (
        analyzer._parse_answer_array('["上下文不足"]')
        == analyzer.INSUFFICIENT_CONTEXT_MARKER
    )


@pytest.mark.parametrize("reasoning_effort", ["none", "minimal", "low", "medium", "high", "xhigh", "max"])
def test_build_responses_request_uses_configured_reasoning_effort(reasoning_effort):
    analyzer = AIAnswerAnalyzer(
        {
            "enable_ai_analysis": False,
            "ai_analysis_settings": {"reasoning_effort": reasoning_effort},
        }
    )

    url, payload = analyzer._build_ai_request("https://example.invalid/v1", "test-model", "image")

    assert url == "https://example.invalid/v1/responses"
    assert payload["reasoning"] == {"effort": reasoning_effort, "summary": "auto"}


def test_analyze_slide_with_context_sends_images_in_order(monkeypatch, tmp_path):
    image_paths = []
    for index in range(3):
        image_path = tmp_path / f"{index + 1}.jpg"
        image_path.write_bytes(f"image-{index + 1}".encode("ascii"))
        image_paths.append(str(image_path))

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
            return FakeResponse()

        def close(self):
            pass

    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.requests.Session", FakeSession)

    answers = analyzer.analyze_slide_with_context(image_paths, 3)

    assert answers == [2]
    content = captured["payload"]["input"][0]["content"]
    assert content[0]["type"] == "input_text"
    image_items = [item for item in content if item["type"] == "input_image"]
    assert len(image_items) == 3
    assert [item["image_url"] for item in image_items] == [
        f"data:image/jpeg;base64,{analyzer.encode_image_to_base64(path)}"
        for path in image_paths
    ]


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


def test_analyze_presentation_reanalyzes_empty_cached_answer(monkeypatch, tmp_path):
    cache_dir = tmp_path / "ai_cache"
    image_path = tmp_path / "9.jpg"
    image_path.write_bytes(b"image")

    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    analyzer.cache_dir = str(cache_dir)
    analyzer.ensure_cache_dir()
    analyzer.save_cached_answers(
        "lesson",
        "title",
        {"9": []},
        [
            {
                "index": 9,
                "id": "slide-9",
                "problem": {"problemId": "problem-9"},
            }
        ],
        "completed",
    )

    calls = []

    def analyze_again(image_path, slide_index):
        calls.append(slide_index)
        return ["new"]

    monkeypatch.setattr(analyzer, "analyze_slide_with_openai", analyze_again)
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

    assert calls == [9]
    assert answers == {"9": ["new"]}


def test_analyze_presentation_does_not_save_empty_ai_result_as_answer(monkeypatch, tmp_path):
    cache_dir = tmp_path / "ai_cache"
    image_path = tmp_path / "9.jpg"
    image_path.write_bytes(b"image")

    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    analyzer.cache_dir = str(cache_dir)
    analyzer.ensure_cache_dir()

    monkeypatch.setattr(analyzer, "analyze_slide_with_openai", lambda image_path, slide_index: [])
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

    cache_file = analyzer.get_cache_file_path("lesson", "title")
    with open(cache_file, encoding="utf-8") as f:
        cache_data = json.load(f)

    assert answers == {}
    assert cache_data["metadata"]["analysis_status"] == "failed"
    assert cache_data["answers"] == {}
    assert cache_data["manual_answers"] == {"9": []}


def test_analyze_presentation_retries_with_batch_context_when_single_slide_needs_context(monkeypatch, tmp_path):
    cache_dir = tmp_path / "ai_cache"
    for index in (1, 2, 3):
        (tmp_path / f"{index}.jpg").write_bytes(f"image-{index}".encode("ascii"))

    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    analyzer.cache_dir = str(cache_dir)
    analyzer.ensure_cache_dir()

    context_calls = []

    def analyze_single(image_path, slide_index):
        assert slide_index == 3
        return analyzer.INSUFFICIENT_CONTEXT_MARKER

    def analyze_context(image_paths, slide_index):
        context_calls.append(([path.split("\\")[-1].split("/")[-1] for path in image_paths], slide_index))
        return [2]

    monkeypatch.setattr(analyzer, "analyze_slide_with_openai", analyze_single)
    monkeypatch.setattr(analyzer, "analyze_slide_with_context", analyze_context)
    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.time.sleep", lambda *_: None)

    answers = analyzer.analyze_presentation(
        "lesson",
        "title",
        [
            {"index": 1},
            {"index": 2},
            {
                "index": 3,
                "id": "slide-3",
                "problem": {"problemId": "problem-3"},
            },
        ],
        str(tmp_path),
    )

    cache_file = analyzer.get_cache_file_path("lesson", "title")
    with open(cache_file, encoding="utf-8") as f:
        cache_data = json.load(f)

    assert context_calls == [(["1.jpg", "2.jpg", "3.jpg"], 3)]
    assert answers == {"3": [2]}
    assert cache_data["answers"] == {"3": [2]}
    assert cache_data["metadata"]["analysis_status"] == "completed"


def test_analyze_presentation_does_not_cache_marker_when_batch_context_exhausted(monkeypatch, tmp_path):
    cache_dir = tmp_path / "ai_cache"
    for index in range(1, 6):
        (tmp_path / f"{index}.jpg").write_bytes(f"image-{index}".encode("ascii"))

    analyzer = AIAnswerAnalyzer({"enable_ai_analysis": False})
    analyzer.cache_dir = str(cache_dir)
    analyzer.ensure_cache_dir()

    context_calls = []

    monkeypatch.setattr(
        analyzer,
        "analyze_slide_with_openai",
        lambda image_path, slide_index: analyzer.INSUFFICIENT_CONTEXT_MARKER,
    )

    def still_insufficient(image_paths, slide_index):
        context_calls.append(([path.split("\\")[-1].split("/")[-1] for path in image_paths], slide_index))
        return analyzer.INSUFFICIENT_CONTEXT_MARKER

    monkeypatch.setattr(analyzer, "analyze_slide_with_context", still_insufficient)
    monkeypatch.setattr("Scripts.AIAnswerAnalyzer.time.sleep", lambda *_: None)

    answers = analyzer.analyze_presentation(
        "lesson",
        "title",
        [
            {"index": 1},
            {"index": 2},
            {"index": 3},
            {"index": 4},
            {
                "index": 5,
                "id": "slide-5",
                "problem": {"problemId": "problem-5"},
            },
        ],
        str(tmp_path),
    )

    cache_file = analyzer.get_cache_file_path("lesson", "title")
    with open(cache_file, encoding="utf-8") as f:
        cache_data = json.load(f)

    assert [call[0] for call in context_calls] == [
        ["3.jpg", "4.jpg", "5.jpg"],
        ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"],
        ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"],
        ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"],
    ]
    assert answers == {}
    assert analyzer.INSUFFICIENT_CONTEXT_MARKER not in cache_data["answers"].values()
    assert cache_data["answers"] == {}
    assert cache_data["manual_answers"] == {"5": []}
    assert cache_data["metadata"]["analysis_status"] == "failed"


def test_load_cached_answers_filters_legacy_insufficient_context_marker(tmp_path):
    cache_dir = tmp_path / "ai_cache"
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
                },
                "answers": {
                    "8": analyzer.INSUFFICIENT_CONTEXT_MARKER,
                    "9": [1],
                },
                "manual_answers": {},
            },
            f,
        )

    assert analyzer.load_cached_answers("lesson", "title") == {"9": [1]}
