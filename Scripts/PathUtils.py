"""课程和演示文稿名称的文件系统归一化。"""

import re


_INVALID_PATH_CHARACTERS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_NAME = re.compile(
    r"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$", re.IGNORECASE
)


def normalize_path_component(name: str, default: str = "未知演示文稿") -> str:
    """归一化单个目录/文件名称，保留中文和合法符号，不处理完整路径。"""
    normalized = _INVALID_PATH_CHARACTERS.sub("_", name).strip().rstrip(" .")
    if not normalized:
        return default
    # Windows 保留设备名即使带扩展名也不可用。
    if _WINDOWS_RESERVED_NAME.fullmatch(normalized.split(".", 1)[0].rstrip(" ")):
        normalized = "_" + normalized
    return normalized
