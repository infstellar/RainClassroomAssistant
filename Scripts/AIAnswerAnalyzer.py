import json
import os
import time
import base64
from typing import Dict, List, Optional

import requests
from PIL import Image


class AIAnswerAnalyzer:
    """AI答案分析器 - 使用OpenAI接口分析PPT图片并缓存答案"""

    INSUFFICIENT_CONTEXT_MARKER = "__INSUFFICIENT_CONTEXT__"
    
    def __init__(self, config: dict, add_message_callback=None):
        """
        初始化AI答案分析器
        
        Args:
            config: 主程序配置字典，包含AI相关配置
            add_message_callback: 用于输出日志消息的回调函数
        """
        self.config = config
        self.cache_dir = "ai_answers_cache"
        self.add_message = add_message_callback
        self.ensure_cache_dir()
        
        # OpenAI配置
        self.api_key = config.get('openai_api_key', '')
        self.api_base = config.get('openai_api_base', 'https://api.openai.com/v1')
        self.model = config.get('openai_model', 'gpt-4-vision-preview')
        self.enabled = config.get('enable_ai_analysis', False)
        
        # 分析设置
        ai_settings = config.get('ai_analysis_settings', {})
        self.protocol = ai_settings.get('protocol', 'responses')
        self.reasoning_effort = ai_settings.get('reasoning_effort', 'high')
        self.stream = ai_settings.get('stream', True)
        self.reasoning_summary = ai_settings.get('reasoning_summary', 'auto')
        self.max_output_tokens = ai_settings.get('max_output_tokens')
        if self.max_output_tokens is not None and (
            type(self.max_output_tokens) is not int or self.max_output_tokens <= 0
        ):
            raise ValueError("max_output_tokens 必须为正整数或 null")
        self.max_retries = ai_settings.get('max_retries', 3)
        self.request_timeout = ai_settings.get('request_timeout', 120)
        self.delay_between_requests = ai_settings.get('delay_between_requests', 1)
        
        # 输出初始化信息
        self._log(f"AI分析器初始化 - 启用状态: {self.enabled}")
        if self.enabled:
            self._log(f"AI模型: {self.model}")
            self._log(f"API基础URL: {self.api_base}")
            self._log(
                f"协议: {self.protocol}, 流式: {self.stream}, "
                f"推理强度: {self.reasoning_effort}, 推理摘要: {self.reasoning_summary}, "
                f"输出上限: {self.max_output_tokens if self.max_output_tokens else '接口默认'}"
            )
        
        # 初始化OpenAI客户端
        if self.enabled and self.api_key:
            try:
                import openai
                self.client = openai.OpenAI(
                    api_key=self.api_key,
                    base_url=self.api_base
                )
                self._log("OpenAI客户端初始化成功")
            except Exception as e:
                self._log(f"OpenAI客户端初始化失败: {e}")
                self.enabled = False
        elif self.enabled:
            self._log("AI分析已启用但未配置API密钥，功能将被禁用")
            self.enabled = False
            
    def _log(self, message: str):
        """统一的日志输出方法"""
        if self.add_message:
            self.add_message(f"[AI分析器] {message}", 0)
        print(f"[AI分析器] {message}")
        
    def ensure_cache_dir(self):
        """确保缓存目录存在"""
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)
            
    def get_cache_file_path(self, lesson_name: str, presentation_title: str) -> str:
        """获取缓存文件路径"""
        safe_lesson = self._safe_filename(lesson_name)
        safe_title = self._safe_filename(presentation_title)
        return os.path.join(self.cache_dir, f"{safe_lesson}_{safe_title}.json")
        
    def _safe_filename(self, filename: str) -> str:
        """生成安全的文件名"""
        import re
        return re.sub(r'[<>:"/\\|?*]', '_', filename)
        
    def load_cached_answers(self, lesson_name: str, presentation_title: str) -> Optional[Dict]:
        """从缓存加载答案"""
        cache_file = self.get_cache_file_path(lesson_name, presentation_title)
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                
                # 兼容旧格式（直接是答案字典）
                if isinstance(cache_data, dict) and "metadata" not in cache_data:
                    return cache_data
                
                # 新格式：合并AI答案和人工答案
                ai_answers = cache_data.get("answers", {})
                manual_answers = cache_data.get("manual_answers", {})
                
                # 合并答案，人工答案优先
                combined_answers = ai_answers.copy()
                for slide_index, manual_data in manual_answers.items():
                    if isinstance(manual_data, dict) and "suggested_answers" in manual_data:
                        # 复杂格式：如果人工答案不是默认模板，则使用人工答案
                        if manual_data["suggested_answers"] != ["请在此处填写建议答案"]:
                            combined_answers[slide_index] = manual_data["suggested_answers"]
                    elif isinstance(manual_data, list) and len(manual_data) > 0:
                        # 简单格式：如果人工答案非空，则使用人工答案
                        combined_answers[slide_index] = manual_data

                combined_answers = {
                    slide_index: answer
                    for slide_index, answer in combined_answers.items()
                    if not self._is_insufficient_context_answer(answer)
                }
                
                return combined_answers
                
            except Exception as e:
                self._log(f"加载缓存失败: {e}")
        return None

    def _problem_identifier(self, slide: dict) -> str:
        problem = slide.get("problem", {})
        for value in (
            problem.get("problemId"),
            problem.get("id"),
            problem.get("sid"),
            slide.get("id"),
            slide.get("slideId"),
        ):
            if value:
                return str(value)
        return ""

    def _problem_signature(self, slides_info: List[dict] = None) -> List[dict]:
        signature = []
        for slide in slides_info or []:
            if "problem" not in slide:
                continue
            signature.append(
                {
                    "index": str(slide.get("index", "")),
                    "id": self._problem_identifier(slide),
                }
            )
        return signature

    def load_cached_answers_for_slides(
        self,
        lesson_name: str,
        presentation_title: str,
        slides_info: List[dict],
    ) -> Optional[Dict]:
        """仅在缓存和当前题目页/题目ID一致时加载答案。"""
        cache_file = self.get_cache_file_path(lesson_name, presentation_title)
        if not os.path.exists(cache_file):
            return None

        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
        except Exception as e:
            self._log(f"加载缓存失败: {e}")
            return None

        current_signature = self._problem_signature(slides_info)
        if isinstance(cache_data, dict) and "metadata" in cache_data:
            cached_signature = cache_data.get("metadata", {}).get("problem_signature")
            if cached_signature is not None and cached_signature != current_signature:
                self._log("AI缓存题目签名与当前PPT不一致，重新分析")
                return None

        cached_answers = self.load_cached_answers(lesson_name, presentation_title)
        if not cached_answers:
            return None

        current_indexes = {item["index"] for item in current_signature}
        cached_indexes = set(str(index) for index in cached_answers.keys())
        if not current_indexes.issubset(cached_indexes):
            self._log("AI缓存未覆盖当前PPT的全部题目页，重新分析")
            return None

        empty_answer_indexes = [
            index for index in current_indexes if not cached_answers.get(index)
        ]
        if empty_answer_indexes:
            self._log(
                f"AI缓存包含空答案页 {', '.join(sorted(empty_answer_indexes))}，重新分析"
            )
            return None

        return cached_answers
        
    def save_cached_answers(self, lesson_name: str, presentation_title: str, answers: Dict, 
                          slides_info: List[dict] = None, analysis_status: str = "completed"):
        """
        保存答案到缓存
        
        Args:
            lesson_name: 课程名称
            presentation_title: PPT标题
            answers: AI分析的答案字典
            slides_info: 幻灯片信息列表，用于生成人工填写模板
            analysis_status: 分析状态 ("completed", "partial", "failed")
        """
        cache_file = self.get_cache_file_path(lesson_name, presentation_title)
        try:
            # 尝试加载现有的缓存文件以保留manual_answers
            existing_manual_answers = {}
            if os.path.exists(cache_file):
                try:
                    with open(cache_file, 'r', encoding='utf-8') as f:
                        existing_data = json.load(f)
                        existing_manual_answers = existing_data.get("manual_answers", {})
                        self._log(f"保留现有的 {len(existing_manual_answers)} 个手动答案")
                except Exception as e:
                    self._log(f"读取现有缓存文件失败，将创建新文件: {e}")
            
            # 构建缓存数据结构
            cache_data = {
                "metadata": {
                    "lesson_name": lesson_name,
                    "presentation_title": presentation_title,
                    "analysis_status": analysis_status,
                    "created_time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "ai_model": self.model if hasattr(self, 'model') else "unknown",
                    "total_slides": len(slides_info) if slides_info else 0,
                    "ai_analyzed_slides": len(answers),
                    "problem_signature": self._problem_signature(slides_info),
                    "manual_template_generated": analysis_status in ["partial", "failed"],
                    "version": "2.0",
                    "instructions": {
                        "manual_fill_guide": "人工填写说明：",
                        "format": "与AI答案格式相同，使用数组表示答案",
                        "examples": {
                            "单选题": "[\"A\"] 表示A选项正确，[\"B\"] 表示B选项正确",
                            "多选题": "[\"A\",\"C\"] 表示A、C选项正确",
                            "判断题": "目前没遇到过判断题，欢迎反馈",
                            "填空题": "例子：[\"8\",\"1152\"] 表示8、1152是正确答案。顺序与问题顺序一致。"
                        },
                        "usage": "1. 查看对应幻灯片图片；2. 在manual_answers中找到对应题目；3. 修改数组内容为正确答案；4. 可选择将答案移动到answers部分"
                    }
                },
                "answers": answers,
                "manual_answers": existing_manual_answers.copy()  # 保留现有的手动答案
            }
            
            # 为失败的幻灯片生成人工填写模板
            if slides_info and analysis_status in ["partial", "failed"]:
                failed_count = 0
                for slide in slides_info:
                    slide_index = str(slide.get('index', ''))
                    if slide_index and slide_index not in answers:
                        # 只有当manual_answers中不存在该题目时才创建模板
                        if slide_index not in cache_data["manual_answers"]:
                            failed_count += 1
                            
                            # 提取问题信息
                            problem_info = slide.get('problem', {})
                            problem_type = problem_info.get('type', '未知')
                            problem_content = problem_info.get('content', '请查看幻灯片内容')
                            
                            # 为失败的幻灯片创建人工填写模板（使用与AI答案相同的格式）
                            # 根据问题类型提供默认模板
                            if "选择" in problem_type or "单选" in problem_type:
                                # 单选题默认模板：空数组，需要人工填写正确选项序号
                                template_answer = []  # 例如：[1] 表示A选项正确，[1,2] 表示A、B选项正确
                            elif "判断" in problem_type:
                                # 判断题默认模板
                                template_answer = []  # 例如：[1] 表示正确，[0] 表示错误
                            else:
                                # 其他题型（填空题等）
                                template_answer = []  # 需要根据具体题目填写
                            
                            cache_data["manual_answers"][slide_index] = template_answer
                        else:
                            self._log(f"保留现有手动答案 - 幻灯片 {slide_index}: {cache_data['manual_answers'][slide_index]}")
                
                # 更新元数据
                cache_data["metadata"]["manual_templates_count"] = failed_count
                cache_data["metadata"]["completion_rate"] = len(answers) / len(slides_info) if slides_info else 0
            
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, ensure_ascii=False, indent=2)
                
            self._log(f"缓存已保存到: {cache_file}")
            if analysis_status in ["partial", "failed"]:
                self._log(f"已生成 {cache_data['metadata'].get('manual_templates_count', 0)} 个人工填写模板")
            
        except Exception as e:
            self._log(f"保存缓存失败: {e}")
            
    def encode_image_to_base64(self, image_path: str) -> str:
        """将图片编码为base64"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    def _create_request_session(self):
        """创建不继承系统代理设置的请求会话"""
        session = requests.Session()
        session.trust_env = False
        return session

    def _response_output_text(self, data) -> str:
        """只提取最终答案文本，推理摘要单独记录。"""
        if data.get("output_text"):
            return str(data["output_text"])
        texts = []
        for item in data.get("output") or []:
            if not isinstance(item, dict) or item.get("type") == "reasoning":
                continue
            for part in item.get("content") or []:
                if isinstance(part, dict) and part.get("text"):
                    texts.append(str(part["text"]))
        if texts:
            return "".join(texts)
        choices = data.get("choices") or []
        if choices and isinstance(choices[0], dict):
            message = choices[0].get("message") or {}
            return str(message.get("content") or "")
        return ""

    def _response_summary_text(self, data) -> str:
        texts = []
        for item in data.get("output") or []:
            if not isinstance(item, dict) or item.get("type") != "reasoning":
                continue
            for part in item.get("summary") or []:
                if isinstance(part, dict) and part.get("text"):
                    texts.append(str(part["text"]))
        return "\n".join(texts)

    def _log_response_metadata(self, data, log_summary=True):
        if log_summary:
            summary = self._response_summary_text(data)
            if summary:
                self._log(f"推理摘要: {summary}")
        usage = data.get("usage") or {}
        if usage:
            details = usage.get("output_tokens_details") or {}
            reasoning_tokens = details.get("reasoning_tokens", "未提供")
            self._log(
                f"Token用量: input={usage.get('input_tokens', usage.get('prompt_tokens', '未提供'))}, "
                f"output={usage.get('output_tokens', usage.get('completion_tokens', '未提供'))}, "
                f"reasoning={reasoning_tokens}"
            )
        status = data.get("status")
        if data.get("error") or status in ("incomplete", "failed", "cancelled"):
            detail = data.get("error") or data.get("incomplete_details") or status
            raise ValueError(f"AI响应未完成: status={status}, detail={detail}")

    def _iter_sse_data(self, lines):
        """按SSE事件边界读取，兼容注释、多行data和末尾无空行。"""
        parts = []
        for raw_line in lines:
            line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
            line = line.rstrip("\r\n")
            if not line:
                if parts:
                    yield "\n".join(parts)
                    parts = []
            elif line.startswith("data:"):
                parts.append(line[5:].lstrip(" "))
        if parts:
            yield "\n".join(parts)

    def _extract_sse_content(self, lines) -> str:
        parts = []
        final_text = None
        summaries = {}
        final_summary = ""
        terminal = False
        responses_events = False
        for payload in self._iter_sse_data(lines):
            if payload == "[DONE]":
                terminal = True
                break
            data = json.loads(payload)
            if not isinstance(data, dict):
                raise ValueError("AI流式事件不是JSON对象")
            event_type = data.get("type", "")
            responses_events = responses_events or event_type.startswith("response.")
            if event_type == "error" or data.get("error"):
                raise ValueError(f"AI流式错误: {data.get('error') or data}")
            if event_type in ("response.completed", "response.incomplete", "response.failed"):
                final = data.get("response") or {}
                self._log_response_metadata(final, log_summary=False)
                if event_type != "response.completed":
                    raise ValueError(f"AI流式响应未完成: {event_type}")
                final_text = self._response_output_text(final) or final_text
                final_summary = self._response_summary_text(final)
                terminal = True
                break
            if event_type == "response.output_text.delta":
                parts.append(str(data.get("delta") or ""))
            elif event_type == "response.output_text.done" and not parts:
                final_text = str(data.get("text") or "")
            elif event_type == "response.reasoning_summary_text.delta":
                delta = data.get("delta")
                if delta:
                    key = (data.get("item_id", data.get("output_index", 0)), data.get("summary_index", 0))
                    summaries[key] = summaries.get(key, "") + str(delta)
            elif event_type == "response.reasoning_summary_text.done":
                if data.get("text"):
                    key = (data.get("item_id", data.get("output_index", 0)), data.get("summary_index", 0))
                    summaries[key] = str(data["text"])
            else:
                choices = data.get("choices") or []
                if choices and isinstance(choices[0], dict):
                    choice = choices[0]
                    delta = choice.get("delta") or {}
                    if delta.get("content"):
                        parts.append(str(delta["content"]))
                    if choice.get("finish_reason") in ("length", "content_filter"):
                        raise ValueError(f"AI答案被截断: {choice['finish_reason']}")
                if data.get("usage"):
                    self._log_response_metadata(data)
        if not terminal and responses_events:
            raise requests.exceptions.ConnectionError("Responses流中断，未收到完成事件")
        if not terminal:
            raise requests.exceptions.ConnectionError("SSE流中断，未收到结束标记")
        summary = final_summary or "\n".join(summaries.values())
        if summary:
            self._log(f"推理摘要: {summary}")
        return (final_text if final_text is not None else "".join(parts)).strip()

    def _extract_response_content(self, response) -> str:
        """在会话仍打开时逐事件读取SSE，也兼容网关返回普通JSON。"""
        content_type = (getattr(response, "headers", {}) or {}).get("Content-Type", "")
        if "text/event-stream" in content_type.lower():
            self._log("开始读取AI流式响应")
            # 不访问response.text/json，避免预先缓冲整个响应。
            if hasattr(response, "iter_lines"):
                return self._extract_sse_content(response.iter_lines(chunk_size=1))
            return self._extract_sse_content(response.text.splitlines())
        try:
            data = response.json()
        except ValueError:
            text = getattr(response, "text", "") or ""
            if any(line.startswith("data:") for line in text.splitlines()):
                return self._extract_sse_content(text.splitlines())
            return text.strip()
        if not isinstance(data, dict):
            raise ValueError("AI响应不是JSON对象")
        self._log_response_metadata(data)
        choices = data.get("choices") or []
        if choices and choices[0].get("finish_reason") in ("length", "content_filter"):
            raise ValueError(f"AI答案被截断: {choices[0]['finish_reason']}")
        return self._response_output_text(data).strip()

    def _single_image_prompt(self):
        return (
            "请分析这张PPT图片中的题目，如果有选择题、填空题或其他题目，请提供正确答案。"
            "如果是选择题，请返回正确选项的序号（如[1,2]表示A、B选项正确）。"
            "如果没有题目，请返回空列表[]。"
            "如果看到了题目，但当前图片缺少必要上下文、定义、数据或前置条件，无法可靠作答，请只返回[\"上下文不足\"]。"
            "输出最简洁的内容，只输出答案，如果题目是英文，就用英文输出；题目是中文就用中文输出。"
            "不要输出任何过程，不要使用 latex 和 markdown 语法。只返回答案数组，不要其他解释。"
        )

    def _context_prompt(self, target_slide_index: int):
        return (
            f"请根据多张PPT图片回答最后一张图片中的题目。最后一张图片是当前要回答的题目页，slide={target_slide_index}；"
            "前面的图片只用于补充上下文、定义、数据、假设和符号说明。"
            "如果是选择题，请返回正确选项的序号（如[1,2]表示A、B选项正确）。"
            "如果仍然缺少必要上下文，无法可靠作答，请只返回[\"上下文不足\"]。"
            "如果最后一张图片没有题目，请返回空列表[]。"
            "输出最简洁的内容，只输出答案，如果题目是英文，就用英文输出；题目是中文就用中文输出。"
            "不要输出任何过程，不要使用 latex 和 markdown 语法。只返回答案数组，不要其他解释。"
        )

    def _build_ai_request(self, api_base: str, model: str, base64_image: str):
        return self._build_ai_request_for_images(
            api_base,
            model,
            [base64_image],
            self._single_image_prompt(),
        )

    def _build_ai_request_for_images(
        self,
        api_base: str,
        model: str,
        base64_images: List[str],
        prompt: str,
    ):
        if not base64_images:
            raise ValueError("至少需要一张图片")

        if self.protocol == "chat_completions":
            content = [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
            for base64_image in base64_images:
                content.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}"
                        }
                    }
                )
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": content
                    }
                ],
                "stream": self.stream
            }
            if self.max_output_tokens is not None:
                payload["max_tokens"] = self.max_output_tokens
            return f"{api_base.rstrip('/')}/chat/completions", payload

        content = [
            {
                "type": "input_text",
                "text": prompt
            }
        ]
        for base64_image in base64_images:
            content.append(
                {
                    "type": "input_image",
                    "image_url": f"data:image/jpeg;base64,{base64_image}"
                }
            )
        payload = {
            "model": model,
            "reasoning": {
                "effort": self.reasoning_effort
            },
            "input": [
                {
                    "role": "user",
                    "content": content
                }
            ],
            "stream": self.stream
        }
        if self.reasoning_summary:
            payload["reasoning"]["summary"] = self.reasoning_summary
        if self.max_output_tokens is not None:
            payload["max_output_tokens"] = self.max_output_tokens
        return f"{api_base.rstrip('/')}/responses", payload

    def _parse_answer_array(self, content: str) -> List:
        """解析模型返回的答案数组"""
        import re

        match = re.search(r'\[(.*?)\]', content)
        if not match:
            return []

        answer_str = match.group(1)
        if not answer_str.strip():
            return []

        answers = []
        for x in answer_str.split(','):
            item = x.strip()
            if not item:
                continue
            if item.isdigit():
                answers.append(int(item))
            elif len(item) == 1 and item.isalpha():
                answers.append(item.upper())
            else:
                answers.append(item)
        normalized_answers = [
            str(answer).strip().strip('"').strip("'")
            for answer in answers
        ]
        if len(normalized_answers) == 1 and normalized_answers[0] in (
            "上下文不足",
            "context insufficient",
            "insufficient context",
            "INSUFFICIENT_CONTEXT",
        ):
            return self.INSUFFICIENT_CONTEXT_MARKER
        return answers

    def _is_insufficient_context_answer(self, answer) -> bool:
        return answer == self.INSUFFICIENT_CONTEXT_MARKER

    def _slide_identifiers(self, slide: dict) -> set:
        return {
            str(identifier)
            for identifier in (
                slide.get("index"),
                slide.get("id"),
                slide.get("slideId"),
            )
            if identifier is not None
        }

    def _select_context_slides(self, slides_data: List[dict], matched_slide: dict, total_images: int) -> List[dict]:
        if not slides_data or not matched_slide or total_images <= 1:
            return [matched_slide] if matched_slide else []

        target_identifiers = self._slide_identifiers(matched_slide)
        matched_position = None
        for position, slide in enumerate(slides_data):
            if slide is matched_slide or target_identifiers.intersection(self._slide_identifiers(slide)):
                matched_position = position
                break

        if matched_position is None:
            return [matched_slide]

        previous_count = max(total_images - 1, 0)
        start_position = max(0, matched_position - previous_count)
        return slides_data[start_position:matched_position + 1]

    def _prepare_batch_context_images(self, context_slides: List[dict], img_cache_path: str, target_slide_index: int):
        image_paths = []
        selected_indexes = []
        target_image_exists = False

        for slide in context_slides:
            slide_index = slide.get("index")
            if slide_index is None:
                self._log("批量上下文图片跳过: slide 缺少 index")
                continue

            image_path = os.path.join(img_cache_path, f"{slide_index}.jpg")
            selected_indexes.append(slide_index)
            if not os.path.exists(image_path):
                self._log(f"批量上下文图片不存在，跳过: slide={slide_index}, path={image_path}")
                continue

            if slide_index == target_slide_index:
                target_image_exists = True
            image_paths.append(image_path)

        if not target_image_exists:
            self._log(f"批量上下文目标图片不存在，无法重试: slide={target_slide_index}")
            return [], selected_indexes

        return image_paths, selected_indexes

    def _retry_batch_with_context(self, slides_data: List[dict], matched_slide: dict, img_cache_path: str):
        slide_index = matched_slide.get("index")
        if slide_index is None:
            self._log("批量上下文重试失败: 当前题页缺少 index")
            return None

        for retry_index, total_images in enumerate((3, 5, 7, 9), start=1):
            context_slides = self._select_context_slides(slides_data, matched_slide, total_images)
            image_paths, selected_indexes = self._prepare_batch_context_images(
                context_slides,
                img_cache_path,
                slide_index,
            )
            self._log(
                f"批量上下文重试 {retry_index}/4: "
                f"images={len(image_paths)}/{total_images}, "
                f"slides={selected_indexes}, target={slide_index}"
            )
            if not image_paths:
                continue

            ai_answers = self.analyze_slide_with_context(image_paths, slide_index)
            self._log(f"批量上下文分析返回: {ai_answers}")

            if ai_answers and not self._is_insufficient_context_answer(ai_answers):
                self._log(f"批量上下文重试 {retry_index}/4 成功，答案: {ai_answers}")
                return ai_answers
            if self._is_insufficient_context_answer(ai_answers):
                self._log(f"批量上下文重试 {retry_index}/4 仍上下文不足")
                continue
            if ai_answers == []:
                self._log(f"批量上下文重试 {retry_index}/4 未识别到可用答案")
                return []

            self._log(f"批量上下文重试 {retry_index}/4 分析失败")
            return None

        self._log(f"批量上下文不足已耗尽: slide={slide_index}")
        return self.INSUFFICIENT_CONTEXT_MARKER

    def _post_ai_request(self, request_url, headers, payload):
        self._log(
            f"发送AI请求: protocol={self.protocol}, stream={payload.get('stream', False)}, "
            f"reasoning={payload.get('reasoning')}, "
            f"max_output_tokens={payload.get('max_output_tokens', payload.get('max_tokens', '接口默认'))}"
        )
        for attempt in range(self.max_retries + 1):
            session = self._create_request_session()
            response = None
            try:
                response = session.post(
                    request_url,
                    headers=headers,
                    json=payload,
                    timeout=self.request_timeout,
                    stream=bool(payload.get("stream")),
                )
                if response.status_code != 200:
                    self._log(f"OpenAI API请求失败: {response.status_code} - {response.text}")
                    return None
                content = self._extract_response_content(response)
                if not content:
                    self._log("OpenAI API返回空内容")
                    return []
                return self._parse_answer_array(content)
            except (
                requests.exceptions.SSLError,
                requests.exceptions.Timeout,
                requests.exceptions.ConnectionError,
                requests.exceptions.ChunkedEncodingError,
            ) as e:
                if attempt >= self.max_retries:
                    raise
                self._log(f"OpenAI API请求失败，准备重试 {attempt + 1}/{self.max_retries}: {e}")
            finally:
                if response is not None and hasattr(response, "close"):
                    response.close()
                session.close()
            time.sleep(min(2 ** attempt, 5))

    def analyze_slide_with_openai(self, image_path: str, slide_index: int) -> Optional[List]:
        """使用OpenAI分析单张幻灯片"""
        try:
            # 获取OpenAI配置
            api_key = self.config.get('openai_api_key', '')
            api_base = self.config.get('openai_api_base', 'https://api.openai.com/v1')
            model = self.config.get('openai_model', 'gpt-4-vision-preview')
            
            if not api_key:
                self._log("OpenAI API密钥未配置")
                return None
                
            # 编码图片
            base64_image = self.encode_image_to_base64(image_path)
            
            # 构建请求
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            
            request_url, payload = self._build_ai_request(api_base, model, base64_image)
            return self._post_ai_request(request_url, headers, payload)

        except Exception as e:
            self._log(f"分析幻灯片失败 {image_path}: {e}")
            return None

    def analyze_slide_with_context(self, image_paths: List[str], slide_index: int) -> Optional[List]:
        """使用OpenAI结合上下文图片分析目标幻灯片"""
        try:
            api_key = self.config.get('openai_api_key', '')
            api_base = self.config.get('openai_api_base', 'https://api.openai.com/v1')
            model = self.config.get('openai_model', 'gpt-4-vision-preview')

            if not api_key:
                self._log("OpenAI API密钥未配置")
                return None

            base64_images = [self.encode_image_to_base64(image_path) for image_path in image_paths]
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            request_url, payload = self._build_ai_request_for_images(
                api_base,
                model,
                base64_images,
                self._context_prompt(slide_index),
            )
            return self._post_ai_request(request_url, headers, payload)

        except Exception as e:
            self._log(f"结合上下文分析幻灯片失败 {image_paths}: {e}")
            return None
            
    def analyze_presentation(self, lesson_name: str, presentation_title: str, 
                           slides_data: List[dict], img_cache_path: str, 
                           callback=None):
        """同步分析整个演示文稿"""
        try:
            self._log(f"开始AI分析: {presentation_title}")
            
            # 首先检查是否已有缓存的答案
            problem_slides = [slide for slide in slides_data if "problem" in slide.keys()]

            cached_answers = self.load_cached_answers_for_slides(
                lesson_name,
                presentation_title,
                problem_slides,
            )
            if cached_answers:
                self._log(f"发现缓存的AI答案，共 {len(cached_answers)} 个问题")
                # 调用回调函数
                if callback:
                    callback(lesson_name, presentation_title, cached_answers)
                return cached_answers
            
            # 如果没有缓存，则进行AI分析
            answers_cache = {}
            failed_slides = []
            
            for slide in problem_slides:
                slide_index = slide['index']
                image_path = os.path.join(img_cache_path, f"{slide_index}.jpg")
                
                if os.path.exists(image_path):
                    self._log(f"正在分析幻灯片 {slide_index}...")
                    ai_answers = self.analyze_slide_with_openai(image_path, slide_index)
                    
                    if self._is_insufficient_context_answer(ai_answers):
                        self._log(f"幻灯片 {slide_index} 上下文不足，准备批量上下文重试")
                        ai_answers = self._retry_batch_with_context(slides_data, slide, img_cache_path)

                    if ai_answers and not self._is_insufficient_context_answer(ai_answers):
                        answers_cache[str(slide_index)] = ai_answers
                        self._log(f"幻灯片 {slide_index} 分析完成，答案: {ai_answers}")
                    elif self._is_insufficient_context_answer(ai_answers):
                        self._log(f"幻灯片 {slide_index} 上下文不足，未缓存为答案")
                        failed_slides.append(slide)
                    elif ai_answers == []:
                        self._log(f"幻灯片 {slide_index} 未识别到可用答案")
                        failed_slides.append(slide)
                    else:
                        self._log(f"幻灯片 {slide_index} 分析失败")
                        failed_slides.append(slide)
                        
                    # 添加延迟避免API限制
                    time.sleep(self.delay_between_requests)
                else:
                    self._log(f"幻灯片图片不存在: {image_path}")
                    failed_slides.append(slide)
                    
            # 确定分析状态
            total_slides = len(problem_slides)
            successful_slides = len(answers_cache)
            
            if successful_slides == 0:
                analysis_status = "failed"
                status_msg = "AI分析完全失败"
            elif successful_slides == total_slides:
                analysis_status = "completed"
                status_msg = f"AI分析完成，共分析 {successful_slides} 个问题"
            else:
                analysis_status = "partial"
                status_msg = f"AI分析部分完成，成功 {successful_slides}/{total_slides} 个问题"
            
            # 无论成功与否都保存缓存（包括失败的幻灯片模板）
            self.save_cached_answers(
                lesson_name, 
                presentation_title, 
                answers_cache, 
                problem_slides,  # 传入所有问题幻灯片信息
                analysis_status
            )
            
            self._log(f"{status_msg}，缓存已保存")
            if failed_slides:
                self._log(f"失败的幻灯片已生成人工填写模板，请手动编辑缓存文件")
                
            # 调用回调函数
            if callback:
                callback(lesson_name, presentation_title, answers_cache)
                
            return answers_cache
                
        except Exception as e:
            self._log(f"AI分析过程出错: {e}")
            # 即使出错也尝试保存一个基础的缓存文件
            try:
                self.save_cached_answers(
                    lesson_name, 
                    presentation_title, 
                    {}, 
                    slides_data if 'slides_data' in locals() else [],
                    "failed"
                )
                self._log("已创建失败状态的缓存文件，可用于人工填写答案")
            except:
                pass
            return None
        
    def get_cached_answers_for_problems(self, lesson_name: str, presentation_title: str, 
                                      problems: List[dict]) -> List[dict]:
        """为问题列表应用缓存的答案"""
        cached_answers = self.load_cached_answers(lesson_name, presentation_title)
        
        if not cached_answers:
            return problems
            
        # 应用缓存的答案
        for problem in problems:
            slide_index = problem.get('index')
            if slide_index and str(slide_index) in cached_answers:
                ai_answers = cached_answers[str(slide_index)]
                if ai_answers:  # 只有当AI提供了答案时才覆盖
                    problem['answers'] = ai_answers
                    self._log(f"应用AI缓存答案 - 幻灯片 {slide_index}: {ai_answers}")
                    
        return problems
