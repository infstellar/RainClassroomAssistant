import json
import os
import shutil
import smtplib
import sys
import threading
from copy import deepcopy
from email.message import EmailMessage
from math import exp

import pyttsx3
import requests
import urllib3
from numpy import random

if sys.platform.startswith("win"):
    import win32api
    import win32con
    try:
        from win10toast import ToastNotifier
        toaster = ToastNotifier()
        TOAST_AVAILABLE = True
    except ImportError:
        TOAST_AVAILABLE = False
        toaster = None
else:
    TOAST_AVAILABLE = False
    toaster = None

lock = threading.Lock()

AI_CONFIG_KEYS = (
    "enable_ai_analysis",
    "openai_api_key",
    "openai_api_base",
    "openai_model",
    "ai_analysis_settings",
)


def is_debug():
    # 判断是否为debug模式
    return True if sys.gettrace() else False


def say_something(text):
    # 带线程锁的语音函数
    lock.acquire()
    pyttsx3.speak(text)
    lock.release()


def show_info(text, title):
    # 安全的通知显示函数，带异常处理
    toast_success = False
    
    # 尝试显示Toast通知
    if TOAST_AVAILABLE and toaster:
        try:
            toaster.show_toast(
                title,
                text,
                icon_path=resource_path(r"UI\Image\favicon.ico"),
                duration=15,
                threaded=True,
            )
            toast_success = True
        except Exception as e:
            # 捕获所有Toast相关异常，包括WNDPROC和WPARAM错误
            print(f"Toast notification failed: {e}")
            toast_success = False
    
    # 如果Toast失败或不可用，使用MessageBox作为备用方案
    if not toast_success and sys.platform.startswith("win"):
        try:
            win32api.MessageBox(0, text, title, win32con.MB_OK)
        except Exception as e:
            print(f"MessageBox failed: {e}")
            # 最后的备用方案：控制台输出
            print(f"[{title}] {text}")


def get_email_config(config):
    return config.get("email_config", {}) if isinstance(config, dict) else {}


def is_email_notification_configured(config):
    email_config = get_email_config(config)
    required_keys = ("smtp_server", "username", "password", "recipient")
    return bool(
        email_config.get("enabled")
        and all(email_config.get(key) for key in required_keys)
    )


def send_email_notification(message, config):
    email_config = get_email_config(config)
    if not is_email_notification_configured(config):
        return False

    sender = email_config.get("sender") or email_config["username"]
    subject = email_config.get("subject") or "雨课堂助手通知"
    smtp_port = int(email_config.get("smtp_port") or 465)
    timeout = int(email_config.get("timeout") or 10)

    email_message = EmailMessage()
    email_message["Subject"] = subject
    email_message["From"] = sender
    email_message["To"] = email_config["recipient"]
    email_message.set_content(message)

    try:
        if email_config.get("use_ssl", True):
            smtp_client = smtplib.SMTP_SSL(
                email_config["smtp_server"],
                smtp_port,
                timeout=timeout,
            )
        else:
            smtp_client = smtplib.SMTP(
                email_config["smtp_server"],
                smtp_port,
                timeout=timeout,
            )
        with smtp_client as smtp:
            if not email_config.get("use_ssl", True) and email_config.get(
                "starttls",
                True,
            ):
                smtp.starttls()
            smtp.login(email_config["username"], email_config["password"])
            smtp.send_message(email_message)
        return True
    except Exception as e:
        print(f"Email notification failed: {e}")
        return False


def send_test_email_notification(config):
    message = "这是一封雨课堂助手测试邮件。收到此邮件表示邮件通知配置可用。"
    return send_email_notification(message, config)


def send_email_notification_if_needed(message, type, config):
    if type != 4 or not is_email_notification_configured(config):
        return False

    threading.Thread(
        target=send_email_notification,
        args=(message, config),
        daemon=True,
    ).start()
    return True


def dict_result(text):
    # json string 转 dict object
    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        preview = text[:200] if isinstance(text, str) else repr(text)
        raise ValueError(f"Invalid JSON response: {preview}") from e

    if not isinstance(result, dict):
        raise ValueError(f"Expected JSON object response, got {type(result).__name__}: {result}")

    return result


