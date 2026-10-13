import json
import os
import random
import re
import threading
import time
import traceback
import asyncio
from concurrent.futures import ThreadPoolExecutor

import requests
import websocket

from .PPTManager import PPTManager
from .AIAnswerAnalyzer import AIAnswerAnalyzer
from .AsyncDownloader import AsyncPPTDownloadManager
from .Logger import logger
from .Utils import (
    calculate_waittime,
    dict_result,
    get_user_info,
    is_debug,
    get_host,
)


class Lesson:
    def __init__(self, lessonid, lessonname, classroomid, main_ui):
        self.classroomid = classroomid
        self.lessonid = lessonid
        self.lessonname = lessonname
        self.sessionid = main_ui.config["sessionid"]
        self.headers = {
            "Cookie": "sessionid=%s" % self.sessionid,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:97.0) Gecko/20100101 Firefox/97.0",
        }
        self.receive_danmu = {}
        self.sent_danmu_dict = {}
        self.danmu_dict = {}
        self.problems_ls = []
        self.problems_dict = {}
        self.problem_display_indexes = {}
        self.unlocked_problem = []
        self.classmates_ls = []
        self.add_message = main_ui.add_message_signal.emit
        self.add_course = main_ui.add_course_signal.emit
        self.del_course = main_ui.del_course_signal.emit
        self.config = main_ui.config
        self.region = self.config["region"]
        code, rtn = get_user_info(self.sessionid, self.config["region"])
        
        # 检查返回的数据类型和API响应状态
        if code != 0 or not isinstance(rtn, dict):
            # 如果API返回错误或rtn不是字典，抛出更明确的错误信息
            error_msg = f"获取用户信息失败: code={code}, rtn={rtn}"
            self.add_message(error_msg, 0)
            raise ValueError(error_msg)
        
        # 检查必要的字段是否存在
        if "id" not in rtn or "name" not in rtn:
            error_msg = f"用户信息格式错误，缺少必要字段: {rtn}"
            self.add_message(error_msg, 0)
            raise ValueError(error_msg)
            
        self.user_uid = rtn["id"]
        self.user_uname = rtn["name"]
        self.main_ui = main_ui
        # self.pptmanager_dict = {}
        
        # AI答案分析器延迟初始化
        self._ai_analyzer = None
        
        # 异步下载管理器
        self._async_download_manager = None
        self._executor = ThreadPoolExecutor(max_workers=4)

    def _ensure_download_tracking(self):
        if not hasattr(self, 'downloaded_presentations'):
            self.downloaded_presentations = set()
        if not hasattr(self, 'downloading_presentations'):
            self.downloading_presentations = set()

    @property
    def ai_analyzer(self):
        """延迟初始化AI答案分析器"""
        if self._ai_analyzer is None:
            self._ai_analyzer = AIAnswerAnalyzer(self.config, self.add_message)
        return self._ai_analyzer
    
    @property
    def async_download_manager(self):
        """获取异步下载管理器实例"""
        if self._async_download_manager is None:
            self._async_download_manager = AsyncPPTDownloadManager(
                max_concurrent=8,
                max_retries=5,
                progress_callback=self._async_progress_callback
            )
        return self._async_download_manager
    
    def _async_progress_callback(self, slide, success, error=None):
        """异步下载进度回调"""
        if success:
            self.add_message(f"✓ 下载成功: slide {slide.get('index', '?')}", 0)
        else:
            self.add_message(f"✗ 下载失败: slide {slide.get('index', '?')} - {error}", 2)

    def _download(self, data):
        data["title"] = data["title"].replace("/", "_").strip()
        self.print_problems(data)
        self.add_message("开始下载ppt : " + data["title"] + ".pdf", 0)
        try:
            ppt_manager = PPTManager(data, self.lessonname)
            
            # 设置数据刷新回调，用于重试时获取最新数据
            presentation_id = getattr(self, '_current_presentation_id', None)
            if presentation_id:
                ppt_manager.set_data_refresh_callback(presentation_id, self._get_ppt)
            
            pdfname, usetime = ppt_manager.start()
            if pdfname is None or usetime is None:
                if is_debug():
                    self.add_message(
                        "重复下载ppt取消 : " + pdfname + f"，耗时{usetime}秒", 0
                    )
                return
            self.add_message("下载ppt成功 : " + pdfname + f"，耗时{usetime}秒", 0)
            
            # PPT下载完成后，启动AI分析
            self._start_ai_analysis(data, ppt_manager)
            
        except Exception as e:
            self.add_message("下载ppt失败 : " + data["title"] + ".pdf", 0)
            self.add_message(traceback.format_exc(), 0)
            
    def _start_ai_analysis(self, data, ppt_manager):
        """启动AI分析"""
        try:
            # 检查是否启用AI分析
            if not self.config.get('enable_ai_analysis', False):
                return
                
            presentation_title = data["title"]
            slides_data = self._apply_problem_display_indexes(data["slides"])
            
            # 构建图片缓存路径
            img_cache_path = ppt_manager.imgpath
            
            # 定义分析完成回调
            def analysis_callback(lesson_name, title, answers_cache):
                if answers_cache:
                    self.add_message(f"AI分析完成: {title}，共分析 {len(answers_cache)} 个问题", 0)
                else:
                    self.add_message(f"AI分析完成: {title}，未找到问题或分析失败", 0)
            
            # 启动AI分析
            self.ai_analyzer.analyze_presentation(
                self.lessonname,
                presentation_title,
                slides_data,
                img_cache_path,
                analysis_callback
            )
            
            self.add_message(f"已启动AI分析: {presentation_title}", 0)
            
        except Exception as e:
            self.add_message(f"启动AI分析失败: {str(e)}", 0)

    def _record_problem_display_indexes(self, events):
        """记录课堂事件流中的题目显示页码。"""
        if not hasattr(self, "problem_display_indexes"):
            self.problem_display_indexes = {}

        for event in events or []:
            if event.get("type") != "problem":
                continue

            display_index = event.get("si")
            if display_index is None:
                continue

            for problem_id in (event.get("prob"), event.get("sid")):
                if problem_id:
                    self.problem_display_indexes[str(problem_id)] = display_index

    def _problem_identifiers(self, slide):
        problem = slide.get("problem", {})
        identifiers = []
        for value in (
            problem.get("problemId"),
            problem.get("id"),
            problem.get("sid"),
            slide.get("id"),
            slide.get("slideId"),
        ):
            if value:
                identifiers.append(str(value))
        return identifiers

    def _apply_problem_display_indexes(self, slides):
        """用事件流中的题目显示页码覆盖 fetch 返回的题目页码。"""
        if not getattr(self, "problem_display_indexes", None):
            return slides

        adjusted_slides = []
        for slide in slides:
            if "problem" not in slide:
                adjusted_slides.append(slide)
                continue

            display_index = None
            for problem_id in self._problem_identifiers(slide):
                display_index = self.problem_display_indexes.get(problem_id)
                if display_index is not None:
                    break
            if display_index is None:
                adjusted_slides.append(slide)
                continue

            slide["index"] = display_index
            adjusted_slides.append(slide)

        return adjusted_slides

    def _prefer_problem_slides_on_index_conflict(self, slides):
        """题目页码被事件流修正后，保留同页码的题目页。"""
        slide_by_index = {}
        for slide in slides:
            slide_index = slide.get("index")
            existing_slide = slide_by_index.get(slide_index)
            if existing_slide is None or (
                "problem" in slide and "problem" not in existing_slide
            ):
                slide_by_index[slide_index] = slide

        return list(slide_by_index.values())

    def _normalize_slides_with_problem_display_indexes(self, data):
        if "slides" not in data:
            return data

        data["slides"] = self._prefer_problem_slides_on_index_conflict(
            self._apply_problem_display_indexes(data["slides"])
        )
        return data

    def download_ppt(self, presentationid, force_refresh=False):
        """使用协程异步下载PPT"""
        self._ensure_download_tracking()
        if not force_refresh and (
            presentationid in self.downloaded_presentations
            or presentationid in self.downloading_presentations
        ):
            return

        if force_refresh:
            self.downloaded_presentations.discard(presentationid)
            self.downloading_presentations.discard(presentationid)

        self.downloading_presentations.add(presentationid)
        
        def run_async_download():
            try:
                # 在线程池中运行异步任务
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    ppt_data = self._get_ppt(presentationid)
                    loop.run_until_complete(
                        self._async_download(
                            ppt_data,
                            presentationid,
                            force_refresh=force_refresh,
                        )
                    )
                finally:
                    loop.close()
            except Exception as e:
                self.add_message(f"异步下载失败: {str(e)}", 0)
            finally:
                self.downloading_presentations.discard(presentationid)
        
        # 在线程池中执行异步下载
        self._executor.submit(run_async_download)
    
    async def _async_download(self, data, presentation_id=None, force_refresh=False):
        """异步下载方法"""
        try:
            presentation_title = data.get("title", "未知演示文稿")
            self.add_message(f"开始异步下载: {presentation_title}", 0)
            
            if presentation_id is None:
                presentation_id = getattr(self, '_current_presentation_id', None)

            data = self._normalize_slides_with_problem_display_indexes(data)
            ppt_manager = PPTManager(data, self.lessonname)
            if force_refresh:
                ppt_manager.delete_cache()

            download_manager = self.async_download_manager
            if presentation_id:
                download_manager.set_data_refresh_callback(presentation_id, self._get_ppt)

            # 使用异步下载管理器，传入课程名称
            download_result = await download_manager.download_presentation(data, self.lessonname)

            missing_images = ppt_manager.get_missing_images()
            if download_result.get("failed", 0) > 0 or missing_images:
                self.add_message(
                    f"图片下载未完成: {presentation_title}，将保留为待重试",
                    2,
                )
                if missing_images:
                    self.add_message(
                        f"仍缺少 {len(missing_images)} 张图片，跳过PDF生成",
                        2,
                    )
                return
            
            self.add_message(f"图片下载完成: {presentation_title}", 0)
            
            # 异步下载完成后，生成PDF文件
            try:
                self.add_message(f"开始生成PDF: {presentation_title}", 0)
                
                # 直接调用generate_ppt方法生成PDF（跳过下载步骤，因为图片已经下载完成）
                pdf_name = ppt_manager.generate_ppt()
                
                if pdf_name:
                    self.add_message(f"PDF生成成功: {pdf_name}", 0)
                    self._ensure_download_tracking()
                    if presentation_id:
                        self.downloaded_presentations.add(presentation_id)
                    
                    # 启动AI分析
                    self._start_ai_analysis(data, ppt_manager)
                else:
                    self.add_message(f"PDF生成失败: {presentation_title}", 0)
                    
            except Exception as e:
                self.add_message(f"PDF生成过程中出错: {str(e)}", 0)
                
        except Exception as e:
            self.add_message(f"异步下载过程中出错: {str(e)}", 0)

    def _get_ppt(self, presentationid):
        # 获取课程各页ppt
        r = requests.get(
            url=f"https://{get_host(self.config['region'])}/api/v3/lesson/presentation/fetch?presentation_id={presentationid}",
            headers=self.headers,
            proxies={"http": None, "https": None},
        )
        return dict_result(r.text)["data"]

    def print_problems(self, data):
        answers = {}
        slides = [problem for problem in data["slides"] if "problem" in problem.keys()]
        index = [problem["index"] for problem in slides]
        problems = [problem["problem"] for problem in slides]
        for i in range(len(problems)):
            problems[i]["index"] = index[i]
        for problem in problems:
            answers[problem["index"]] = problem["answers"]
        self.add_message(
            f"{self.lessonname}:{data['title']} 的答案为" + str(answers), 0
        )

    def get_problems(self, presentationid):
        # 获取课程ppt中的题目
        data = self._get_ppt(presentationid)
        presentation_title = data.get("title", "未知演示文稿").replace("/", "_").strip()
        slides = [
            problem
            for problem in self._apply_problem_display_indexes(data["slides"])
            if "problem" in problem.keys()
        ]
        index = [problem["index"] for problem in slides]
        problems = [problem["problem"] for problem in slides]
        for i in range(len(problems)):
            problems[i]["index"] = index[i]
            slide_ids = []
            for slide_id in (slides[i].get("id"), slides[i].get("slideId")):
                if slide_id and slide_id not in slide_ids:
                    slide_ids.append(slide_id)
            if slide_ids:
                problems[i]["slideId"] = slide_ids[0]
                problems[i]["slideIds"] = slide_ids
            problems[i]["presentationId"] = presentationid
            problems[i]["presentationTitle"] = presentation_title
            if slides[i].get("cover"):
                problems[i]["cover"] = slides[i]["cover"]
            
        return problems

    def _problem_matches_identifier(self, problem, problemid):
        identifiers = (
            problem.get("problemId"),
            problem.get("id"),
            problem.get("sid"),
            problem.get("slideId"),
            *(problem.get("slideIds", []) or []),
        )
        return str(problemid) in [str(identifier) for identifier in identifiers if identifier]

    def _find_problem_for_live_ai(self, problemid):
        self.add_message(f"[现场AI兜底] 开始查找问题: problemid={problemid}", 0)
        for problem in self.problems_ls:
            if self._problem_matches_identifier(problem, problemid):
                self.add_message(
                    "[现场AI兜底] 找到问题: "
                    f"problemId={problem.get('problemId')}, "
                    f"index={problem.get('index')}, "
                    f"presentationId={problem.get('presentationId')}, "
                    f"cover={'有' if problem.get('cover') else '无'}",
                    0,
                )
                return problem
        self.add_message(f"[现场AI兜底] 未在 problems_ls 中找到问题: {problemid}", 0)
        return None

    def _candidate_presentation_ids(self, current_problem):
        presentation_ids = []
        for presentation_id in (
            current_problem.get("presentationId") if current_problem else None,
            getattr(self, "_current_presentation_id", None),
            *list(getattr(self, "downloaded_presentations", set()) or set()),
            *list(getattr(self, "downloading_presentations", set()) or set()),
        ):
            if presentation_id and presentation_id not in presentation_ids:
                presentation_ids.append(presentation_id)
        self.add_message(f"[现场AI兜底] 候选PPT ID: {presentation_ids}", 0)
        return presentation_ids

    def _find_slide_in_presentation(self, ppt_data, current_problem):
        if not ppt_data or not current_problem:
            return None

        target_index = current_problem.get("index")
        problem_identifiers = [
            str(identifier)
            for identifier in (
                current_problem.get("problemId"),
                current_problem.get("id"),
                current_problem.get("sid"),
                current_problem.get("slideId"),
                *(current_problem.get("slideIds", []) or []),
            )
            if identifier
        ]

        slides = self._apply_problem_display_indexes(ppt_data.get("slides", []))
        for slide in slides:
            slide_problem = slide.get("problem", {})
            slide_identifiers = [
                str(identifier)
                for identifier in (
                    slide_problem.get("problemId"),
                    slide_problem.get("id"),
                    slide_problem.get("sid"),
                    slide.get("id"),
                    slide.get("slideId"),
                )
                if identifier
            ]
            if set(problem_identifiers).intersection(slide_identifiers):
                return slide
            if target_index is not None and str(slide.get("index")) == str(target_index):
                return slide
        return None

    def _download_live_ai_image(self, cover_url, image_path):
        self.add_message(f"[现场AI兜底] 准备下载题目图片: {cover_url}", 0)
        os.makedirs(os.path.dirname(image_path), exist_ok=True)
        response = requests.get(
            cover_url,
            headers=getattr(self, "headers", None),
            proxies={"http": None, "https": None},
            timeout=30,
        )
        status_code = getattr(response, "status_code", "unknown")
        content_type = getattr(response, "headers", {}).get("content-type", "")
        content = getattr(response, "content", b"") or b""
        self.add_message(
            f"[现场AI兜底] 图片下载响应: status={status_code}, "
            f"content-type={content_type}, bytes={len(content)}",
            0,
        )
        if status_code != 200:
            self.add_message(f"[现场AI兜底] 图片下载失败: HTTP {status_code}", 2)
            return False
        if len(content) < 10:
            self.add_message("[现场AI兜底] 图片下载失败: 文件内容过小", 2)
            return False
        if content_type and not content_type.lower().startswith("image/"):
            self.add_message(f"[现场AI兜底] 图片下载失败: 非图片响应 {content_type}", 2)
            return False

        with open(image_path, "wb") as image_file:
            image_file.write(content)
        self.add_message(f"[现场AI兜底] 题目图片已保存: {image_path}", 0)
        return True

    def _cache_live_ai_answer(self, presentation_title, slide_index, ai_answer, slide_info):
        self.add_message(
            f"[现场AI兜底] 写入AI答案缓存: title={presentation_title}, "
            f"slide={slide_index}, answer={ai_answer}",
            0,
        )
        self.ai_analyzer.save_cached_answers(
            self.lessonname,
            presentation_title,
            {str(slide_index): ai_answer},
            [slide_info] if slide_info else None,
            "completed",
        )

    def _safe_live_ai_path_name(self, filename):
        return re.sub(r'[<>:"/\\|?*]', "_", str(filename))

    def _is_live_ai_insufficient_context(self, ai_answer):
        return (
            ai_answer
            == getattr(self.ai_analyzer, "INSUFFICIENT_CONTEXT_MARKER", "__INSUFFICIENT_CONTEXT__")
        )

    def _select_live_ai_context_slides(self, slides, matched_slide, total_images):
        if not slides or not matched_slide or total_images <= 1:
            return [matched_slide] if matched_slide else []

        target_identifiers = {
            str(identifier)
            for identifier in (
                matched_slide.get("index"),
                matched_slide.get("id"),
                matched_slide.get("slideId"),
            )
            if identifier is not None
        }
        matched_position = None
        for position, slide in enumerate(slides):
            slide_identifiers = {
                str(identifier)
                for identifier in (
                    slide.get("index"),
                    slide.get("id"),
                    slide.get("slideId"),
                )
                if identifier is not None
            }
            if slide is matched_slide or target_identifiers.intersection(slide_identifiers):
                matched_position = position
                break

        if matched_position is None:
            return [matched_slide]

        previous_count = max(total_images - 1, 0)
        start_position = max(0, matched_position - previous_count)
        return slides[start_position:matched_position + 1]

    def _prepare_live_ai_context_images(self, context_slides, image_dir):
        image_paths = []
        selected_indexes = []
        for slide in context_slides:
            slide_index = slide.get("index")
            cover_url = slide.get("cover")
            if slide_index is None:
                self.add_message("[现场AI兜底] 上下文图片跳过: slide 缺少 index", 2)
                return None, selected_indexes
            if not cover_url:
                self.add_message(f"[现场AI兜底] 上下文图片跳过: slide={slide_index} 缺少 cover", 2)
                return None, selected_indexes

            image_path = os.path.join(image_dir, f"{slide_index}.jpg")
            selected_indexes.append(slide_index)
            if os.path.exists(image_path):
                self.add_message(f"[现场AI兜底] 上下文图片复用缓存: slide={slide_index}, path={image_path}", 0)
            else:
                self.add_message(f"[现场AI兜底] 上下文图片需要下载: slide={slide_index}", 0)
                if not self._download_live_ai_image(cover_url, image_path):
                    return None, selected_indexes
            image_paths.append(image_path)
        return image_paths, selected_indexes

    def _retry_live_ai_with_context(self, matched_slides, matched_slide, image_dir, slide_index):
        if not matched_slides or not matched_slide:
            self.add_message("[现场AI兜底] 无 matched PPT 上下文，无法扩展重试", 2)
            return None

        for retry_index, total_images in enumerate((3, 5, 7, 9), start=1):
            context_slides = self._select_live_ai_context_slides(
                matched_slides,
                matched_slide,
                total_images,
            )
            image_paths, selected_indexes = self._prepare_live_ai_context_images(context_slides, image_dir)
            self.add_message(
                f"[现场AI兜底] 上下文重试 {retry_index}/4: "
                f"images={len(image_paths) if image_paths else 0}/{total_images}, "
                f"slides={selected_indexes}, target={slide_index}",
                0,
            )
            if not image_paths:
                continue

            ai_answer = self.ai_analyzer.analyze_slide_with_context(image_paths, slide_index)
            self.add_message(f"[现场AI兜底] AI上下文分析返回: {ai_answer}", 0)
            if ai_answer and not self._is_live_ai_insufficient_context(ai_answer):
                return ai_answer
            if self._is_live_ai_insufficient_context(ai_answer):
                self.add_message(f"[现场AI兜底] 上下文重试 {retry_index}/4 仍上下文不足", 2)
                continue
            if ai_answer == []:
                self.add_message(f"[现场AI兜底] 上下文重试 {retry_index}/4 未识别到可用答案", 2)
                return []
            self.add_message(f"[现场AI兜底] 上下文重试 {retry_index}/4 分析失败", 2)
            return None

        self.add_message("[现场AI兜底] 上下文不足已耗尽，停止现场AI兜底", 2)
        return None

    def _try_live_ai_answer(self, problemid):
        current_problem = self._find_problem_for_live_ai(problemid)
        if not current_problem:
            return None

        slide_index = current_problem.get("index")
        if slide_index is None:
            self.add_message("[现场AI兜底] 当前问题缺少幻灯片 index，无法分析", 2)
            return None

        presentation_title = current_problem.get("presentationTitle") or "现场题目"
        cover_url = current_problem.get("cover")
        matched_slide = None
        matched_slides = []

        self.add_message(
            f"[现场AI兜底] 当前问题基础信息: slide={slide_index}, "
            f"title={presentation_title}, cover={'有' if cover_url else '无'}",
            0,
        )

        cached_answers = self.ai_analyzer.load_cached_answers(self.lessonname, presentation_title)
        if cached_answers and str(slide_index) in cached_answers and cached_answers[str(slide_index)]:
            ai_answer = cached_answers[str(slide_index)]
            self.add_message(f"[现场AI兜底] 命中当前题缓存: {ai_answer}", 0)
            return ai_answer
        self.add_message("[现场AI兜底] 当前题缓存未命中，准备现场下载图片分析", 0)

        for presentation_id in self._candidate_presentation_ids(current_problem):
            try:
                self.add_message(f"[现场AI兜底] 拉取PPT数据以补全题图: {presentation_id}", 0)
                ppt_data = self._get_ppt(presentation_id)
                fetched_title = ppt_data.get("title", presentation_title).replace("/", "_").strip()
                candidate_slide = self._find_slide_in_presentation(ppt_data, current_problem)
                if not candidate_slide:
                    self.add_message(f"[现场AI兜底] PPT {presentation_id} 中未匹配到当前题", 0)
                    continue

                matched_slide = candidate_slide
                matched_slides = self._apply_problem_display_indexes(ppt_data.get("slides", []))
                presentation_title = fetched_title
                slide_index = matched_slide.get("index", slide_index)
                cover_url = cover_url or matched_slide.get("cover")
                self.add_message(
                    f"[现场AI兜底] 已匹配PPT题页: presentation={presentation_id}, "
                    f"title={presentation_title}, slide={slide_index}, "
                    f"cover={'有' if cover_url else '无'}",
                    0,
                )

                cached_answers = self.ai_analyzer.load_cached_answers(self.lessonname, presentation_title)
                if cached_answers and str(slide_index) in cached_answers and cached_answers[str(slide_index)]:
                    ai_answer = cached_answers[str(slide_index)]
                    self.add_message(f"[现场AI兜底] 匹配PPT后命中缓存: {ai_answer}", 0)
                    return ai_answer
                break
            except Exception as e:
                self.add_message(f"[现场AI兜底] 拉取或匹配PPT失败: {presentation_id}, error={e}", 2)

        if not cover_url:
            self.add_message("[现场AI兜底] 没有可下载的题目图片URL，无法现场分析", 2)
            return None

        safe_title = self._safe_live_ai_path_name(presentation_title)
        image_dir = os.path.join(self.ai_analyzer.cache_dir, "_live_images", safe_title)
        image_path = os.path.join(image_dir, f"{slide_index}.jpg")
        if not self._download_live_ai_image(cover_url, image_path):
            return None

        self.add_message(f"[现场AI兜底] 开始调用AI分析现场图片: {image_path}", 0)
        ai_answer = self.ai_analyzer.analyze_slide_with_openai(image_path, slide_index)
        self.add_message(f"[现场AI兜底] AI现场分析返回: {ai_answer}", 0)

        if self._is_live_ai_insufficient_context(ai_answer):
            self.add_message("[现场AI兜底] AI报告上下文不足，准备扩展PPT上下文重试", 2)
            ai_answer = self._retry_live_ai_with_context(
                matched_slides,
                matched_slide,
                image_dir,
                slide_index,
            )
            self.add_message(f"[现场AI兜底] AI上下文重试最终返回: {ai_answer}", 0)

        if ai_answer and not self._is_live_ai_insufficient_context(ai_answer):
            slide_info = matched_slide or {
                "index": slide_index,
                "cover": cover_url,
                "problem": current_problem,
            }
            self._cache_live_ai_answer(presentation_title, slide_index, ai_answer, slide_info)
            return ai_answer
        if ai_answer == []:
            self.add_message("[现场AI兜底] AI未识别到可用答案", 2)
        else:
            self.add_message("[现场AI兜底] AI现场分析失败", 2)
        return None

    def answer_questions(self, problemid, problemtype, answer, limit):
        # 回答问题
        print(f"problemtype: {problemtype}")
        print(f"answer: {answer}")
        enter_function_time = time.time()
        
        # 如果answer为空或转bool为false，尝试使用AI缓存答案覆盖，缓存没有时现场下载题图分析
        if not answer and self.config.get('enable_ai_analysis', False):
            try:
                ai_answer = self._try_live_ai_answer(problemid)
                if ai_answer:
                    answer = ai_answer
                    self.add_message(f"使用AI答案 - 问题ID {problemid}: {ai_answer}", 0)
            except Exception as e:
                self.add_message(f"[现场AI兜底] 获取AI答案失败: {str(e)}", 2)
                self.add_message(f"[现场AI兜底] 异常详情: {traceback.format_exc()}", 0)
        
        if answer and problemtype != 3:
            wait_time = calculate_waittime(
                limit,
                self.config["answer_config"]["answer_delay"]["type"],
                self.config["answer_config"]["answer_delay"]["custom"]["percent"],
            )
            if wait_time != 0:
                meg = "%s检测到问题，将在%s秒后自动回答，答案为%s" % (
                    self.lessonname,
                    wait_time,
                    answer,
                )
                # threading.Thread(target=say_something,args=(meg,)).start()
                self.add_message(meg, 3)
                while 1:
                    time.sleep(1)
                    if time.time() - enter_function_time >= wait_time:
                        break
            else:
                meg = "%s检测到问题，剩余时间小于15秒，将立即自动回答，答案为%s" % (
                    self.lessonname,
                    answer,
                )
                self.add_message(meg, 3)
                # threading.Thread(target=say_something,args=(meg,)).start()
            try:
                answer_candidates = self._answer_submit_candidates(problemtype, answer)
            except ValueError as e:
                self.add_message(f"{self.lessonname}自动回答失败，答案格式错误：{e}", 4)
                return False
            last_parse_error = None
            for submit_index, submit_answer in enumerate(answer_candidates):
                data = {
                    "problemId": problemid,
                    "problemType": problemtype,
                    "dt": int(time.time()),
                    "result": submit_answer,
                }
                self.add_message(f"[DEBUG] 答题提交payload: {data}", 0)
                r = requests.post(
                    url=f"https://{get_host(self.config['region'])}/api/v3/lesson/problem/answer",
                    headers=self.headers,
                    data=json.dumps(data),
                    proxies={"http": None, "https": None},
                )
                response_text = r.text
                self.add_message(
                    f"[DEBUG] 答题提交响应: status={getattr(r, 'status_code', 'unknown')}, body={response_text[:500]}",
                    0,
                )
                try:
                    return_dict = dict_result(response_text)
                except ValueError as e:
                    last_parse_error = e
                    has_next_candidate = submit_index + 1 < len(answer_candidates)
                    if has_next_candidate and self._should_retry_answer_submit_with_next_format(
                        problemtype,
                        response_text,
                        e,
                    ):
                        self.add_message("[DEBUG] 当前答题格式被服务端拒绝，重试备用格式", 0)
                        continue
                    meg = "%s自动回答失败，响应解析错误：%s" % (
                        self.lessonname,
                        e,
                    )
                    self.add_message(meg, 4)
                    return False
                if return_dict["code"] == 0:
                    meg = "%s自动回答成功" % self.lessonname
                    self.add_message(meg, 4)
                    # threading.Thread(target=say_something,args=(meg,)).start()
                    return True
                else:
                    meg = "%s自动回答失败，原因：%s" % (
                        self.lessonname,
                        return_dict["msg"].replace("_", " "),
                    )
                    self.add_message(meg, 4)
                    # threading.Thread(target=say_something,args=(meg,)).start()
                    return False
            if last_parse_error:
                self.add_message(f"{self.lessonname}自动回答失败，响应解析错误：{last_parse_error}", 4)
                return False
        else:
            if limit == -1:
                meg = "%s的问题没有找到答案，该题不限时，请尽快前往雨课堂回答" % (
                    self.lessonname
                )
            else:
                meg = "%s的问题没有找到答案，请在%s秒内前往雨课堂回答" % (
                    self.lessonname,
                    limit,
                )
            # threading.Thread(target=say_something,args=(meg,)).start()
            self.add_message(meg, 4)
            return False

    def _answer_submit_candidates(self, problemtype, answer):
        if problemtype in (1, 2):
            # AI/cache answers use one-based indexes; the API expects option letters.
            choices = answer if isinstance(answer, list) else [answer]
            normalized = []
            for value in choices:
                if isinstance(value, bool) or not isinstance(value, (int, str)):
                    raise ValueError(f"无效选择题选项：{value!r}")
                choice = str(value).strip().strip('\"\'').strip().upper()
                if choice.isascii() and choice.isdigit():
                    index = int(choice)
                    if not 1 <= index <= 26:
                        raise ValueError(f"选择题选项序号应在1到26之间：{value!r}")
                    choice = chr(ord("A") + index - 1)
                if len(choice) != 1 or not "A" <= choice <= "Z":
                    raise ValueError(f"无效选择题选项：{value!r}")
                normalized.append(choice)
            return [normalized]
        if problemtype == 5:
            if isinstance(answer, list):
                content = "\n".join(str(value).strip('"') for value in answer)
            else:
                content = str(answer).strip('"')
            return [{"content": content, "pics": [{"pic": "", "thumb": ""}]}]
        if problemtype == 4 and isinstance(answer, list):
            return [
                answer,
                {str(index): value for index, value in enumerate(answer)},
            ]
        return [answer]

    def _should_retry_answer_submit_with_next_format(self, problemtype, response_text, parse_error):
        if problemtype != 4:
            return False
        error_text = f"{response_text} {parse_error}".lower()
        retry_markers = (
            "cannot be cast",
            "jsonarray",
            "jsonobject",
            "linkedhashmap",
            "arraylist",
        )
        return any(marker in error_text for marker in retry_markers)

    def on_open(self, wsapp):
        self.handshark = {
            "op": "hello",
            "userid": self.user_uid,
            "role": "student",
            "auth": self.auth,
            "lessonid": self.lessonid,
        }
        wsapp.send(json.dumps(self.handshark))

    def checkin_class(self):
        url = f"https://{get_host(self.config['region'])}/api/v3/lesson/checkin"
        payload = {"source": 5, "lessonId": self.lessonid}
        logger.info(
            "开始课程签到: lessonid={}, lessonname={}, url={}, payload={}",
            self.lessonid,
            self.lessonname,
            url,
            payload,
        )
        r = requests.post(
            url=url,
            headers=self.headers,
            data=json.dumps(payload),
            proxies={"http": None, "https": None},
        )
        set_auth = r.headers.get("Set-Auth", None)
        times = 1
        while not set_auth and times <= 3:
            set_auth = r.headers.get("Set-Auth", None)
            times += 1
            time.sleep(1)

        logger.info(
            "课程签到响应: lessonid={}, status_code={}, set_auth_present={}, body_preview={}",
            self.lessonid,
            r.status_code,
            bool(set_auth),
            r.text[:500] if isinstance(r.text, str) else repr(r.text),
        )

        result = dict_result(r.text)
        data = result.get("data")
        if not isinstance(data, dict) or not data.get("lessonToken"):
            logger.error(
                "课程签到响应异常: lessonid={}, result={}, headers={}",
                self.lessonid,
                result,
                dict(r.headers),
            )
            self.add_message(
                f"{self.lessonname}课程签到失败，请检查登录状态、区域配置或课程状态",
                2,
            )
            raise RuntimeError(
                f"课程签到失败: lessonid={self.lessonid}, code={result.get('code')}, msg={result.get('msg')}"
            )

        if set_auth:
            self.headers["Authorization"] = "Bearer %s" % set_auth
        return data["lessonToken"]

    def on_message(self, wsapp, message):
        data = dict_result(message)
        op = data["op"]
        if is_debug():
            print(op)
            self.add_message(op, 0)
        if op == "hello":
            self._record_problem_display_indexes(data.get("timeline", []))
            presentations = list(
                set(
                    [
                        slide["pres"]
                        for slide in data["timeline"]
                        if slide["type"] == "slide"
                    ]
                )
            )
            print(data)
            # 安全地获取current_presentation，如果不存在则使用None
            current_presentation = data.get("presentation")
            if current_presentation is not None and current_presentation not in presentations:
                presentations.append(current_presentation)
            elif current_presentation is None:
                self.add_message("警告：WebSocket消息中缺少'presentation'字段", 1)
            
            self._ensure_download_tracking()
            
            for presentationid in presentations:
                # print(presentationid)
                self.problems_ls.extend(self.get_problems(presentationid))
                for problem in self.problems_ls:
                    self.problems_dict[problem["index"]] = problem["answers"]
                
                # 检查是否已经下载过此presentation
                if (
                    presentationid not in self.downloaded_presentations
                    and presentationid not in self.downloading_presentations
                ):
                    self.download_ppt(presentationid)
            
            # 安全地获取unlockedproblem字段
            self.unlocked_problem = data.get("unlockedproblem", [])
            if not self.unlocked_problem:
                self.add_message("警告：WebSocket消息中缺少'unlockedproblem'字段", 1)
            for problemid in self.unlocked_problem:
                self._current_problem(wsapp, problemid)
        elif op == "unlockproblem":
            problem = data.get("problem", {})
            self._record_problem_display_indexes([
                {
                    "type": "problem",
                    "prob": problem.get("prob"),
                    "sid": problem.get("sid"),
                    "si": problem.get("si"),
                }
            ])
            self.start_answer(data["problem"]["sid"], data["problem"]["limit"])
        elif op == "lessonfinished":
            meg = "%s下课了" % self.lessonname
            # threading.Thread(target=say_something,args=(meg,)).start()
            self.add_message(meg, 7)
            wsapp.close()
        elif op == "presentationupdated":
            # 安全地获取presentation字段
            presentation_id = data.get("presentation")
            if presentation_id is not None:
                self.problems_ls.extend(self.get_problems(presentation_id))
                for problem in self.problems_ls:
                    self.problems_dict[problem["index"]] = problem["answers"]
                
                self._ensure_download_tracking()
                
                self.download_ppt(presentation_id, force_refresh=True)
            else:
                self.add_message("警告：presentationupdated消息中缺少'presentation'字段", 1)
        elif op == "presentationcreated":
            # 安全地获取presentation字段
            presentation_id = data.get("presentation")
            if presentation_id is not None:
                self.problems_ls.extend(self.get_problems(presentation_id))
                for problem in self.problems_ls:
                    self.problems_dict[problem["index"]] = problem["answers"]
                
                self._ensure_download_tracking()
                
                if (
                    presentation_id not in self.downloaded_presentations
                    and presentation_id not in self.downloading_presentations
                ):
                    self.download_ppt(presentation_id)
            else:
                self.add_message("警告：presentationcreated消息中缺少'presentation'字段", 1)
        elif op == "newdanmu" and self.config["auto_danmu"]:
            current_content = data["danmu"].lower()
            uid = data["userid"]
            sent_danmu_user = User(uid)
            if sent_danmu_user in self.classmates_ls:
                for i in self.classmates_ls:
                    if i == sent_danmu_user:
                        meg = "%s课程的%s%s发送了弹幕：%s" % (
                            self.lessonname,
                            i.sno,
                            i.name,
                            data["danmu"],
                        )
                        self.add_message(meg, 0)
                        break
            else:
                self.classmates_ls.append(sent_danmu_user)
                sent_danmu_user.get_userinfo(self.classroomid, self.headers, self.region)
                meg = "%s课程的%s%s发送了弹幕：%s" % (
                    self.lessonname,
                    sent_danmu_user.sno,
                    sent_danmu_user.name,
                    data["danmu"],
                )
                self.add_message(meg, 0)
            now = time.time()
            # 收到一条弹幕，尝试取出其之前的所有记录的列表，取不到则初始化该内容列表
            self.add_message(f"[DEBUG] 处理弹幕内容: '{current_content}', 当前时间: {now}", 0)
            try:
                same_content_ls = self.danmu_dict[current_content]
                self.add_message(f"[DEBUG] 找到已有弹幕记录，历史记录数: {len(same_content_ls)}", 0)
            except KeyError:
                self.danmu_dict[current_content] = []
                same_content_ls = self.danmu_dict[current_content]
                self.add_message(f"[DEBUG] 初始化新弹幕记录: '{current_content}'", 0)
            
            # 清除超过60秒的弹幕记录
            old_count = len(same_content_ls)
            same_content_ls[:] = [i for i in same_content_ls if now - i <= 60]
            if old_count != len(same_content_ls):
                self.add_message(f"[DEBUG] 清除过期记录: {old_count} -> {len(same_content_ls)}", 0)
            
            # 检查弹幕发送条件
            danmu_limit = self.config["danmu_config"]["danmu_limit"]
            self.add_message(f"[DEBUG] 弹幕限制阈值: {danmu_limit}, 当前记录数: {len(same_content_ls)}", 0)
            
            # 如果当前的弹幕没被发过，或者已发送时间超过60秒
            last_sent_time = self.sent_danmu_dict.get(current_content, 0)
            time_since_last_sent = now - last_sent_time if last_sent_time > 0 else float('inf')
            self.add_message(f"[DEBUG] 上次发送时间: {last_sent_time}, 距离现在: {time_since_last_sent:.2f}秒", 0)
            
            if (
                current_content not in self.sent_danmu_dict.keys()
                or now - self.sent_danmu_dict[current_content] > 60
            ):
                self.add_message(f"[DEBUG] 弹幕可以发送 (未发送过或超过60秒)", 0)
                if (
                    len(same_content_ls) + 1
                    >= self.config["danmu_config"]["danmu_limit"]
                ):
                    self.add_message(f"[DEBUG] 达到发送阈值 ({len(same_content_ls) + 1} >= {danmu_limit}), 准备发送弹幕", 0)
                    try:
                        self.send_danmu(current_content)
                        self.add_message(f"[DEBUG] 弹幕发送完成，清空记录并更新发送时间", 0)
                        same_content_ls = []
                        self.sent_danmu_dict[current_content] = now
                    except Exception as e:
                        self.add_message(f"[ERROR] 弹幕发送异常: {str(e)}", 0)
                        import traceback
                        self.add_message(f"[ERROR] 异常详情: {traceback.format_exc()}", 0)
                else:
                    self.add_message(f"[DEBUG] 未达到发送阈值，添加记录 ({len(same_content_ls) + 1} < {danmu_limit})", 0)
                    same_content_ls.append(now)
            else:
                self.add_message(f"[DEBUG] 弹幕发送被跳过 (60秒内已发送过)", 0)
        elif op == "callpaused":
            meg = "%s点名了，点到了：%s" % (self.lessonname, data["name"])
            if self.user_uname == data["name"]:
                self.add_message(meg, 5)
            else:
                self.add_message(meg, 6)
        # 程序在上课中途运行，由_current_problem发送的已解锁题目数据，得到的返回值。
        # 此处需要筛选未到期的题目进行回答。
        elif op == "probleminfo":
            if data["limit"] != -1:
                time_left = int(
                    data["limit"] - (int(data["now"]) - int(data["dt"])) / 1000
                )
            else:
                time_left = data["limit"]
            # 筛选未到期题目
            if time_left > 0 or time_left == -1:
                if self.config["auto_answer"]:
                    self.start_answer(data["problemid"], time_left)
                else:
                    self.add_message(
                        "%s检测到问题，但未开启自动回答" % self.lessonname, 3
                    )

    def start_answer(self, problemid, limit):
        for promble in self.problems_ls:
            problem_identifiers = (
                promble.get("problemId"),
                promble.get("id"),
                promble.get("sid"),
                promble.get("slideId"),
                *(promble.get("slideIds", []) or []),
            )
            if str(problemid) in [str(identifier) for identifier in problem_identifiers if identifier]:
                if promble["result"] is not None:
                    # 如果该题已经作答过，直接跳出函数以忽略该题
                    # 该情况理论上只会出现在启动监听时
                    return
                blanks = promble.get("blanks", [])
                answers = []
                print(f"blanks: {blanks}")
                # if blanks:
                #     for i in blanks:
                #         if i["answers"]:  # 检查answers列表不为空
                #             answers.append(random.choice(i["answers"]))
                #         else:
                #             # 如果answers为空，记录警告并跳过该空白
                #             self.add_message(f"{self.lessonname}检测到空白题答案列表为空，跳过该空白", 4)
                # else:
                answers = promble.get("answers", [])
                print(f"answers: {answers}")
                threading.Thread(
                    target=self.answer_questions,
                    args=(promble["problemId"], promble["problemType"], answers, limit),
                ).start()
                break
        else:
            if limit == -1:
                meg = "%s的问题没有找到答案，该题不限时，请尽快前往雨课堂回答" % (
                    self.lessonname
                )
            else:
                meg = "%s的问题没有找到答案，请在%s秒内前往雨课堂回答" % (
                    self.lessonname,
                    limit,
                )
            self.add_message(meg, 4)
            # threading.Thread(target=say_something,args=(meg,)).start()

    def _current_problem(self, wsapp, promblemid):
        # 为获取已解锁的问题详情信息，向wsapp发送probleminfo
        query_problem = {
            "op": "probleminfo",
            "lessonid": self.lessonid,
            "problemid": promblemid,
            "msgid": 1,
        }
        wsapp.send(json.dumps(query_problem))

    def start_lesson(self, delay, callback):
        index = None
        try:
            self.auth = self.checkin_class()
            rtn = self.get_lesson_info()
            teacher = rtn["teacher"]["name"]
            title = rtn["title"]
            timestamp = rtn["startTime"] // 1000
            time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp))
            index = self.main_ui.tableWidget.rowCount()
            self.add_course([self.lessonname, title, teacher, time_str], index)
            if self.lessonname.find("清华实践") != -1:
                meg = "%s测试课程，不进行监听" % self.lessonname
                self.add_message(meg, 7)
                return callback(self)
            if (
                int(time.time()) - timestamp
                <= self.config["sign_config"]["delay_time"]["custom"]["cutoff"]
                and delay > 0
            ):
                meg = f"检测到课程{self.lessonname}正在上课，将于{delay}秒后加入监听列表"
                self.add_message(meg, 7)
                time.sleep(delay)
            else:
                meg = f"检测到课程{self.lessonname}正在上课，已加入监听列表"
                self.add_message(meg, 7)
            self.wsapp = websocket.WebSocketApp(
                url=f"wss://{get_host(self.config['region'])}/wsapp/",
                header=self.headers,
                on_open=self.on_open,
                on_message=self.on_message,
            )
            self.wsapp.run_forever()
            meg = "%s监听结束" % self.lessonname
            self.add_message(meg, 7)
        except Exception as exc:
            logger.exception(
                "课程监听线程异常: lessonid={}, lessonname={}, exc={}",
                self.lessonid,
                self.lessonname,
                exc,
            )
            self.add_message(f"{self.lessonname}监听异常: {exc}", 2)
            raise
        finally:
            if index is not None:
                self.del_course(index)
        # threading.Thread(target=say_something,args=(meg,)).start()
        return callback(self)

    def send_danmu(self, content):
        self.add_message(f"[DEBUG] 开始发送弹幕: '{content}'", 0)
        url = f"https://{get_host(self.config['region'])}/api/v3/lesson/danmu/send"
        data = {
            "extra": "",
            "fromStart": "50",
            "lessonId": self.lessonid,
            "message": content,
            "requiredCensor": False,
            "showStatus": True,
            "target": "",
            "userName": "",
            "wordCloud": True,
        }
        self.add_message(f"[DEBUG] 请求URL: {url}", 0)
        self.add_message(f"[DEBUG] 请求数据: {json.dumps(data, ensure_ascii=False)}", 0)
        
        try:
            r = requests.post(
                url=url,
                headers=self.headers,
                data=json.dumps(data),
                proxies={"http": None, "https": None},
            )
            self.add_message(f"[DEBUG] HTTP响应状态码: {r.status_code}", 0)
            self.add_message(f"[DEBUG] HTTP响应内容: {r.text}", 0)
            
            result = dict_result(r.text)
            self.add_message(f"[DEBUG] 解析后的响应: {result}", 0)
            
            if result["code"] == 0:
                meg = "%s弹幕发送成功！内容：%s" % (self.lessonname, content)
                self.add_message(f"[DEBUG] 弹幕发送成功", 0)
            else:
                meg = "%s弹幕发送失败！内容：%s" % (self.lessonname, content)
                self.add_message(f"[DEBUG] 弹幕发送失败，错误代码: {result.get('code', 'unknown')}", 0)
            self.add_message(meg, 1)
        except Exception as e:
            self.add_message(f"[ERROR] 弹幕发送请求异常: {str(e)}", 0)
            import traceback
            self.add_message(f"[ERROR] 异常详情: {traceback.format_exc()}", 0)
            meg = "%s弹幕发送异常！内容：%s，错误：%s" % (self.lessonname, content, str(e))
            self.add_message(meg, 1)
            raise

    def get_lesson_info(self):
        url = f"https://{get_host(self.config['region'])}/api/v3/lesson/basic-info"
        r = requests.get(
            url=url, headers=self.headers, proxies={"http": None, "https": None}
        )
        return dict_result(r.text)["data"]

    def __eq__(self, other):
        return self.lessonid == other.lessonid


class User:
    def __init__(self, uid):
        self.uid = uid

    def get_userinfo(self, classroomid, headers, region):
        r = requests.get(
            f"https://{get_host(region)}/v/course_meta/fetch_user_info_new?query_user_id={self.uid}&classroom_id={classroomid}",
            headers=headers,
            proxies={"http": None, "https": None},
        )
        data = dict_result(r.text)["data"]
        self.sno = data["school_number"]
        self.name = data["name"]
