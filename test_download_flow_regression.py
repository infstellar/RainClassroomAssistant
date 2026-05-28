import asyncio
import json
import os
import sys
import types

import pytest

sys.modules.setdefault("PyPDF2", types.ModuleType("PyPDF2"))
fpdf_stub = types.ModuleType("fpdf")


class _FPDF:
    def __init__(self, *args, **kwargs):
        pass

    def set_keywords(self, *args, **kwargs):
        pass

    def set_author(self, *args, **kwargs):
        pass

    def add_page(self, *args, **kwargs):
        pass

    def image(self, *args, **kwargs):
        pass

    def output(self, *args, **kwargs):
        pass


fpdf_stub.FPDF = _FPDF
sys.modules.setdefault("fpdf", fpdf_stub)
aiofiles_stub = types.ModuleType("aiofiles")


class _AiofilesOpen:
    def __init__(self, *args, **kwargs):
        self._file = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def write(self, *args, **kwargs):
        return None


def _aiofiles_open(*args, **kwargs):
    return _AiofilesOpen(*args, **kwargs)


aiofiles_stub.open = _aiofiles_open
sys.modules.setdefault("aiofiles", aiofiles_stub)
loguru_stub = types.ModuleType("loguru")


class _Logger:
    def error(self, *args, **kwargs):
        pass

    def warning(self, *args, **kwargs):
        pass


loguru_stub.logger = _Logger()
sys.modules.setdefault("loguru", loguru_stub)
sys.modules.setdefault("pyttsx3", types.ModuleType("pyttsx3"))
sys.modules.setdefault("win32api", types.ModuleType("win32api"))
sys.modules.setdefault("win32con", types.ModuleType("win32con"))
win10toast_stub = types.ModuleType("win10toast")
win10toast_stub.ToastNotifier = type("ToastNotifier", (), {"show_toast": lambda *args, **kwargs: None})
sys.modules.setdefault("win10toast", win10toast_stub)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "Scripts"))

from Scripts import Classes
from Scripts.AsyncDownloader import AsyncPPTDownloadManager
from Scripts.PPTManager import PPTManager


class DummyWebSocket:
    def close(self):
        pass


class ImmediateFuture:
    def result(self):
        return None


class ImmediateExecutor:
    def submit(self, fn):
        fn()
        return ImmediateFuture()


class FakeAsyncDownloadManager:
    def __init__(self, result=None):
        self.result = result or {
            "total": 2,
            "successful": 1,
            "failed": 1,
            "success_list": [{"slide": {"index": 1}}],
            "failed_list": [{"slide": {"index": 2}, "error": "boom"}],
        }
        self.refresh_callbacks = []

    async def download_presentation(self, data, lessonname):
        return self.result

    def set_data_refresh_callback(self, presentation_id, callback):
        self.refresh_callbacks.append((presentation_id, callback))


def make_lesson():
    lesson = object.__new__(Classes.Lesson)
    lesson.lessonname = "测试课程"
    lesson.config = {"enable_ai_analysis": False, "auto_danmu": False, "auto_answer": False}
    lesson.add_message = lambda *args, **kwargs: None
    lesson.problems_ls = []
    lesson.problems_dict = {}
    lesson.unlocked_problem = []
    lesson.downloaded_presentations = set()
    lesson.get_problems = lambda presentation_id: []
    lesson._current_problem = lambda *args, **kwargs: None
    lesson._get_ppt = lambda presentation_id: {
        "title": "测试章节",
        "slides": [],
        "width": 800,
        "height": 600,
    }
    lesson._executor = ImmediateExecutor()
    return lesson