def test_network():
    # 网络状态测试
    try:
        http = urllib3.PoolManager()
        http.request("GET", "https://pro.yuketang.cn")
        return True
    except:
        return False


# 类泊松分布：答题等待时间
def lam(limit, percent=None):
    if percent == None:
        if limit == -1:
            lam = random.randint(5, 25)
        elif limit <= 30:
            lam = limit / 3
        elif limit >= 90:
            lam = limit / 2 - 30
        else:
            lam = limit / 5
    else:
        if limit == -1:
            lam = random.randint(5, 25)
        else:
            lam = limit * percent * 0.9 / 150
    return lam


def rand_poisson(lam):
    base = exp(-lam)
    sum = 1
    answer_time = 0
    while sum > base:
        sum = sum * random.random()
        answer_time += 1
    return min(answer_time, lam * 1.4)


def calculate_waittime(limit, type, custom_percent=50):
    # 计算答题等待时间
    """
    type
    1: 中庸
    2: 激进
    3: 保守
    4: 自定义
    """
    if limit == -1:
        limit = 60
    if type == 1:
        wait_time = rand_poisson(lam(limit, 65))
    elif type == 2:
        wait_time = rand_poisson(lam(limit, 35))
    elif type == 3:
        wait_time = limit * 0.6 + rand_poisson(lam(limit, 85)) * 0.4
    elif type == 4:
        wait_time = rand_poisson(lam(limit, custom_percent))
    if wait_time > limit:
        if __name__ == "__main__":
            raise Exception("Error: wait_time > limit")
        wait_time = limit - 25 # random.randint(int(limit * 0.25), int(limit * 0.75))
    return int(wait_time)


def merge_nested_dict(base, overrides):
    """递归合并字典，保留base中的默认值。"""
    merged = deepcopy(base)
    for key, value in overrides.items():
        if (
            key in merged
            and isinstance(merged[key], dict)
            and isinstance(value, dict)
        ):
            merged[key] = merge_nested_dict(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def merge_known_config(base_config, override_config):
    """仅合并已知配置项，避免把未知字段写回主配置。"""
    merged = deepcopy(base_config)
    for key, value in override_config.items():
        if key not in merged:
            continue
        if isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = merge_nested_dict(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def get_ai_config_paths():
    """返回ai_config.json的候选路径，按优先级排序。"""
    return [
        os.path.join(get_project_root(), "ai_config.json"),
        os.path.join(get_appdata_config_dir(), "ai_config.json"),
        os.path.abspath("ai_config.json"),
    ]


def load_ai_config():
    """加载ai_config.json，返回(配置字典, 配置路径)。"""
    for ai_config_path in get_ai_config_paths():
        if os.path.exists(ai_config_path):
            with open(ai_config_path, "r", encoding="utf-8") as f:
                return json.load(f), ai_config_path
    return None, None


def apply_ai_config_overrides(config, ai_config):
    """将AI配置覆盖到主配置，仅处理AI相关字段。"""
    merged = deepcopy(config)
    if not ai_config:
        return merged

    ai_overrides = {}
    for key in AI_CONFIG_KEYS:
        if key in ai_config:
            ai_overrides[key] = ai_config[key]

    return merge_known_config(merged, ai_overrides)


def get_initial_data(old_config=None):
    # 默认配置信息
    initial_data = {
        "sessionid": "",
        "region": "1",
        "auto_danmu": False,
        "danmu_config": {"danmu_limit": 5},
        "audio_on": True,
        "audio_config": {
            "audio_type": {
                "send_danmu": False,
                "others_danmu": False,
                "receive_problem": True,
                "answer_result": True,
                "im_called": True,
                "others_called": True,
                "course_info": True,
                "network_info": True,
            }
        },
        "auto_answer": True,
        "answer_config": {"answer_delay": {"type": 1, "custom": {"percent": 50}}},
        "email_config": {
            "enabled": False,
            "smtp_server": "",
            "smtp_port": 465,
            "username": "",
            "password": "",
            "sender": "",
            "recipient": "",
            "subject": "雨课堂助手通知",
            "use_ssl": True,
            "starttls": True,
            "timeout": 10,
        },
        "sign_config": {
            "delay_time": {"type": 1, "custom": {"time": 120, "cutoff": 120}}
        },
        # AI分析配置默认值
        "enable_ai_analysis": False,
        "openai_api_key": "",
        "openai_api_base": "https://api.openai.com/v1",
        "openai_model": "gpt-4-vision-preview",
        "ai_analysis_settings": {
            "max_retries": 3,
            "request_timeout": 30,
            "delay_between_requests": 1
        }
    }

    if old_config:
        initial_data = merge_known_config(initial_data, old_config)
    
    # 尝试加载AI配置文件
    try:
        ai_config, _ = load_ai_config()
        if ai_config:
            initial_data = apply_ai_config_overrides(initial_data, ai_config)
        else:
            print("未找到ai_config.json文件，使用默认AI配置")
            
    except Exception as e:
        print(f"加载AI配置文件失败: {e}")

    return initial_data


def get_config_path():
    # 获取配置文件路径
    config_dir = get_config_dir()
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "config.json")

    old_config_path = os.path.join(get_appdata_config_dir(), "config.json")
    if not os.path.exists(config_path) and os.path.exists(old_config_path):
        shutil.copy2(old_config_path, config_path)

    return config_path


def get_config_dir():
    # 获取配置文件所在文件夹
    return get_project_root()


def get_project_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_appdata_config_dir():
    # 获取旧版APPDATA配置文件所在文件夹
    appdata_route = os.environ["APPDATA"]
    return os.path.join(appdata_route, "RainClassroomAssistant")


def get_user_info(sessionid, region):
    # 获取用户信息
    headers = {
        "Cookie": "sessionid=%s" % sessionid,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:97.0) Gecko/20100101 Firefox/97.0",
    }
    r = requests.get(
        url=f"https://{get_host(region)}/api/v3/user/basic-info",
        headers=headers,
        proxies={"http": None, "https": None},
    )
    rtn = dict_result(r.text)
    return (rtn["code"], rtn["data"])


