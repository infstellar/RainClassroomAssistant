"""
异步下载器模块
提供基于协程的图片下载功能，替代原有的多线程实现
"""

import asyncio
import aiohttp
import aiofiles
import os
from typing import List, Dict, Optional, Callable, Any
from PIL import Image
import time


class AsyncImageDownloader:
    """异步图片下载器"""
    
    def __init__(self, 
                 max_concurrent: int = 8,
                 timeout: int = 30,
                 max_retries: int = 3,
                 progress_callback: Optional[Callable] = None,
                 skip_existing: bool = True):
        """
        初始化异步下载器
        
        Args:
            max_concurrent: 最大并发数
            timeout: 请求超时时间
            max_retries: 最大重试次数
            progress_callback: 进度回调函数
            skip_existing: 是否跳过已存在的有效文件
        """
        self.max_concurrent = max_concurrent
        self.timeout = timeout
        self.max_retries = max_retries
        self.progress_callback = progress_callback
        self.skip_existing = skip_existing
        self.semaphore = asyncio.Semaphore(max_concurrent)
        
    async def download_image(self, 
                           session: aiohttp.ClientSession,
                           slide: Dict[str, Any],
                           img_path: str) -> Dict[str, Any]:
        """
        下载单张图片
        
        Args:
            session: aiohttp会话
            slide: 幻灯片信息
            img_path: 图片保存路径
            
        Returns:
            下载结果字典
        """
        async with self.semaphore:
            url = slide.get("cover", "")
            if not url:
                return {"success": False, "slide": slide, "error": "URL为空"}
                
            index = slide["index"]
            final_image_name = os.path.join(img_path, f"{index}.jpg")
            temp_image_name = os.path.join(img_path, f"{index}_temp")
            
            # 检查是否跳过已存在的有效文件
            if self.skip_existing and self._is_valid_image(final_image_name):
                if self.progress_callback:
                    await self._safe_callback(slide, True, "文件已存在，跳过下载")
                return {"success": True, "slide": slide, "path": final_image_name, "skipped": True}
            
            for attempt in range(self.max_retries):
                try:
                    # 下载图片
                    async with session.get(url, timeout=self.timeout) as response:
                        if response.status != 200:
                            raise aiohttp.ClientError(f"HTTP {response.status}")
                            
                        # 检查内容类型
                        content_type = response.headers.get('content-type', '')
                        if not content_type.startswith('image/'):
                            raise ValueError(f"不是图片格式: {content_type}")
                            
                        content = await response.read()
                        if len(content) < 10:
                            raise ValueError("文件内容过小")
                    
                    # 保存临时文件
                    async with aiofiles.open(temp_image_name, 'wb') as f:
                        await f.write(content)
                    
                    # 处理图片格式
                    await self._process_image(temp_image_name, final_image_name)
                    
                    # 清理临时文件
                    if os.path.exists(temp_image_name):
                        os.remove(temp_image_name)
                    
                    # 通知进度
                    if self.progress_callback:
                        await self._safe_callback(slide, True, None)
                    
                    return {"success": True, "slide": slide, "path": final_image_name}
                    
                except Exception as e:
                    if attempt == self.max_retries - 1:
                        # 最后一次尝试失败，清理文件
                        for cleanup_file in [temp_image_name, final_image_name]:
                            if os.path.exists(cleanup_file):
                                os.remove(cleanup_file)
                        
                        if self.progress_callback:
                            await self._safe_callback(slide, False, str(e))
                        
                        return {"success": False, "slide": slide, "error": str(e)}
                    
                    # 等待后重试
                    await asyncio.sleep(0.5 * (attempt + 1))
    
    async def _process_image(self, temp_path: str, final_path: str):
        """
        处理图片格式转换（在线程池中执行，避免阻塞事件循环）
        """
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._sync_process_image, temp_path, final_path)
    
    def _sync_process_image(self, temp_path: str, final_path: str):
        """
        同步处理图片格式转换
        """
        with Image.open(temp_path) as img:
            # 验证图片完整性
            img.verify()
            
        # 重新打开进行格式转换
        with Image.open(temp_path) as img:
            # 处理透明度
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # 保存为JPEG
            img.save(final_path, 'JPEG', quality=95)
    
    def _is_valid_image(self, image_path: str) -> bool:
        """
        检查图片文件是否有效
        
        Args:
            image_path: 图片文件路径
            
        Returns:
            bool: 图片是否有效
        """
        try:
            if not os.path.exists(image_path):
                return False
            
            # 检查文件大小
            if os.path.getsize(image_path) < 10:
                return False
            
            # 验证图片完整性
            with Image.open(image_path) as img:
                img.verify()
                return True
        except Exception:
            return False
    
    async def _safe_callback(self, slide: Dict, success: bool, error: Optional[str]):
        """
        安全调用进度回调函数
        """
        try:
            if asyncio.iscoroutinefunction(self.progress_callback):
                await self.progress_callback(slide, success, error)
            else:
                self.progress_callback(slide, success, error)
        except Exception as e:
            print(f"进度回调函数执行失败: {e}")
    
    async def download_slides(self, 
                            slides: List[Dict[str, Any]], 
                            img_path: str) -> Dict[str, Any]:
        """
        批量下载幻灯片图片
        
        Args:
            slides: 幻灯片列表
            img_path: 图片保存路径
            
        Returns:
            下载结果统计
        """
        start_time = time.time()
        
        # 如果启用了跳过已存在文件，先过滤掉已存在的有效文件
        if self.skip_existing:
            slides_to_download = []
            skipped_count = 0
            
            for slide in slides:
                image_path = os.path.join(img_path, f"{slide['index']}.jpg")
                if self._is_valid_image(image_path):
                    skipped_count += 1
                    if self.progress_callback:
                        await self._safe_callback(slide, True, "文件已存在，跳过下载")
                else:
                    slides_to_download.append(slide)
            
            print(f"跳过 {skipped_count} 个已存在的有效文件，需要下载 {len(slides_to_download)} 个文件")
        else:
            slides_to_download = slides
            skipped_count = 0
        
        if not slides_to_download:
            return {
                "total": len(slides),
                "successful": len(slides),
                "failed": 0,
                "success_list": [],
                "failed_list": [],
                "skipped": skipped_count,
                "duration": 0
            }
        
        # 创建HTTP会话
        connector = aiohttp.TCPConnector(limit=self.max_concurrent)
        timeout = aiohttp.ClientTimeout(total=self.timeout)
        
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            # 创建下载任务
            tasks = [
                self.download_image(session, slide, img_path)
                for slide in slides_to_download
            ]
            
            # 并发执行所有下载任务
            results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 统计结果
        successful = []
        failed = []
        
        for result in results:
            if isinstance(result, Exception):
                failed.append({"error": str(result)})
            elif result.get("success"):
                successful.append(result)
            else:
                failed.append(result)
        
        end_time = time.time()
        
        return {
            "total": len(slides),
            "successful": len(successful) + skipped_count,
            "failed": len(failed),
            "success_list": successful,
            "failed_list": failed,
            "skipped": skipped_count,
            "duration": round(end_time - start_time, 2)
        }


