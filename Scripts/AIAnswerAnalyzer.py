import json
import os
import time
import base64
from typing import Dict, List, Optional

import requests
from PIL import Image


class AIAnswerAnalyzer:
    """AI答案分析器 - 使用OpenAI接口分析PPT图片并缓存答案"""
    
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
        self.max_retries = ai_settings.get('max_retries', 3)
        self.request_timeout = ai_settings.get('request_timeout', 120)
        self.delay_between_requests = ai_settings.get('delay_between_requests', 1)
        
        # 输出初始化信息
        self._log(f"AI分析器初始化 - 启用状态: {self.enabled}")
        if self.enabled:
            self._log(f"AI模型: {self.model}")
            self._log(f"API基础URL: {self.api_base}")
        
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
                
                return combined_answers
                
            except Exception as e:
                self._log(f"加载缓存失败: {e}")
        return None
        
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
                    "manual_template_generated": analysis_status in ["partial", "failed"],
                    "version": "2.0",
                    "instructions": {
                        "manual_fill_guide": "人工填写说明：",
                        "format": "与AI答案格式相同，使用数组表示答案",
                        "examples": {
                            "单选题": "[1] 表示A选项正确，[2] 表示B选项正确",
                            "多选题": "[1,3] 表示A、C选项正确",
                            "判断题": "[1] 表示正确，[0] 表示错误",
                            "填空题": "根据具体题目填写相应内容"
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
            
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "请分析这张PPT图片中的题目，如果有选择题、填空题或其他题目，请提供正确答案。如果是选择题，请返回正确选项的序号（如[1,2]表示A、B选项正确）。如果没有题目，请返回空列表[]。只返回答案数组，不要其他解释。"
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                "max_tokens": 900
            }
            # print(payload)
            # 发送请求
            response = requests.post(
                f"{api_base}/chat/completions",
                headers=headers,
                json=payload,
                timeout=120
            )
            
            if response.status_code == 200:
                result = response.json()
                content = result['choices'][0]['message']['content'].strip()
                print(content)
                # 尝试解析答案
                try:
                    # 提取数组格式的答案
                    import re
                    match = re.search(r'\[(.*?)\]', content)
                    if match:
                        answer_str = match.group(1)
                        if answer_str.strip():
                            # 解析答案，支持数字、字母选项(A,B,C,D)和文字
                            answers = []
                            for x in answer_str.split(','):
                                item = x.strip()
                                if item:
                                    # 如果是数字，转换为整数
                                    if item.isdigit():
                                        answers.append(int(item))
                                    # 如果是单个字母（A-Z），保持原样
                                    elif len(item) == 1 and item.isalpha():
                                        answers.append(item.upper())
                                    # 其他情况（文字答案等），也保持原样
                                    else:
                                        answers.append(item)
                            return answers
                    return []
                except:
                    return []
            else:
                self._log(f"OpenAI API请求失败: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            self._log(f"分析幻灯片失败 {image_path}: {e}")
            return None
            
    def analyze_presentation(self, lesson_name: str, presentation_title: str, 
                           slides_data: List[dict], img_cache_path: str, 
                           callback=None):
        """同步分析整个演示文稿"""
        try:
            self._log(f"开始AI分析: {presentation_title}")
            
            # 首先检查是否已有缓存的答案
            cached_answers = self.load_cached_answers(lesson_name, presentation_title)
            if cached_answers:
                self._log(f"发现缓存的AI答案，共 {len(cached_answers)} 个问题")
                # 调用回调函数
                if callback:
                    callback(lesson_name, presentation_title, cached_answers)
                return cached_answers
            
            # 如果没有缓存，则进行AI分析
            answers_cache = {}
            failed_slides = []
            
            # 获取包含问题的幻灯片
            problem_slides = [slide for slide in slides_data if "problem" in slide.keys()]
            
            for slide in problem_slides:
                slide_index = slide['index']
                image_path = os.path.join(img_cache_path, f"{slide_index}.jpg")
                
                if os.path.exists(image_path):
                    self._log(f"正在分析幻灯片 {slide_index}...")
                    ai_answers = self.analyze_slide_with_openai(image_path, slide_index)
                    
                    if ai_answers is not None:
                        answers_cache[str(slide_index)] = ai_answers
                        self._log(f"幻灯片 {slide_index} 分析完成，答案: {ai_answers}")
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