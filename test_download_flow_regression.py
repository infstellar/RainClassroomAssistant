import asyncio
import json
import os
import sys
import threading
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
from Scripts.AsyncDownloader import AsyncImageDownloader, AsyncPPTDownloadManager
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


def test_download_slides_does_not_require_loguru(monkeypatch, tmp_path):
    downloader = AsyncImageDownloader(max_concurrent=1, max_retries=1)
    monkeypatch.delitem(sys.modules, "loguru", raising=False)
    monkeypatch.setattr(downloader, "_is_valid_image", lambda path: False)

    async def fake_download_image(session, slide, img_path):
        return {"success": False, "slide": slide, "error": "simulated failure"}

    downloader.download_image = fake_download_image

    result = asyncio.run(
        downloader.download_slides(
            [{"index": 1, "cover": "https://example.com/1.jpg"}],
            str(tmp_path),
        )
    )

    assert result["failed"] == 1


def test_async_image_downloader_uses_event_loop_local_semaphores():
    downloader = AsyncImageDownloader(max_concurrent=2)

    async def get_semaphore():
        return downloader.semaphore

    first_loop = asyncio.new_event_loop()
    try:
        first = first_loop.run_until_complete(get_semaphore())
    finally:
        first_loop.close()

    second_loop = asyncio.new_event_loop()
    try:
        second = second_loop.run_until_complete(get_semaphore())
    finally:
        second_loop.close()

    assert first is not second


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


def test_presentationupdated_forces_redownload_even_if_already_downloaded():
    lesson = make_lesson()
    lesson.downloaded_presentations = {"pres-1"}

    calls = []
    lesson.download_ppt = lambda presentation_id, force_refresh=False: calls.append(
        (presentation_id, force_refresh)
    )

    message = {
        "op": "presentationupdated",
        "presentation": "pres-1",
    }

    lesson.on_message(DummyWebSocket(), json.dumps(message))

    assert calls == [("pres-1", True)]


def test_force_refresh_clears_cached_images_before_downloading(monkeypatch, tmp_path):
    lesson = make_lesson()
    lesson._executor = ImmediateExecutor()
    lesson._async_download_manager = FakeAsyncDownloadManager(
        {
            "total": 1,
            "successful": 1,
            "failed": 0,
            "success_list": [{"slide": {"index": 1}}],
            "failed_list": [],
        }
    )
    lesson._get_ppt = lambda presentation_id: {
        "title": "更新后的章节",
        "slides": [{"index": 1, "cover": "https://example.com/1.jpg"}],
        "width": 800,
        "height": 600,
    }

    cache_root = tmp_path / "downloads"
    cache_dir = cache_root / "rainclasscache" / "测试课程" / "更新后的章节"
    cache_dir.mkdir(parents=True)
    cached_file = cache_dir / "1.jpg"
    cached_file.write_bytes(b"old image")

    deleted = []

    class FakePPTManager:
        def __init__(self, data, lessonname):
            self.data = data
            self.lessonname = lessonname
            self.imgpath = str(cache_dir)

        def delete_cache(self):
            deleted.append("delete_cache")
            for entry in cache_dir.iterdir():
                if entry.is_file():
                    entry.unlink()

        def get_missing_images(self):
            return []

        def generate_ppt(self):
            return "更新后的章节.pdf"

    monkeypatch.setattr(Classes, "PPTManager", FakePPTManager)
    monkeypatch.chdir(tmp_path)
    lesson.download_ppt("pres-1", force_refresh=True)

    assert deleted == ["delete_cache"]
    assert not cached_file.exists()


def test_ai_analysis_prefers_timeline_problem_page_over_fetch_index(monkeypatch, tmp_path):
    lesson = make_lesson()
    lesson.config["enable_ai_analysis"] = True
    lesson.problem_display_indexes = {"problem-1": 9}

    analyzed = []

    class FakeAIAnalyzer:
        def analyze_presentation(self, lesson_name, presentation_title, slides_data, img_cache_path, callback=None):
            problem_slides = [slide for slide in slides_data if "problem" in slide]
            for slide in problem_slides:
                analyzed.append((slide["index"], os.path.exists(os.path.join(img_cache_path, f"{slide['index']}.jpg"))))
            answers = {str(slide["index"]): ["answer"] for slide in problem_slides}
            if callback:
                callback(lesson_name, presentation_title, answers)
            return answers

    lesson._ai_analyzer = FakeAIAnalyzer()

    class FakePPTManager:
        imgpath = str(tmp_path)

    (tmp_path / "9.jpg").write_bytes(b"image")

    data = {
        "title": "测试章节",
        "slides": [
            {
                "index": 10,
                "id": "problem-1",
                "problem": {
                    "problemId": "problem-1",
                    "answers": [],
                },
            }
        ],
    }

    lesson._start_ai_analysis(data, FakePPTManager())

    assert data["slides"][0]["index"] == 9
    assert analyzed == [(9, True)]