def test_async_download_stops_when_image_download_fails(monkeypatch):
    lesson = make_lesson()
    lesson._async_download_manager = FakeAsyncDownloadManager()

    called = []

    class FakePPTManager:
        def __init__(self, data, lessonname):
            self.data = data
            self.lessonname = lessonname

        def get_missing_images(self):
            return [{"index": 2, "cover": "https://example.com/2.jpg"}]

        def generate_ppt(self):
            called.append("generate_ppt")
            return "测试.pdf"

    monkeypatch.setattr(Classes, "PPTManager", FakePPTManager)

    async def fake_download(data):
        return {
            "total": 2,
            "successful": 1,
            "failed": 1,
            "success_list": [{"slide": {"index": 1}}],
            "failed_list": [{"slide": {"index": 2}, "error": "boom"}],
        }

    lesson.async_download_manager.download_presentation = fake_download

    start_ai_calls = []
    lesson._start_ai_analysis = lambda *args, **kwargs: start_ai_calls.append(True)

    data = {
        "title": "测试章节",
        "slides": [
            {"index": 1, "cover": "https://example.com/1.jpg"},
            {"index": 2, "cover": "https://example.com/2.jpg"},
        ],
        "width": 800,
        "height": 600,
    }

    asyncio.run(lesson._async_download(data))

    assert called == []
    assert start_ai_calls == []


def test_on_message_does_not_mark_downloaded_before_completion():
    lesson = make_lesson()
    calls = []
    lesson.download_ppt = lambda presentation_id: calls.append(presentation_id)

    message = {
        "op": "hello",
        "timeline": [
            {"type": "slide", "pres": "pres-1"},
            {"type": "slide", "pres": "pres-2"},
        ],
        "unlockedproblem": [],
    }

    lesson.on_message(DummyWebSocket(), json.dumps(message))

    assert set(calls) == {"pres-1", "pres-2"}
    assert len(calls) == 2
    assert lesson.downloaded_presentations == set()


def test_download_ppt_registers_refresh_callback_for_async_downloader(monkeypatch):
    lesson = make_lesson()
    lesson._async_download_manager = FakeAsyncDownloadManager({"total": 0, "successful": 0, "failed": 0, "success_list": [], "failed_list": []})

    class FakePPTManager:
        def __init__(self, data, lessonname):
            pass

        def get_missing_images(self):
            return []

        def generate_ppt(self):
            return "测试.pdf"

    monkeypatch.setattr(Classes, "PPTManager", FakePPTManager)
    lesson._start_ai_analysis = lambda *args, **kwargs: None

    lesson.download_ppt("presentation-123")

    assert lesson.async_download_manager.refresh_callbacks
    presentation_id, callback = lesson.async_download_manager.refresh_callbacks[0]
    assert presentation_id == "presentation-123"
    assert callback == lesson._get_ppt


def test_download_with_retry_counts_preexisting_valid_images_as_success(monkeypatch, tmp_path):
    manager = AsyncPPTDownloadManager(max_retries=1)
    slides = [
        {"index": 1, "cover": "https://example.com/1.jpg"},
        {"index": 2, "cover": "https://example.com/2.jpg"},
    ]
    (tmp_path / "1.jpg").write_bytes(b"valid image placeholder")

    monkeypatch.setattr(manager.downloader, "_is_valid_image", lambda path: path.endswith("1.jpg"))

    async def fake_download_image(session, slide, img_path):
        return {"success": True, "slide": slide, "path": os.path.join(img_path, f"{slide['index']}.jpg")}

    manager.downloader.download_image = fake_download_image

    result = asyncio.run(manager.download_with_retry(slides, str(tmp_path)))

    assert result["successful"] == 2
    assert result["failed"] == 0


def test_ppt_manager_start_does_not_generate_pdf_when_images_are_missing(monkeypatch):
    data = {
        "title": "缺图章节",
        "slides": [{"index": 1, "cover": ""}],
        "width": 800,
        "height": 600,
    }
    manager = PPTManager(data, "测试课程")

    monkeypatch.setattr(manager, "check_dir", lambda: None)
    monkeypatch.setattr(manager, "download", lambda: None)
    monkeypatch.setattr(manager, "get_missing_images", lambda: [{"index": 1, "cover": ""}])

    generated = []
    monkeypatch.setattr(manager, "generate_ppt", lambda: generated.append(True) or "缺图章节.pdf")

    pdf_name, use_time = manager.start()

    assert pdf_name is None
    assert use_time is None
    assert generated == []
