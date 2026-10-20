#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
配置加载回归测试

验证：
1. AI参数统一来自config.json，旧的独立配置文件不再生效
2. ai_analysis_settings会递归合并，而不是整块替换
3. 主配置路径及旧版APPDATA主配置迁移保持正常
"""

import json
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
from Scripts.Utils import get_initial_data


def test_get_initial_data_preserves_main_config():
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
            "reasoning_effort": "high",
            "request_timeout": 30,
            "delay_between_requests": 1,
        },
    }
    merged = get_initial_data(base_config)

    for key, value in base_config.items():
        if key == "ai_analysis_settings":
            for setting, setting_value in value.items():
                assert merged[key][setting] == setting_value
        else:
            assert merged[key] == value


def test_legacy_ai_config_is_ignored(monkeypatch, tmp_path):
    project_root = tmp_path / "project"
    appdata_root = tmp_path / "appdata"
    working_dir = tmp_path / "working"
    for directory in (project_root, appdata_root / "RainClassroomAssistant", working_dir):
        directory.mkdir(parents=True)
        (directory / "ai_config.json").write_text(json.dumps({
            "enable_ai_analysis": True,
            "openai_api_key": "legacy-key",
            "openai_model": "legacy-model",
            "ai_analysis_settings": {"request_timeout": 120},
        }), encoding="utf-8")
    monkeypatch.setattr(Utils, "get_project_root", lambda: str(project_root))
    monkeypatch.setenv("APPDATA", str(appdata_root))
    monkeypatch.chdir(working_dir)
    main_config = {
        "enable_ai_analysis": False,
        "openai_api_key": "main-key",
        "openai_model": "main-model",
        "ai_analysis_settings": {"request_timeout": 60},
    }
    config_path = project_root / "config.json"
    config_path.write_text(json.dumps(main_config), encoding="utf-8")
    merged = get_initial_data(json.loads(config_path.read_text(encoding="utf-8")))

    assert merged["enable_ai_analysis"] is False
    assert merged["openai_api_key"] == "main-key"
    assert merged["openai_model"] == "main-model"
    assert merged["ai_analysis_settings"]["request_timeout"] == 60
    defaults = get_initial_data()
    assert defaults["enable_ai_analysis"] is False
    assert defaults["openai_api_key"] == ""


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
    assert merged["ai_analysis_settings"]["request_timeout"] == 60
    assert "max_retries" in merged["ai_analysis_settings"]
    assert "delay_between_requests" in merged["ai_analysis_settings"]


def test_config_path_defaults_to_project_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(Utils, "get_project_root", lambda: str(tmp_path))

    assert Utils.get_config_dir() == str(tmp_path)
    assert Utils.get_config_path() == str(tmp_path / "config.json")


def test_ai_stream_settings_survive_config_merge():
    merged = get_initial_data({
        "ai_analysis_settings": {
            "stream": False, "reasoning_summary": None, "max_output_tokens": 32768,
            "reasoning_effort": "low",
        },
    })
    assert merged["ai_analysis_settings"]["stream"] is False
    assert merged["ai_analysis_settings"]["reasoning_summary"] is None
    assert merged["ai_analysis_settings"]["max_output_tokens"] == 32768
    assert merged["ai_analysis_settings"]["reasoning_effort"] == "low"


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
    test_get_initial_data_preserves_main_config()
    test_get_initial_data_keeps_nested_defaults()
    test_ai_stream_settings_survive_config_merge()
    print("配置加载回归测试通过")