def test_get_problems_uses_timeline_problem_id_display_index():
    lesson = make_lesson()
    del lesson.get_problems
    lesson._get_ppt = lambda presentation_id: {
        "title": "测试章节",
        "slides": [
            {
                "index": 10,
                "id": "problem-1",
                "problem": {
                    "problemId": "problem-1",
                    "answers": ["A"],
                },
            }
        ],
    }

    lesson._record_problem_display_indexes(
        [{"type": "problem", "prob": "problem-1", "sid": "problem-1", "si": 9}]
    )

    problems = lesson.get_problems("pres-1")

    assert problems[0]["index"] == 9
    assert lesson.problem_display_indexes == {"problem-1": 9}


def test_get_problems_matches_any_problem_or_slide_identifier():
    lesson = make_lesson()
    del lesson.get_problems
    lesson._get_ppt = lambda presentation_id: {
        "title": "测试章节",
        "slides": [
            {
                "index": 10,
                "id": "slide-1",
                "problem": {
                    "id": "internal-problem-record",
                    "answers": ["A"],
                },
            }
        ],
    }

    lesson._record_problem_display_indexes(
        [{"type": "problem", "prob": "problem-1", "sid": "slide-1", "si": 9}]
    )

    problems = lesson.get_problems("pres-1")

    assert problems[0]["index"] == 9


def test_async_download_uses_timeline_problem_page_for_pdf_generation(monkeypatch):
    lesson = make_lesson()
    lesson._async_download_manager = FakeAsyncDownloadManager(
        {
            "total": 1,
            "successful": 1,
            "failed": 0,
            "success_list": [{"slide": {"index": 9}}],
            "failed_list": [],
        }
    )
    lesson._record_problem_display_indexes(
        [{"type": "problem", "prob": "problem-1", "sid": "slide-problem", "si": 9}]
    )

    generated_slide_indexes = []
    downloaded_slide_indexes = []

    class FakePPTManager:
        def __init__(self, data, lessonname):
            self.slides = data["slides"]
            self.imgpath = "cache"

        def get_missing_images(self):
            return []

        def generate_ppt(self):
            generated_slide_indexes.extend(slide["index"] for slide in self.slides)
            return "测试章节.pdf"

    async def fake_download_presentation(data, lessonname):
        downloaded_slide_indexes.extend(slide["index"] for slide in data["slides"])
        return {
            "total": len(data["slides"]),
            "successful": len(data["slides"]),
            "failed": 0,
            "success_list": [{"slide": slide} for slide in data["slides"]],
            "failed_list": [],
        }

    monkeypatch.setattr(Classes, "PPTManager", FakePPTManager)
    lesson.async_download_manager.download_presentation = fake_download_presentation

    data = {
        "title": "测试章节",
        "slides": [
            {"index": 8, "id": "slide-8", "cover": "https://example.com/8.jpg"},
            {"index": 9, "id": "stale-slide-9", "cover": "https://example.com/9.jpg"},
            {
                "index": 10,
                "id": "slide-problem",
                "cover": "https://example.com/problem.jpg",
                "problem": {"problemId": "problem-1", "answers": ["A"]},
            },
        ],
        "width": 800,
        "height": 600,
    }

    asyncio.run(lesson._async_download(data, "pres-1"))

    assert downloaded_slide_indexes == [8, 9]
    assert generated_slide_indexes == [8, 9]
    assert data["slides"][1]["id"] == "slide-problem"


def test_start_answer_matches_problem_by_slide_identifier(monkeypatch):
    lesson = make_lesson()
    lesson.config["answer_config"] = {
        "answer_delay": {
            "type": 1,
            "custom": {"percent": 50},
        }
    }
    lesson.problems_ls = [
        {
            "problemId": "problem-1",
            "slideId": "slide-1",
            "problemType": 1,
            "answers": [2],
            "result": None,
        }
    ]

    calls = []
    lesson.answer_questions = lambda *args: calls.append(args)

    class ImmediateThread:
        def __init__(self, target, args=()):
            self.target = target
            self.args = args

        def start(self):
            self.target(*self.args)

    monkeypatch.setattr(threading, "Thread", ImmediateThread)

    lesson.start_answer("slide-1", 60)

    assert calls == [("problem-1", 1, [2], 60)]


def test_get_problems_carries_slide_identifiers_for_unlockproblem_lookup():
    lesson = make_lesson()
    del lesson.get_problems
    lesson._get_ppt = lambda presentation_id: {
        "title": "测试章节",
        "slides": [
            {
                "index": 9,
                "id": "slide-1",
                "slideId": "slide-alt-1",
                "problem": {
                    "problemId": "problem-1",
                    "answers": ["A"],
                },
            }
        ],
    }

    problems = lesson.get_problems("pres-1")

    assert problems[0]["slideId"] == "slide-1"
    assert problems[0]["slideIds"] == ["slide-1", "slide-alt-1"]
