import sys
import threading
from pathlib import Path

from loguru import logger


_LOGGING_READY = False


def _default_log_dir():
    base = Path.home() / "AppData" / "Roaming" / "RainClassroomAssistant"
    return base / "logs"


def _install_exception_hooks():
    def handle_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            return
        logger.opt(exception=(exc_type, exc_value, exc_traceback)).error(
            "未捕获异常"
        )

    def handle_thread_exception(args):
        if issubclass(args.exc_type, KeyboardInterrupt):
            return
        logger.opt(exception=(args.exc_type, args.exc_value, args.exc_traceback)).error(
            "线程未捕获异常: thread={}", args.thread.name
        )

    sys.excepthook = handle_exception
    threading.excepthook = handle_thread_exception


def setup_logging(log_dir=None, enqueue=True):
    target_dir = Path(log_dir) if log_dir else _default_log_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    log_path = target_dir / "RainClassroomAssistant.log"

    logger.remove()
    logger.add(
        sys.stderr,
        level="INFO",
        enqueue=enqueue,
        backtrace=True,
        diagnose=True,
    )
    logger.add(
        log_path,
        level="INFO",
        encoding="utf-8",
        rotation="10 MB",
        retention="7 days",
        enqueue=enqueue,
        backtrace=True,
        diagnose=True,
    )
    logger.add(
        log_path.with_name("RainClassroomAssistant_error.log"),
        level="ERROR",
        encoding="utf-8",
        rotation="10 MB",
        retention="14 days",
        enqueue=enqueue,
        backtrace=True,
        diagnose=True,
    )
    _install_exception_hooks()

    return log_path
