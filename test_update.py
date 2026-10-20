from unittest.mock import Mock

import pytest
import requests

from Scripts import Update as update_module


def test_source_version_uses_project_file_outside_working_directory(monkeypatch, tmp_path):
    project_root = tmp_path / "project"
    scripts_dir = project_root / "Scripts"
    scripts_dir.mkdir(parents=True)
    (project_root / "file_version_info.txt").write_text(
        "u'FileVersion', u'1.2.3'", encoding="utf-8"
    )
    monkeypatch.setattr(update_module, "__file__", str(scripts_dir / "Update.py"))
    monkeypatch.setattr(update_module.sys, "frozen", False, raising=False)
    monkeypatch.chdir(tmp_path)
    if update_module.sys.platform.startswith("win"):
        monkeypatch.setattr(
            update_module.win32api,
            "GetFileVersionInfo",
            Mock(side_effect=AssertionError("must not read the Python executable version")),
        )

    assert str(update_module.get_version()) == "1.2.3"


@pytest.mark.parametrize("version_text", ["v0.4.3\n", " 0.4.3\r\n"])
def test_version_check_reads_this_forks_release(monkeypatch, version_text):
    response = Mock(text=version_text)
    request = Mock(return_value=response)
    monkeypatch.setattr(update_module.requests, "get", request)

    updater = update_module.Update("./")
    assert str(updater.get_latest_version()) == "0.4.3"
    request.assert_called_once_with(
        "https://github.com/infstellar/RainClassroomAssistant/releases/latest/download/version.txt",
        timeout=10,
    )
    response.raise_for_status.assert_called_once_with()
    assert updater.get_url() == (
        "https://github.com/infstellar/RainClassroomAssistant/releases/latest/download/RainClassroomAssistant.exe"
    )


def test_missing_release_is_not_parsed_as_a_version(monkeypatch):
    response = Mock(text="Not Found")
    response.raise_for_status.side_effect = requests.HTTPError("404")
    monkeypatch.setattr(update_module.requests, "get", Mock(return_value=response))

    with pytest.raises(requests.HTTPError):
        update_module.Update("./").get_latest_version()


@pytest.mark.parametrize("error", [requests.Timeout, requests.exceptions.SSLError])
def test_failed_check_does_not_retry_without_tls_verification(monkeypatch, error):
    request = Mock(side_effect=error("connection failed"))
    monkeypatch.setattr(update_module.requests, "get", request)

    with pytest.raises(error):
        update_module.Update("./").get_latest_version()

    assert request.call_count == 1
    assert "verify" not in request.call_args.kwargs


def test_download_error_preserves_existing_update_file(monkeypatch, tmp_path):
    target = tmp_path / "_RainClassroomAssistant.exe"
    target.write_bytes(b"previous download")
    response = Mock(content=b"Not Found")
    response.raise_for_status.side_effect = requests.HTTPError("404")
    monkeypatch.setattr(update_module.requests, "get", Mock(return_value=response))

    with pytest.raises(requests.HTTPError):
        update_module.Update(str(tmp_path) + "/").download()

    assert target.read_bytes() == b"previous download"
