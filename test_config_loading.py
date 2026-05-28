#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
配置加载回归测试

验证：
1. 已有config.json时，ai_config.json中的AI字段仍会覆盖应用
2. ai_analysis_settings会递归合并，而不是整块替换
3. 非AI字段不会被ai_config.json误覆盖
"""

import sys
import types

pyttsx3_stub = types.ModuleType("pyttsx3")
pyttsx3_stub.speak = lambda *args, **kwargs: None
sys.modules.setdefault("pyttsx3", pyttsx3_stub)
sys.modules.setdefault("win32api", types.ModuleType("win32api"))
sys.modules.setdefault("win32con", types.ModuleType("win32con"))

win10toast_stub = types.ModuleType("win10toast")


class _ToastNotifier:
    def show_toast(self, *args, **kwargs):
        return None


win10toast_stub.ToastNotifier = _ToastNotifier
sys.modules.setdefault("win10toast", win10toast_stub)

from Scripts import Utils
from Scripts.Utils import apply_ai_config_overrides, get_initial_data


def test_apply_ai_config_overrides():
    base_config = {
        "sessionid": "demo-session",
        "region": 0,
        "auto_answer": True,
        "enable_ai_analysis": False,
        "openai_api_key": "old-key",
        "openai_api_base": "https://api.openai.com/v1",
        "openai_model": "gpt-4-vision-preview",
        "ai_analysis_settings": {
            "max_retries": 3,
            "request_timeout": 30,
            "delay_between_requests": 1,
        },
    }
    ai_config = {
        "enable_ai_analysis": True,
        "openai_api_key": "new-key",
        "openai_api_base": "https://example.com/v1",
        "openai_model": "gpt-5.4",
        "ai_analysis_settings": {
            "request_timeout": 120,
        },
        "auto_answer": False,
    }

    merged = apply_ai_config_overrides(base_config, ai_config)

    assert merged["sessionid"] == "demo-session"
    assert merged["auto_answer"] is True
    assert merged["enable_ai_analysis"] is True
    assert merged["openai_api_key"] == "new-key"
    assert merged["openai_api_base"] == "https://example.com/v1"
    assert merged["openai_model"] == "gpt-5.4"
    assert merged["ai_analysis_settings"]["max_retries"] == 3
    assert merged["ai_analysis_settings"]["request_timeout"] == 120
    assert merged["ai_analysis_settings"]["delay_between_requests"] == 1


def test_get_initial_data_keeps_nested_defaults():
    old_config = {
        "audio_config": {
            "audio_type": {
                "send_danmu": True,
            }
        },
        "ai_analysis_settings": {
            "request_timeout": 60,
        },
    }

    merged = get_initial_data(old_config)

    assert merged["audio_config"]["audio_type"]["send_danmu"] is True
    assert "receive_problem" in merged["audio_config"]["audio_type"]
    assert merged["ai_analysis_settings"]["request_timeout"] in (60, 120)
    assert "max_retries" in merged["ai_analysis_settings"]
    assert "delay_between_requests" in merged["ai_analysis_settings"]


def test_config_path_defaults_to_project_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(Utils, "get_project_root", lambda: str(tmp_path))

    assert Utils.get_config_dir() == str(tmp_path)
    assert Utils.get_config_path() == str(tmp_path / "config.json")


def test_get_config_path_migrates_existing_appdata_config(monkeypatch, tmp_path):
    project_root = tmp_path / "project"
    appdata_root = tmp_path / "appdata"
    old_config_dir = appdata_root / "RainClassroomAssistant"
    old_config_dir.mkdir(parents=True)
    old_config_path = old_config_dir / "config.json"
    old_config_path.write_text('{"sessionid":"old-session"}', encoding="utf-8")

    monkeypatch.setattr(Utils, "get_project_root", lambda: str(project_root))
    monkeypatch.setenv("APPDATA", str(appdata_root))

    config_path = Utils.get_config_path()

    assert config_path == str(project_root / "config.json")
    assert (project_root / "config.json").read_text(encoding="utf-8") == '{"sessionid":"old-session"}'


if __name__ == "__main__":
    test_apply_ai_config_overrides()
    test_get_initial_data_keeps_nested_defaults()
    print("配置加载回归测试通过")
