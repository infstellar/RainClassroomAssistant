import asyncio
import os

import pytest
from PIL import Image

from Scripts.AsyncDownloader import AsyncPPTDownloadManager
from Scripts.PathUtils import normalize_path_component
from Scripts.PPTManager import PPTManager


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        (
            "Intelligence Engineering: Design and Manufacturing II",
            "Intelligence Engineering_ Design and Manufacturing II",
        ),
        ('章节<>:"/\\|?*', "章节_________"),
        ("章节\x00\x01\x1f\n\t", "章节_____"),
        ("  课程名称. .  ", "课程名称"),
        ("", "未知演示文稿"),
        (" . . ", "未知演示文稿"),
        ("..", "未知演示文稿"),
        ("CON", "_CON"),
        ("nul.txt", "_nul.txt"),
        ("PRN", "_PRN"),
        ("AUX", "_AUX"),
        ("com1", "_com1"),
        ("LPT9.pdf", "_LPT9.pdf"),
        ("COM¹", "_COM¹"),
        ("LPT²", "_LPT²"),
        ("COM10", "COM10"),
        ("中文课程 II (2026) + Design—制造", "中文课程 II (2026) + Design—制造"),
        (r"..\课程/章节", ".._课程_章节"),
    ],
)
def test_normalize_path_component(name, expected):
    normalized = normalize_path_component(name)
    assert normalized == expected
    assert normalize_path_component(normalized) == normalized


@pytest.mark.parametrize(
    ("lesson_name", "title", "safe_lesson", "safe_title"),
    [
        (
            "Intelligence Engineering: Design and Manufacturing II",
            '章节: 设计/制造\\实验?*<>|"',
            "Intelligence Engineering_ Design and Manufacturing II",
            "章节_ 设计_制造_实验______",
        ),
        ("  测试课程. ", "  测试章节. ", "测试课程", "测试章节"),
        (" . ", "..", "未知课程", "未知演示文稿"),
        ("NUL", "COM1.pdf", "_NUL", "_COM1.pdf"),
        ("普通课程", "普通章节", "普通课程", "普通章节"),
    ],
)
def test_download_and_ppt_manager_share_normalized_cache(
    monkeypatch, tmp_path, lesson_name, title, safe_lesson, safe_title
):
    monkeypatch.chdir(tmp_path)
    data = {
        "title": title,
        "slides": [{"index": 1, "cover": "https://example.invalid/1.jpg"}],
        "width": 32,
        "height": 24,
    }
    ppt_manager = PPTManager(data, lesson_name)
    download_manager = AsyncPPTDownloadManager()
    expected_path = os.path.join("downloads", "rainclasscache", safe_lesson, safe_title)
    calls = []

    async def fake_download(slides, img_path):
        calls.append(img_path)
        assert img_path == expected_path
        assert os.path.isdir(img_path)
        Image.new("RGB", (32, 24)).save(os.path.join(img_path, "1.jpg"))
        return {"total": 1, "successful": 1, "failed": 0, "skipped": 0}

    monkeypatch.setattr(download_manager, "download_with_retry", fake_download)
    try:
        assert ppt_manager.imgpath == expected_path
        assert ppt_manager.lessondownloadpath == os.path.join("downloads", safe_lesson)
        assert ppt_manager.get_missing_images() == data["slides"]

        result = asyncio.run(download_manager.download_presentation(data, lesson_name))
        assert result["successful"] == 1
        assert ppt_manager.get_missing_images() == []

        result = asyncio.run(download_manager.download_presentation(data, lesson_name))
        assert result["skipped"] == 1
        assert calls == [expected_path]
        assert data["title"] == title
    finally:
        ppt_manager._executor.shutdown(wait=True)


def test_empty_presentation_creates_normalized_directory(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    manager = AsyncPPTDownloadManager()
    result = asyncio.run(manager.download_presentation({"slides": []}, " . "))
    assert result["total"] == 0
    assert (tmp_path / "downloads" / "rainclasscache" / "未知课程" / "未知演示文稿").is_dir()
