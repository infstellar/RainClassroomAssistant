# -*- coding: utf-8 -*-
"""应用设置：按用途展示主配置中的全部参数。"""

import functools
import json
import os
import tempfile
from copy import deepcopy

from PyQt5 import QtCore, QtGui, QtWidgets

from Scripts.Utils import (
    get_config_path,
    get_initial_data,
    merge_nested_dict,
    resource_path,
    send_test_email_notification,
)


class Config_Ui(object):
    def setupUi(self, Dialog):
        Dialog.setObjectName("ConfigDialog")
        Dialog.setWindowTitle("设置")
        Dialog.resize(720, 740)
        Dialog.setMinimumSize(540, 440)
        Dialog.setWindowIcon(QtGui.QIcon(resource_path("UI\\Image\\favicon.ico")))
        Dialog.setStyleSheet('font: 9pt "微软雅黑";')
        self.fields = {}
        self.dialog_config = get_initial_data()
        layout = QtWidgets.QVBoxLayout(Dialog)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)
        self.tabs = QtWidgets.QTabWidget(Dialog)
        layout.addWidget(self.tabs)

        self._setup_classroom_page()
        self._setup_notifications_page()
        self._setup_ai_page()
        self._setup_account_page()

        notice = QtWidgets.QLabel(
            "保存后用于新建的课程任务；已在运行的任务请停止监听后重新启动。"
            "修改登录信息后请重启应用。",
            Dialog,
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        buttons = QtWidgets.QDialogButtonBox(Dialog)
        self.save = buttons.addButton("保存", QtWidgets.QDialogButtonBox.AcceptRole)
        self.cancel = buttons.addButton("取消", QtWidgets.QDialogButtonBox.RejectRole)
        self.save.setDefault(True)
        buttons.accepted.connect(functools.partial(self.save_config, dialog=Dialog))
        buttons.rejected.connect(Dialog.reject)
        layout.addWidget(buttons)
        self.load_config(self.dialog_config)

    def _page(self, title):
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAlwaysOff)
        content = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(content)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(16)
        layout.setAlignment(QtCore.Qt.AlignTop)
        scroll.setWidget(content)
        self.tabs.addTab(scroll, title)
        return layout

    @staticmethod
    def _group(layout, title):
        group = QtWidgets.QGroupBox(title)
        inner = QtWidgets.QVBoxLayout(group)
        inner.setSpacing(10)
        layout.addWidget(group)
        return inner

    @staticmethod
    def _form(layout):
        widget = QtWidgets.QWidget()
        form = QtWidgets.QFormLayout(widget)
        form.setContentsMargins(0, 0, 0, 0)
        form.setFieldGrowthPolicy(QtWidgets.QFormLayout.AllNonFixedFieldsGrow)
        form.setRowWrapPolicy(QtWidgets.QFormLayout.WrapLongRows)
        form.setVerticalSpacing(10)
        layout.addWidget(widget)
        return widget, form

    @staticmethod
    def _hint(layout, text):
        label = QtWidgets.QLabel(text)
        label.setWordWrap(True)
        label.setStyleSheet("color: #596579;")
        layout.addWidget(label)
        return label

    def _bind(self, path, widget):
        widget.setObjectName(path.replace(".", "_"))
        self.fields[path] = widget
        return widget

    def _check(self, layout, path, text):
        widget = self._bind(path, QtWidgets.QCheckBox(text))
        layout.addWidget(widget)
        return widget

    def _text(self, form, path, label, placeholder="", secret=False):
        widget = self._bind(path, QtWidgets.QLineEdit())
        widget.setAccessibleName(label)
        widget.setPlaceholderText(placeholder)
        if secret:
            widget.setEchoMode(QtWidgets.QLineEdit.Password)
        form.addRow(label, widget)
        return widget

    def _number(
        self, form, path, label, minimum=0, maximum=2147483647, suffix="", decimal=False
    ):
        cls = QtWidgets.QDoubleSpinBox if decimal else QtWidgets.QSpinBox
        widget = self._bind(path, cls())
        widget.setAccessibleName(label)
        if decimal:
            widget.setDecimals(3)
            widget.setSingleStep(0.5)
        widget.setRange(minimum, maximum)
        widget.setSuffix(suffix)
        form.addRow(label, widget)
        return widget

    def _combo(self, form, path, label, choices, editable=False):
        widget = self._bind(path, QtWidgets.QComboBox())
        widget.setAccessibleName(label)
        for text, value in choices:
            widget.addItem(text, value)
        widget.setEditable(editable)
        widget.setInsertPolicy(QtWidgets.QComboBox.NoInsert)
        form.addRow(label, widget)
        return widget

    def _setup_classroom_page(self):
        page = self._page("课堂自动化")
        sign = self._group(page, "自动签到")
        _, form = self._form(sign)
        self.sign_delay_type = self._combo(
            form,
            "sign_config.delay_time.type",
            "签到延迟",
            [("自定义随机延迟", 1), ("不延时", 2)],
        )
        self.when_delay_time, form = self._form(sign)
        self.delay_time_input = self._number(
            form,
            "sign_config.delay_time.custom.time",
            "随机延迟上限",
            suffix=" 秒",
        )
        self.cutoff_time_input = self._number(
            form,
            "sign_config.delay_time.custom.cutoff",
            "延迟生效窗口",
            suffix=" 秒",
        )
        self._hint(sign, "随机延迟从 10 秒起算；仅在课程开始后的生效窗口内使用延迟。")
        self.sign_delay_type.currentIndexChanged.connect(self.enable_delay_sign_custom)

        answer = self._group(page, "自动答题")
        self.answer_on = self._check(answer, "auto_answer", "启用自动答题")
        self.when_answer_on, form = self._form(answer)
        self.answer_delay_type = self._combo(
            form,
            "answer_config.answer_delay.type",
            "答题延迟策略",
            [("中庸", 1), ("激进", 2), ("保守", 3), ("自定义", 4)],
        )
        self.delay_time_4_input = self._number(
            form,
            "answer_config.answer_delay.custom.percent",
            "自定义延迟比例",
            maximum=100,
            suffix=" %",
        )
        self._hint(
            answer, "延迟按题目时限和所选策略计算；自定义比例仅在选择“自定义”时生效。"
        )
        self.answer_on.toggled.connect(self.enable_answer_config)
        self.answer_delay_type.currentIndexChanged.connect(self.enable_delay_custom)

        danmu = self._group(page, "自动弹幕")
        self.danmu_on = self._check(danmu, "auto_danmu", "启用自动发送弹幕")
        self.when_danmu_on, form = self._form(danmu)
        self.danmu_spinBox = self._number(
            form,
            "danmu_config.danmu_limit",
            "每分钟触发阈值",
            minimum=1,
            suffix=" 条",
        )
        self._hint(danmu, "每分钟收到达到阈值的相同弹幕后，自动发送该弹幕。")
        self.danmu_on.toggled.connect(self.enable_danmu_config)

    def _setup_notifications_page(self):
        page = self._page("提醒通知")
        audio = self._group(page, "语音提醒")
        self.audio_on = self._check(audio, "audio_on", "启用语音提醒")
        self.when_audio_on = QtWidgets.QWidget()
        audio.addWidget(self.when_audio_on)
        grid = QtWidgets.QGridLayout(self.when_audio_on)
        grid.setContentsMargins(0, 0, 0, 0)
        audio_types = [
            ("send_danmu", "自动发送弹幕", "self_danmu"),
            ("others_danmu", "他人发送弹幕", "others_danmu"),
            ("receive_problem", "收到题目", "receive_problem"),
            ("answer_result", "自动答题情况", "answer_result"),
            ("im_called", "自己被点名", "self_called"),
            ("others_called", "他人被点名", "others_called"),
            ("course_info", "课程相关信息", "course"),
            ("network_info", "网络断开 / 重连", "network"),
        ]
        for index, (key, title, attribute) in enumerate(audio_types):
            widget = self._bind(
                "audio_config.audio_type." + key, QtWidgets.QCheckBox(title)
            )
            setattr(self, attribute, widget)
            grid.addWidget(widget, index // 2, index % 2)
        self.audio_on.toggled.connect(self.enable_audio_config)

        email = self._group(page, "邮件通知")
        self.email_on = self._check(email, "email_config.enabled", "启用邮件通知")
        self.email_details, form = self._form(email)
        self._text(form, "email_config.smtp_server", "SMTP 服务器", "smtp.example.com")
        self._number(
            form, "email_config.smtp_port", "SMTP 端口", minimum=1, maximum=65535
        )
        self._text(form, "email_config.username", "登录账号", "sender@example.com")
        self.email_password = self._text(
            form,
            "email_config.password",
            "密码 / 授权码",
            "邮箱服务商提供的授权码",
            secret=True,
        )
        self._text(form, "email_config.sender", "发件地址", "留空则使用登录账号")
        self._text(form, "email_config.recipient", "收件地址", "receiver@example.com")
        self._text(form, "email_config.subject", "邮件主题", "留空则使用默认主题")
        self.email_ssl = self._bind(
            "email_config.use_ssl", QtWidgets.QCheckBox("使用 SSL 直连")
        )
        form.addRow("传输加密", self.email_ssl)
        self.email_starttls = self._bind(
            "email_config.starttls", QtWidgets.QCheckBox("启用 STARTTLS")
        )
        self.email_starttls.setToolTip("仅在不使用 SSL 直连时生效；两个选项分别保留。")
        form.addRow("连接后升级加密", self.email_starttls)
        self._number(form, "email_config.timeout", "连接超时", minimum=1, suffix=" 秒")
        self._hint(
            email, "自动答题成功、失败或未找到答案时发送邮件。多数邮箱需填写授权码。"
        )
        self.test_email_btn = QtWidgets.QPushButton(
            "发送测试邮件（使用当前填写的配置）"
        )
        self.test_email_btn.setAutoDefault(False)
        email.addWidget(self.test_email_btn)
        self.test_email_btn.clicked.connect(
            functools.partial(self.test_email, parent=self.tabs.window())
        )
        self.email_on.toggled.connect(self._update_email_controls)
        self.email_ssl.toggled.connect(self._update_email_controls)

    def _setup_ai_page(self):
        page = self._page("AI 分析")
        ai = self._group(page, "AI 接口")
        self.ai_on = self._check(ai, "enable_ai_analysis", "启用 AI 答案分析")
        self.ai_details, form = self._form(ai)
        self.api_key = self._text(
            form, "openai_api_key", "API 密钥", "填写服务商提供的密钥", secret=True
        )
        self._text(form, "openai_api_base", "API 基础地址", "https://api.openai.com/v1")
        self._text(form, "openai_model", "模型名称", "填写服务商支持的模型 ID")
        self.ai_protocol = self._combo(
            form,
            "ai_analysis_settings.protocol",
            "接口协议",
            [("Responses", "responses"), ("Chat Completions", "chat_completions")],
        )
        self._hint(
            ai, "使用当前模型和服务商支持的参数；AI 分析开关独立于自动答题开关。"
        )

        requests = self._group(page, "请求与生成参数")
        self.ai_request_details, form = self._form(requests)
        stream = self._bind(
            "ai_analysis_settings.stream", QtWidgets.QCheckBox("逐事件读取生成结果")
        )
        form.addRow("流式响应", stream)
        self.reasoning_effort = self._combo(
            form,
            "ai_analysis_settings.reasoning_effort",
            "推理强度",
            [
                (value, value)
                for value in (
                    "none",
                    "minimal",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max",
                    "ultra",
                )
            ],
            editable=True,
        )
        self.reasoning_summary = self._combo(
            form,
            "ai_analysis_settings.reasoning_summary",
            "推理摘要",
            [
                ("不请求摘要（null）", None),
                ("自动（auto）", "auto"),
                ("简短（concise）", "concise"),
                ("详细（detailed）", "detailed"),
            ],
            editable=True,
        )
        output_tokens = self._number(
            form, "ai_analysis_settings.max_output_tokens", "输出 token 上限"
        )
        output_tokens.setSpecialValueText("接口默认（null）")
        output_tokens.setToolTip(
            "0 保存为 null，使用接口默认上限；正整数同时计入推理和最终答案。"
        )
        self._number(
            form, "ai_analysis_settings.max_retries", "失败后最大重试次数", suffix=" 次"
        )
        self._number(
            form,
            "ai_analysis_settings.request_timeout",
            "请求超时",
            minimum=0.001,
            suffix=" 秒",
            decimal=True,
        )
        self._number(
            form,
            "ai_analysis_settings.delay_between_requests",
            "请求间隔",
            suffix=" 秒",
            decimal=True,
        )
        self._hint(
            requests,
            "推理强度与摘要仅用于 Responses 协议，可直接输入服务商支持的值。"
            "输出上限为 0 时保存为 null；流式超时是连接 / 读取等待时间。",
        )
        self.ai_on.toggled.connect(self._update_ai_controls)
        self.ai_protocol.currentIndexChanged.connect(self._update_ai_controls)

    def _setup_account_page(self):
        page = self._page("登录与平台")
        account = self._group(page, "登录配置")
        self._hint(
            account,
            "一般通过主窗口的登录按钮扫码登录即可。这里支持手动更新平台和会话，"
            "会话必须与所选平台匹配，保存后重启应用生效。",
        )
        _, form = self._form(account)
        self._combo(
            form,
            "region",
            "雨课堂平台",
            [
                ("雨课堂", 0),
                ("荷塘雨课堂", 1),
                ("长江雨课堂", 2),
                ("黄河雨课堂", 3),
            ],
        )
        self.sessionid = self._text(
            form, "sessionid", "会话 sessionid", "扫码登录时自动填写", secret=True
        )
        self.show_secrets = QtWidgets.QCheckBox("显示密钥、邮箱密码和会话内容")
        account.addWidget(self.show_secrets)
        self.show_secrets.toggled.connect(self._toggle_secrets)

    def _toggle_secrets(self, visible):
        mode = QtWidgets.QLineEdit.Normal if visible else QtWidgets.QLineEdit.Password
        for widget in (self.api_key, self.email_password, self.sessionid):
            widget.setEchoMode(mode)

    def enable_danmu_config(self):
        self.when_danmu_on.setEnabled(self.danmu_on.isChecked())

    def enable_audio_config(self):
        self.when_audio_on.setEnabled(self.audio_on.isChecked())

    def enable_answer_config(self):
        self.when_answer_on.setEnabled(self.answer_on.isChecked())
        self.enable_delay_custom()

    def enable_delay_sign_custom(self):
        self.when_delay_time.setEnabled(self.sign_delay_type.currentData() == 1)

    def enable_delay_custom(self):
        self.delay_time_4_input.setEnabled(self.answer_delay_type.currentData() == 4)

    def _update_email_controls(self):
        self.email_details.setEnabled(self.email_on.isChecked())
        self.email_starttls.setEnabled(not self.email_ssl.isChecked())
        self.test_email_btn.setEnabled(self.email_on.isChecked())

    def _update_ai_controls(self):
        enabled = self.ai_on.isChecked()
        self.ai_details.setEnabled(enabled)
        self.ai_request_details.setEnabled(enabled)
        responses = self.ai_protocol.currentData() == "responses"
        self.reasoning_effort.setEnabled(responses)
        self.reasoning_summary.setEnabled(responses)

    def load_config(self, config):
        # 在副本上补齐旧版本缺少的字段，取消或测试邮件均不修改运行中的配置。
        self.dialog_config = merge_nested_dict(get_initial_data(), config)
        self.show_secrets.setChecked(False)
        self._toggle_secrets(False)
        for path, widget in self.fields.items():
            value = self.dialog_config
            for key in path.split("."):
                value = value[key]
            if isinstance(widget, QtWidgets.QCheckBox):
                widget.setChecked(value)
            elif isinstance(widget, QtWidgets.QComboBox):
                # region 在旧配置中可能是字符串，保存时使用平台索引整数。
                if path == "region":
                    value = int(value)
                index = widget.findData(value)
                if index < 0:
                    widget.addItem(str(value), value)
                    index = widget.count() - 1
                widget.setCurrentIndex(index)
            elif isinstance(widget, (QtWidgets.QSpinBox, QtWidgets.QDoubleSpinBox)):
                widget.setValue(0 if value is None else value)
            else:
                widget.setText(value)
        self.enable_delay_sign_custom()
        self.enable_answer_config()
        self.enable_danmu_config()
        self.enable_audio_config()
        self._update_email_controls()
        self._update_ai_controls()

    def collect_config(self):
        """收集当前表单，保留未编辑的扩展字段和禁用项的值。"""
        config = deepcopy(self.dialog_config)
        for path, widget in self.fields.items():
            if isinstance(widget, QtWidgets.QCheckBox):
                value = widget.isChecked()
            elif isinstance(widget, QtWidgets.QComboBox):
                if widget.isEditable() and widget.currentText() != widget.itemText(
                    widget.currentIndex()
                ):
                    value = widget.currentText().strip()
                else:
                    value = widget.currentData()
            elif isinstance(widget, (QtWidgets.QSpinBox, QtWidgets.QDoubleSpinBox)):
                widget.interpretText()
                value = widget.value()
                if path == "ai_analysis_settings.max_output_tokens" and value == 0:
                    value = None
            else:
                value = widget.text()
                if path not in ("email_config.password", "openai_api_key", "sessionid"):
                    value = value.strip()
            target = config
            keys = path.split(".")
            for key in keys[:-1]:
                target = target[key]
            target[keys[-1]] = value
        return config

    def _validate(self, config, email_only=False):
        required = []
        if config["email_config"]["enabled"]:
            required += [
                "email_config." + key
                for key in ("smtp_server", "username", "password", "recipient")
            ]
        if not email_only and config["enable_ai_analysis"]:
            required += ["openai_api_key", "openai_api_base", "openai_model"]
            if config["ai_analysis_settings"]["protocol"] == "responses":
                required.append("ai_analysis_settings.reasoning_effort")
        for path in required:
            value = config
            for key in path.split("."):
                value = value[key]
            if not isinstance(value, str) or not value.strip():
                widget = self.fields[path]
                for index in range(self.tabs.count()):
                    if self.tabs.widget(index).isAncestorOf(widget):
                        self.tabs.setCurrentIndex(index)
                        self.tabs.widget(index).ensureWidgetVisible(widget)
                        break
                widget.setFocus()
                QtWidgets.QMessageBox.warning(
                    self.tabs.window(),
                    "配置不完整",
                    "请填写“" + widget.accessibleName() + "”后重试。",
                )
                return False
        return True

    def test_email(self, parent):
        config = self.collect_config()
        if not self._validate(config, email_only=True):
            return
        self.test_email_btn.setEnabled(False)
        QtWidgets.QApplication.setOverrideCursor(QtCore.Qt.WaitCursor)
        try:
            success = send_test_email_notification(config)
        finally:
            QtWidgets.QApplication.restoreOverrideCursor()
            self._update_email_controls()
        if success:
            QtWidgets.QMessageBox.information(
                parent,
                "邮件测试",
                "测试邮件发送成功，请检查收件箱。",
                QtWidgets.QMessageBox.Ok,
            )
        else:
            QtWidgets.QMessageBox.warning(
                parent,
                "邮件测试",
                "测试邮件发送失败，请检查邮件配置和网络连接。",
                QtWidgets.QMessageBox.Ok,
            )

    def save_config(self, dialog):
        config = self.collect_config()
        if not self._validate(config):
            return
        temporary_path = None
        try:
            config_path = get_config_path()
            # 原子替换，避免写入中断时截断原配置文件。
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=os.path.dirname(config_path),
                prefix=".config-",
                suffix=".tmp",
                delete=False,
            ) as stream:
                temporary_path = stream.name
                json.dump(config, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
            os.replace(temporary_path, config_path)
        except OSError as error:
            QtWidgets.QMessageBox.warning(
                dialog,
                "保存失败",
                "无法写入配置文件，请检查目录权限或磁盘空间。\n" + str(error),
            )
            return
        finally:
            if temporary_path and os.path.exists(temporary_path):
                try:
                    os.unlink(temporary_path)
                except OSError:
                    pass
        self.dialog_config = config
        dialog.accept()