class AsyncPPTDownloadManager:
    """异步PPT下载管理器"""
    
    def __init__(self, 
                 max_concurrent: int = 8,
                 max_retries: int = 5,
                 progress_callback: Optional[Callable] = None,
                 skip_existing: bool = True):
        """
        初始化管理器
        
        Args:
            max_concurrent: 最大并发数
            max_retries: 最大重试次数
            progress_callback: 进度回调函数
            skip_existing: 是否跳过已存在的有效文件
        """
        self.downloader = AsyncImageDownloader(
            max_concurrent=max_concurrent,
            progress_callback=progress_callback,
            skip_existing=skip_existing
        )
        self.max_retries = max_retries
        self.skip_existing = skip_existing
    
    async def download_presentation(self, data: Dict[str, Any], lessonname: str = "未知课程") -> Dict[str, Any]:
        """
        下载整个演示文稿
        
        Args:
            data: 演示文稿数据，包含title、slides等信息
            lessonname: 课程名称
            
        Returns:
            下载结果
        """
        import os
        
        # 创建下载目录 - 使用与PPTManager相同的路径结构
        title = data.get("title", "未知演示文稿").replace("/", "_").strip()
        lessonname = lessonname.replace("/", "_").strip()
        
        # 使用正确的rainclasscache路径结构
        cachedirpath = os.path.join("downloads", "rainclasscache")
        lessonpath = os.path.join(cachedirpath, lessonname)
        img_path = os.path.join(lessonpath, title)
        os.makedirs(img_path, exist_ok=True)
        
        # 获取幻灯片列表
        slides = data.get("slides", [])
        if not slides:
            return {"total": 0, "successful": 0, "failed": 0, "skipped": 0}
        
        # 如果启用跳过已存在文件，先检查已存在的文件数量
        if self.skip_existing:
            existing_count = sum(1 for slide in slides 
                               if self.validate_image(os.path.join(img_path, f"{slide['index']}.jpg")))
            if existing_count == len(slides):
                print(f"所有 {len(slides)} 个文件都已存在且有效，跳过下载")
                return {
                    "total": len(slides),
                    "successful": len(slides),
                    "failed": 0,
                    "skipped": existing_count
                }
        
        # 执行下载
        result = await self.download_with_retry(slides, img_path)
        return result

    async def download_with_retry(self, 
                                slides: List[Dict[str, Any]], 
                                img_path: str) -> Dict[str, Any]:
        """
        带重试机制的下载
        
        Args:
            slides: 幻灯片列表
            img_path: 图片保存路径
            
        Returns:
            最终下载结果
        """
        remaining_slides = slides.copy()
        all_successful = []
        
        for attempt in range(self.max_retries):
            if not remaining_slides:
                break
                
            print(f"第 {attempt + 1} 次下载尝试，剩余 {len(remaining_slides)} 张图片")
            
            result = await self.downloader.download_slides(remaining_slides, img_path)
            
            # 收集成功的下载
            all_successful.extend(result["success_list"])
            
            # 准备重试失败的项目
            if result["failed_list"] and attempt < self.max_retries - 1:
                remaining_slides = [item["slide"] for item in result["failed_list"] 
                                  if "slide" in item]
                await asyncio.sleep(1)  # 重试前等待
            else:
                remaining_slides = []
        
        return {
            "total": len(slides),
            "successful": len(all_successful),
            "failed": len(slides) - len(all_successful),
            "success_list": all_successful
        }
    
    def validate_image(self, image_path: str) -> bool:
        """
        验证图片文件的有效性
        """
        try:
            if not os.path.exists(image_path):
                return False
            
            if os.path.getsize(image_path) < 10:
                return False
            
            with Image.open(image_path) as img:
                img.verify()
                return True
        except Exception:
            return False
    
    def get_missing_images(self, slides: List[Dict[str, Any]], img_path: str) -> List[Dict[str, Any]]:
        """
        获取缺失或无效的图片列表
        """
        missing = []
        for slide in slides:
            image_path = os.path.join(img_path, f"{slide['index']}.jpg")
            if not self.validate_image(image_path):
                missing.append(slide)
        return missing