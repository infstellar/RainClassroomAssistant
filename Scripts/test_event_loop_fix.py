"""
测试事件循环修复的有效性
验证AsyncDownloader在不同事件循环环境下的工作情况
"""

import asyncio
import os
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

# 添加项目路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Scripts.AsyncDownloader import AsyncImageDownloader, AsyncPPTDownloadManager
from Scripts.Classes import Lesson


def test_semaphore_creation():
    """测试Semaphore的延迟创建机制"""
    print("=== 测试Semaphore延迟创建 ===")
    
    # 在没有事件循环的环境中创建下载器
    downloader = AsyncImageDownloader(max_concurrent=4)
    print(f"✓ 下载器创建成功，_semaphore初始值: {downloader._semaphore}")
    
    # 在新的事件循环中测试Semaphore创建
    async def test_in_loop():
        semaphore = downloader.semaphore
        print(f"✓ 在事件循环中成功获取Semaphore: {type(semaphore)}")
        return True
    
    # 运行测试
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(test_in_loop())
        print("✓ Semaphore延迟创建测试通过")
        return result
    finally:
        loop.close()


def test_multiple_event_loops():
    """测试在多个事件循环中使用下载器"""
    print("\n=== 测试多事件循环兼容性 ===")
    
    def run_in_thread(thread_id):
        """在线程中运行事件循环"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            downloader = AsyncImageDownloader(max_concurrent=2)
            
            async def test_download():
                # 模拟下载任务
                semaphore = downloader.semaphore
                async with semaphore:
                    print(f"✓ 线程 {thread_id}: 成功获取Semaphore锁")
                    await asyncio.sleep(0.1)  # 模拟下载时间
                    return True
            
            result = loop.run_until_complete(test_download())
            print(f"✓ 线程 {thread_id}: 事件循环测试完成")
            return result
            
        except Exception as e:
            print(f"❌ 线程 {thread_id}: 测试失败 - {str(e)}")
            return False
        finally:
            loop.close()
    
    # 在多个线程中并发测试
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(run_in_thread, i) for i in range(3)]
        results = [future.result() for future in futures]
    
    success_count = sum(results)
    print(f"✓ 多事件循环测试: {success_count}/3 个线程成功")
    return success_count == 3


def test_async_ppt_download_manager():
    """测试AsyncPPTDownloadManager的事件循环兼容性"""
    print("\n=== 测试AsyncPPTDownloadManager ===")
    
    # 创建临时目录
    with tempfile.TemporaryDirectory() as temp_dir:
        # 模拟PPT数据
        test_data = {
            "title": "测试演示文稿",
            "slides": [
                {
                    "index": 1,
                    "cover": "https://httpbin.org/image/jpeg"  # 测试图片URL
                }
            ]
        }
        
        def run_download_test():
            """在线程中运行下载测试"""
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                manager = AsyncPPTDownloadManager(max_concurrent=2)
                
                async def test_download():
                    # 修改下载路径到临时目录
                    original_path = os.getcwd()
                    os.chdir(temp_dir)
                    
                    try:
                        result = await manager.download_presentation(test_data, "测试课程")
                        print(f"✓ 下载管理器测试结果: {result}")
                        return result.get("total", 0) > 0
                    finally:
                        os.chdir(original_path)
                
                result = loop.run_until_complete(test_download())
                print("✓ AsyncPPTDownloadManager事件循环测试通过")
                return result
                
            except Exception as e:
                print(f"❌ AsyncPPTDownloadManager测试失败: {str(e)}")
                return False
            finally:
                loop.close()
        
        # 在线程池中执行测试
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(run_download_test)
            return future.result()


def test_classes_integration():
    """测试Classes.py中的集成使用"""
    print("\n=== 测试Classes.py集成 ===")
    
    try:
        # 创建模拟的MainUI类
        class MockMainUI:
            def __init__(self):
                self.config = {
                    "sessionid": "test_session",
                    "region": "0"  # region应该是数字字符串，对应host数组的索引
                }
                
            class MockSignal:
                def emit(self, *args):
                    print(f"[UI] {args}")
            
            def __init__(self):
                self.config = {
                    "sessionid": "test_session", 
                    "region": "0"  # region应该是数字字符串，对应host数组的索引
                }
                self.add_message_signal = self.MockSignal()
                self.add_course_signal = self.MockSignal()
                self.del_course_signal = self.MockSignal()
        
        # 模拟get_user_info函数返回
        import Scripts.Utils as utils
        original_get_user_info = utils.get_user_info
        
        # 创建一个模拟函数
        def mock_get_user_info(sessionid, region):
            return (0, {"id": "test_uid", "name": "test_user"})
        
        # 替换原始函数
        utils.get_user_info = mock_get_user_info
        
        try:
            # 创建Lesson实例
            lesson = Lesson("test_lesson_id", "测试课程", "test_classroom_id", MockMainUI())
            
            # 测试async_download_manager属性
            manager = lesson.async_download_manager
            print(f"✓ 成功获取async_download_manager: {type(manager)}")
            
            # 测试下载器的Semaphore创建
            downloader = manager.downloader
            print(f"✓ 成功获取downloader: {type(downloader)}")
            
            # 在新事件循环中测试
            def test_in_thread():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                try:
                    async def test_semaphore():
                        semaphore = downloader.semaphore
                        print(f"✓ 在新事件循环中成功获取Semaphore: {type(semaphore)}")
                        return True
                    
                    return loop.run_until_complete(test_semaphore())
                finally:
                    loop.close()
            
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(test_in_thread)
                result = future.result()
            
            print("✓ Classes.py集成测试通过")
            return result
            
        finally:
            # 恢复原始函数
            utils.get_user_info = original_get_user_info
        
    except Exception as e:
        print(f"❌ Classes.py集成测试失败: {str(e)}")
        return False


if __name__ == "__main__":
    print("开始事件循环修复测试...\n")
    
    test1_result = test_semaphore_creation()
    test2_result = test_multiple_event_loops()
    test3_result = test_async_ppt_download_manager()
    test4_result = test_classes_integration()
    
    print(f"\n=== 测试结果汇总 ===")
    print(f"Semaphore延迟创建: {'✅ 通过' if test1_result else '❌ 失败'}")
    print(f"多事件循环兼容性: {'✅ 通过' if test2_result else '❌ 失败'}")
    print(f"AsyncPPTDownloadManager: {'✅ 通过' if test3_result else '❌ 失败'}")
    print(f"Classes.py集成: {'✅ 通过' if test4_result else '❌ 失败'}")
    
    all_passed = all([test1_result, test2_result, test3_result, test4_result])
    
    if all_passed:
        print("\n🎉 所有测试通过！事件循环修复成功！")
        print("✓ Semaphore现在会在正确的事件循环中延迟创建")
        print("✓ 支持多线程环境下的不同事件循环")
        print("✓ 修复了'bound to a different event loop'错误")
    else:
        print("\n⚠️ 部分测试失败，需要进一步检查。")