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
        """加载缓存的答案"""
        cache_file = self.get_cache_file_path(lesson_name, presentation_title)
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                self._log(f"加载缓存失败: {e}")
        return None
        
    def save_cached_answers(self, lesson_name: str, presentation_title: str, answers: Dict):
        """保存答案到缓存"""
        cache_file = self.get_cache_file_path(lesson_name, presentation_title)
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(answers, f, ensure_ascii=False, indent=2)
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
            answers_cache = {}
            
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
                        
                    # 添加延迟避免API限制
                    time.sleep(self.delay_between_requests)
                else:
                    self._log(f"幻灯片图片不存在: {image_path}")
                    
            # 保存缓存
            if answers_cache:
                self.save_cached_answers(lesson_name, presentation_title, answers_cache)
                self._log(f"AI分析完成，共分析 {len(answers_cache)} 个问题")
            else:
                self._log("未找到任何问题或分析失败")
                
            # 调用回调函数
            if callback:
                callback(lesson_name, presentation_title, answers_cache)
                
            return answers_cache
                
        except Exception as e:
            self._log(f"AI分析过程出错: {e}")
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