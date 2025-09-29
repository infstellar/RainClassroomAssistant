import hashlib
import os
import re
import threading
import time
import asyncio
from concurrent.futures import ThreadPoolExecutor

import PyPDF2
import requests
from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFont

from .AsyncDownloader import AsyncImageDownloader


class PPTManager:
    threading_count = 8
    title_dict = {}

    def __init__(self, data, lessonname, downloadpath="downloads"):
        self.lessonname = self.validateTitle(lessonname)
        self.title = self.validateTitle(data["title"]).strip()
        # 安全设置title_dict，避免并发问题
        if self.title not in self.title_dict:
            self.title_dict[self.title] = 1
        self.timestamp = str(time.time())
        self.timeinfo = time.strftime(
            "%Y%m%d-%H%M%S", time.localtime(float(self.timestamp))
        )
        self.downloadpath = downloadpath

        self.lessondownloadpath = downloadpath + "\\" + self.lessonname

        self.cachedirpath = downloadpath + "\\rainclasscache"
        self.lessonpath = self.cachedirpath + "\\" + self.lessonname
        self.titlepath = self.lessonpath + "\\" + self.title
        # 取消时间戳层级，相同PPT放在相同文件夹
        self.imgpath = self.titlepath

        self.slides = data["slides"]
        self.width = data["width"]
        self.height = data["height"]
        self.md5_list = []
        # 添加失败重试相关属性
        self.max_retry_attempts = 5
        self.failed_downloads = []
        
        # 异步下载器
        self.async_downloader = AsyncImageDownloader()
        self._executor = ThreadPoolExecutor(max_workers=8)
        
        self.check_dir()

    def validateTitle(self, title):
        rstr = r"[\/\\\:\*\?\"\<\>\|]"  # '/ \ : * ? " < > |'
        new_title = re.sub(rstr, "_", title)  # 替换为下划线
        return new_title

    def check_dir(self):
        if not os.path.exists(self.downloadpath):
            os.mkdir(self.downloadpath)

        if not os.path.exists(self.lessondownloadpath):
            os.mkdir(self.lessondownloadpath)

        if not os.path.exists(self.cachedirpath):
            os.mkdir(self.cachedirpath)
        if not os.path.exists(self.lessonpath):
            os.mkdir(self.lessonpath)
        if not os.path.exists(self.titlepath):
            os.mkdir(self.titlepath)
        # 取消时间戳文件夹创建，直接使用titlepath作为imgpath
        if not os.path.exists(self.imgpath):
            os.mkdir(self.imgpath)

    def download(self):
        """使用协程异步下载所有幻灯片图片"""
        def run_async_download():
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(self._async_download_all())
                finally:
                    loop.close()
            except Exception as e:
                print(f"异步下载失败: {str(e)}")
        
        # 在线程池中执行异步下载
        future = self._executor.submit(run_async_download)
        future.result()  # 等待完成
        
        # 下载完成后，检查并重试失败的图片
        self.retry_failed_downloads()
    
    async def _async_download_all(self):
        """异步下载所有幻灯片"""
        tasks = []
        for slide in self.slides:
            task = self.async_downloader.download_image(
                url=slide["cover"],
                save_path=os.path.join(self.imgpath, f"{slide['index']}.jpg"),
                target_format="JPEG"
            )
            tasks.append(task)
        
        # 并发执行所有下载任务
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 处理下载结果
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                print(f"下载幻灯片 {self.slides[i]['index']} 失败: {str(result)}")
                self.failed_downloads.append(self.slides[i])
            else:
                print(f"下载幻灯片 {self.slides[i]['index']} 成功")

    def get_problems(self):
        slides = [problem for problem in self.slides if "problem" in problem.keys()]
        index = [problem["index"] for problem in slides]
        problems = [problem["problem"] for problem in slides]
        for i in range(len(problems)):
            problems[i]["index"] = index[i]
        return problems

    def get_md5(self, file):
        with open(file, "rb") as f:
            md5 = hashlib.md5(f.read()).hexdigest()
        return md5

    def get_sha256(self, file):
        with open(file, "rb") as f:
            sha256 = hashlib.sha256(f.read()).hexdigest()
        return sha256

    def validate_image(self, image_path):
        """验证图片文件的有效性"""
        try:
            if not os.path.exists(image_path):
                return False
            
            # 检查文件大小
            if os.path.getsize(image_path) < 10:
                return False
            
            # 使用PIL验证图片完整性
            with Image.open(image_path) as img:
                img.verify()
                return True
        except Exception:
            return False

    def get_missing_images(self):
        """获取缺失或无效的图片列表"""
        missing_images = []
        for slide in self.slides:
            image_path = self.imgpath + "\\" + str(slide["index"]) + ".jpg"
            if not self.validate_image(image_path):
                missing_images.append(slide)
        return missing_images

    def retry_failed_downloads(self):
        """重试下载失败或缺失的图片，最多尝试5次"""
        def run_async_retry():
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(self._async_retry_downloads())
                finally:
                    loop.close()
            except Exception as e:
                print(f"异步重试失败: {str(e)}")
        
        # 在线程池中执行异步重试
        future = self._executor.submit(run_async_retry)
        future.result()  # 等待完成
    
    async def _async_retry_downloads(self):
        """异步重试下载失败的图片"""
        for attempt in range(self.max_retry_attempts):
            missing_images = self.get_missing_images()
            
            if not missing_images:
                print(f"所有图片下载完成，验证通过")
                break
                
            print(f"第 {attempt + 1} 次重试，需要重新下载 {len(missing_images)} 张图片")
            
            # 异步重新下载缺失的图片
            tasks = []
            for slide in missing_images:
                task = self.async_downloader.download_image(
                    url=slide["cover"],
                    save_path=os.path.join(self.imgpath, f"{slide['index']}.jpg"),
                    target_format="JPEG"
                )
                tasks.append(task)
            
            # 并发执行重试任务
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # 处理重试结果
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    print(f"重试下载幻灯片 {missing_images[i]['index']} 失败: {str(result)}")
                else:
                    print(f"重试下载幻灯片 {missing_images[i]['index']} 成功")
                    
            # 短暂等待，让文件系统同步
            await asyncio.sleep(1)
        
        # 最终检查
        final_missing = self.get_missing_images()
        if final_missing:
            print(f"警告：经过 {self.max_retry_attempts} 次重试后，仍有 {len(final_missing)} 张图片下载失败")
            for slide in final_missing:
                print(f"  - 图片 {slide['index']}: {slide.get('cover', 'URL未知')}")
        else:
            print("所有图片下载并验证完成")
    def add_hash(self, path):
        for img in os.listdir(path):
            self.hash_list.add(self.get_md5(path + "\\" + img))
            print(path + "\\" + img)

    def generate_ppt(self):
        pdf_name = self.title + ".pdf"
        for slide in self.slides:
            image_name = self.imgpath + "\\" + str(slide["index"]) + ".jpg"
            
            # 检查图片文件是否存在
            if not os.path.exists(image_name):
                print(f"警告: 图片文件不存在，跳过: {image_name}")
                continue
                
            try:
                md5 = self.get_md5(image_name)
                self.md5_list.append(md5)
                if "problem" in slide.keys():
                    problem = slide["problem"]
                    # print(problem)
                    img = Image.open(image_name)
                    font = ImageFont.truetype("C:\\Windows\\Fonts\\msyh.ttc", 30)
                    draw = ImageDraw.Draw(img)
                    draw.text(
                        (50, 50),
                        str(problem["answers"]),
                        fill=(255, 0, 0),
                        font=font,
                    )
                    img.save(image_name)
            except Exception as e:
                print(f"处理图片时发生错误: {image_name}, 错误: {e}")
                continue
        with open(self.imgpath + "\\md5.txt", "w") as f:
            for md5 in self.md5_list:
                f.write(md5 + "\n")
        hash = self.get_sha256(self.imgpath + "\\md5.txt")
        print(self.title + ":" + hash)
        for pdf in os.scandir(self.downloadpath):
            if pdf.path == self.downloadpath + "\\" + pdf_name:
                os.replace(pdf.path, self.lessondownloadpath + "\\" + pdf_name)
        for pdf in os.scandir(self.lessondownloadpath):
            if pdf.name.endswith(".pdf"):
                try:
                    keywords = PyPDF2.PdfReader(open(pdf.path, "rb")).metadata.get(
                        "/Keywords"
                    )
                    if hash == keywords:
                        return pdf.name
                except Exception as e:
                    print(e)
        ppt = FPDF("L", "pt", [self.height, self.width])
        ppt.set_keywords(hash)
        ppt.set_author("RainClassroom")
        for slide in self.slides:
            image_name = self.imgpath + "\\" + str(slide["index"]) + ".jpg"
            
            # 检查图片文件是否存在
            if not os.path.exists(image_name):
                print(f"警告: 生成PDF时图片文件不存在，跳过: {image_name}")
                continue
                
            try:
                ppt.add_page()
                ppt.image(image_name, 0, 0, h=self.height, w=self.width)
            except Exception as e:
                print(f"添加图片到PDF时发生错误: {image_name}, 错误: {e}")
                continue
        if os.path.exists(self.lessondownloadpath + "\\" + pdf_name):
            pdf_name = self.title + str(self.timeinfo) + ".pdf"
        ppt.output(self.lessondownloadpath + "\\" + pdf_name)
        return pdf_name

    def delete_cache(self):
        # 删除图片缓存文件，但保留文件夹结构以便重用
        if os.path.exists(self.imgpath):
            for file in os.listdir(self.imgpath):
                file_path = self.imgpath + "\\" + file
                if os.path.isfile(file_path):
                    os.remove(file_path)
            # 不删除文件夹本身，以便下次相同PPT可以重用

    def start(self):
        if self.title_dict.get(self.title) is None:
            return None, None
        self.download()
        pdfname = self.generate_ppt()
        # self.delete_cache()
        usetime = round(time.time() - float(self.timestamp), 4)
        # 安全删除title_dict中的键，避免KeyError
        if self.title in self.title_dict:
            del self.title_dict[self.title]
        return pdfname, usetime

    def __eq__(self, __value: object) -> bool:
        if self.title != __value.title:
            return False
        else:
            return self.slides == __value.slides

    class DownloadThread(threading.Thread):
        def __init__(self, slides, cacheimgpath):
            threading.Thread.__init__(self)
            self.slides = slides
            self.imgpath = cacheimgpath

        def download(self, slide):
            url = slide["cover"]
            if url == "":
                return
            index = slide["index"]
            final_image_name = self.imgpath + "\\" + str(index) + ".jpg"
            temp_image_name = self.imgpath + "\\" + str(index) + "_temp"
            
            try:
                response = requests.get(url, timeout=30)
                response.raise_for_status()  # 检查HTTP状态码
                
                # 检查响应内容是否为图片
                content_type = response.headers.get('content-type', '')
                if not content_type.startswith('image/'):
                    print(f"警告: URL {url} 返回的不是图片格式，content-type: {content_type}")
                    return
                
                content = response.content
                if len(content) < 10:
                    print(f"警告: 下载的文件内容过小: {url}")
                    return
                
                # 先保存为临时文件
                with open(temp_image_name, "wb") as f:
                    f.write(content)
                    
                # 使用PIL打开并验证图片，然后转换为JPEG格式
                try:
                    with Image.open(temp_image_name) as img:
                        # 验证图片完整性
                        img.verify()
                        
                    # 重新打开图片进行格式转换（verify后需要重新打开）
                    with Image.open(temp_image_name) as img:
                        # 如果是RGBA模式，转换为RGB（JPEG不支持透明度）
                        if img.mode in ('RGBA', 'LA', 'P'):
                            # 创建白色背景
                            background = Image.new('RGB', img.size, (255, 255, 255))
                            if img.mode == 'P':
                                img = img.convert('RGBA')
                            background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                            img = background
                        elif img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # 保存为JPEG格式
                        img.save(final_image_name, 'JPEG', quality=95)
                        
                except Exception as e:
                    print(f"图片处理失败: {temp_image_name}, 错误: {e}")
                    return
                finally:
                    # 清理临时文件
                    if os.path.exists(temp_image_name):
                        os.remove(temp_image_name)
                    
            except requests.exceptions.RequestException as e:
                print(f"下载图片失败: {url}, 错误: {e}")
            except Exception as e:
                print(f"处理图片时发生错误: {url}, 错误: {e}")
                # 清理可能存在的文件
                for cleanup_file in [temp_image_name, final_image_name]:
                    if os.path.exists(cleanup_file):
                        os.remove(cleanup_file)

        def run(self):
            for slide in self.slides:
                self.download(slide)


if __name__ == "__main__":
    data = {
        "title": "第一章",
        "slides": [
            {
                "index": 1,
                "cover": "https://rainclass.oss-cn-shanghai.aliyuncs.com/cover/2021/09/17/1631861003.jpg",
                "problem": {"answers": [1, 2, 3, 4]},
            },
            {
                "index": 2,
                "cover": "https://rainclass.oss-cn-shanghai.aliyuncs.com/cover/2021/09/17/1631861003.jpg",
                "problem": {"answers": [1, 2, 3, 4]},
            },
        ],
        "width": 1920,
        "height": 1080,
    }

    def get_time(function):
        start_time = time.time()
        for image in os.listdir(ppt.cachepath):
            function(ppt.cachepath + "\\" + image)
        end_time = time.time()
        print(function.__name__)
        print(
            f"{end_time - start_time}/{len(os.listdir(ppt.cachepath))}={(end_time - start_time)/len(os.listdir(ppt.cachepath))}"
        )
        print("----------------------------------------------------------------")

    downloadpath = "downloads"
    ppt = PPTManager(data, downloadpath)
    get_time(ppt.get_md5)
    get_time(ppt.get_sha256)
    ppt.start()