def get_on_lesson(sessionid, region):
    # 获取用户当前正在上课列表
    headers = {
        "Cookie": "sessionid=%s" % sessionid,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:97.0) Gecko/20100101 Firefox/97.0",
    }
    r = requests.get(
        f"https://{get_host(region)}/api/v3/classroom/on-lesson",
        headers=headers,
        proxies={"http": None, "https": None},
    )
    rtn = dict_result(r.text)
    return rtn["data"]["onLessonClassrooms"]


def get_on_lesson_old(sessionid, region):
    # 获取用户当前正在上课的列表（旧版）
    headers = {
        "Cookie": "sessionid=%s" % sessionid,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:97.0) Gecko/20100101 Firefox/97.0",
    }
    r = requests.get(
        f"https://{get_host(region)}/v/course_meta/on_lesson_courses",
        headers=headers,
        proxies={"http": None, "https": None},
    )
    rtn = dict_result(r.text)
    return rtn["on_lessons"]


def get_host(index):
    # 获取host
    host = [
        "www.yuketang.cn",
        "pro.yuketang.cn",
        "changjiang.yuketang.cn",
        "huanghe.yuketang.cn",
    ]
    return host[int(index)]


def get_name(index):
    # 获取host
    name = ["雨课堂", "荷塘雨课堂", "长江雨课堂", "黄河雨课堂"]
    return name[int(index)]


def resource_path(relative_path):
    # 解决打包exe的图片路径问题
    if getattr(sys, "frozen", False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


if __name__ == "__main__":
    x = []
    limit = 60
    percent = 95
    _type = 4
    if _type == 1:
        percent = 65
    elif _type == 2:
        percent = 35
    elif _type == 3:
        percent = 85
    lamb = lam(limit, percent)
    print(f"lam = {lamb}")
    _max = 0
    for i in range(100):
        x.append(calculate_waittime(limit, _type, percent))
        if x[i] > _max:
            _max = x[i]
        if x[i] > limit * percent / 100:
            print("error")
            print(x[i])
            break

    print(sum(x) / len(x))
    print(_max, _max / limit / percent * 100)
    show_info(
        f"x的问题没有找到答案，请在{calculate_waittime(limit, _type, percent)}秒内前往雨课堂回答",
        "Problem",
    )
